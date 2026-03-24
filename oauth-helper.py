#!/usr/bin/env python3
import base64
import hashlib
import json
import os
import re
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = Path.home()/'.openclaw/extensions/codex-list'
STATE = BASE/'oauth-state.json'
RUNTIME = BASE/'oauth-runtime'
RUNTIME.mkdir(parents=True, exist_ok=True)

CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
TOKEN_URL = 'https://auth.openai.com/oauth/token'
REDIRECT_URI = 'http://localhost:1455/auth/callback'
SCOPE = 'openid profile email offline_access'
JWT_CLAIM_PATH = 'https://api.openai.com/auth'
PROFILE_CLAIM_PATH = 'https://api.openai.com/profile'
PROFILE_PREFIX = 'openai-codex:'
HEALTH_CACHE = RUNTIME/'health-cache.json'
HEALTH_CACHE_TTL_MS = 120000
TOKEN_TIMEOUT_SECONDS = 15


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def read_state():
    if not STATE.exists():
        return None
    return read_json(STATE)


def write_state(data):
    data['updatedAt'] = int(time.time() * 1000)
    write_json(STATE, data)


def now_ms():
    return int(time.time() * 1000)


def decode_jwt_payload(token):
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload = parts[1] + '=' * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode()).decode())
    except Exception:
        return None


def derive_account(access_token):
    payload = decode_jwt_payload(access_token) or {}
    auth = payload.get(JWT_CLAIM_PATH) or {}
    profile = payload.get(PROFILE_CLAIM_PATH) or {}
    account_id = auth.get('chatgpt_account_id')
    email = profile.get('email')
    return account_id, email


def normalize_profile_suffix(email, account_id):
    base = (email or '').split('@', 1)[0].strip().lower()
    if not base:
        base = (account_id or 'codex').strip().lower()
    base = re.sub(r'[^a-z0-9_-]+', '-', base).strip('-_') or 'codex'
    return base


def make_pkce_pair():
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode('utf-8')).digest()
    challenge = base64.urlsafe_b64encode(digest).decode('ascii').rstrip('=')
    return verifier, challenge


def build_authorize_url(state_token, challenge, originator='pi'):
    params = {
        'response_type': 'code',
        'client_id': CLIENT_ID,
        'redirect_uri': REDIRECT_URI,
        'scope': SCOPE,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'state': state_token,
        'id_token_add_organizations': 'true',
        'codex_cli_simplified_flow': 'true',
        'originator': originator,
    }
    return AUTHORIZE_URL + '?' + urlencode(params)


def parse_callback(callback_url):
    parsed = urlparse(callback_url.strip())
    query = parse_qs(parsed.query)
    code = (query.get('code') or [None])[0]
    state = (query.get('state') or [None])[0]
    return code, state


def exchange_code(code, verifier):
    data = urlencode({
        'grant_type': 'authorization_code',
        'client_id': CLIENT_ID,
        'code': code,
        'code_verifier': verifier,
        'redirect_uri': REDIRECT_URI,
    }).encode('utf-8')
    req = Request(TOKEN_URL, data=data, method='POST', headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urlopen(req, timeout=TOKEN_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='ignore') if hasattr(e, 'read') else ''
        raise RuntimeError(f'token exchange failed: HTTP {e.code} {body}'.strip())
    except URLError as e:
        raise RuntimeError(f'token exchange failed: {e}')

    access = payload.get('access_token')
    refresh = payload.get('refresh_token')
    expires_in = payload.get('expires_in')
    id_token = payload.get('id_token')
    if not access or not refresh or not isinstance(expires_in, (int, float)):
        raise RuntimeError(f'token response missing fields: {json.dumps(payload, ensure_ascii=False)}')
    return {
        'access': access,
        'refresh': refresh,
        'expires': int(now_ms() + float(expires_in) * 1000),
        'id_token': id_token,
        'raw': payload,
    }


def auth_profiles_path():
    return Path.home()/'.openclaw/agents/main/agent/auth-profiles.json'


def refresh_token(refresh_token):
    data = urlencode({
        'grant_type': 'refresh_token',
        'refresh_token': refresh_token,
        'client_id': CLIENT_ID,
    }).encode('utf-8')
    req = Request(TOKEN_URL, data=data, method='POST', headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urlopen(req, timeout=TOKEN_TIMEOUT_SECONDS) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='ignore') if hasattr(e, 'read') else ''
        return {'ok': False, 'error': f'HTTP {e.code} {body}'.strip()}
    except URLError as e:
        return {'ok': False, 'error': str(e)}

    access = payload.get('access_token')
    refresh = payload.get('refresh_token')
    expires_in = payload.get('expires_in')
    if not access or not refresh or not isinstance(expires_in, (int, float)):
        return {'ok': False, 'error': f'invalid refresh response: {json.dumps(payload, ensure_ascii=False)}'}
    account_id, email = derive_account(access)
    return {
        'ok': True,
        'access': access,
        'refresh': refresh,
        'expires': int(now_ms() + float(expires_in) * 1000),
        'accountId': account_id,
        'email': email,
    }


def ensure_auth_store(path):
    if path.exists():
        data = read_json(path)
    else:
        data = {'version': 1, 'profiles': {}, 'order': {}, 'lastGood': {}, 'usageStats': {}}
    data.setdefault('version', 1)
    data.setdefault('profiles', {})
    data.setdefault('order', {})
    data.setdefault('lastGood', {})
    data.setdefault('usageStats', {})
    return data


def upsert_profile_record(store, profile_id, creds, account_id=None, email=None):
    account_id = account_id or creds.get('accountId')
    email = email or creds.get('email')
    profile = store['profiles'].setdefault(profile_id, {})
    profile['type'] = 'oauth'
    profile['provider'] = 'openai-codex'
    profile['access'] = creds['access']
    profile['refresh'] = creds['refresh']
    profile['expires'] = creds['expires']
    if account_id:
        profile['accountId'] = account_id
    if email:
        profile['email'] = email

    order = store['order'].setdefault('openai-codex', [])
    if profile_id not in order:
        order.append(profile_id)
    usage = store['usageStats'].setdefault(profile_id, {})
    usage.setdefault('errorCount', 0)
    usage.setdefault('lastUsed', 0)
    usage.setdefault('lastFailureAt', 0)


def update_profile_tokens(profile_id, creds):
    store_path = auth_profiles_path()
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store = ensure_auth_store(store_path)
    if profile_id not in store.get('profiles', {}):
        return False
    upsert_profile_record(store, profile_id, creds)
    write_json(store_path, store)
    return True


def insert_profile(creds):
    store_path = auth_profiles_path()
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store = ensure_auth_store(store_path)

    account_id, email = derive_account(creds['access'])
    if not account_id:
        raise RuntimeError('failed to extract accountId from access token')

    suffix = normalize_profile_suffix(email, account_id)
    profile_id = f'openai-codex:{suffix}'
    dedupe = 2
    while profile_id in store['profiles']:
        existing = store['profiles'][profile_id]
        if existing.get('accountId') == account_id:
            break
        profile_id = f'openai-codex:{suffix}-{dedupe}'
        dedupe += 1

    upsert_profile_record(store, profile_id, creds, account_id=account_id, email=email)
    write_json(store_path, store)
    return profile_id, account_id, email


def write_result(state, status, message, extra=None):
    payload = {
        'id': state['id'],
        'status': status,
        'message': message,
        'finishedAt': now_ms(),
    }
    if extra:
        payload.update(extra)
    write_json(Path(state['resultPath']), payload)


def read_health_cache(profile_id=None):
    if not HEALTH_CACHE.exists():
        return None
    try:
        payload = read_json(HEALTH_CACHE)
    except Exception:
        return None
    created_at = payload.get('createdAt')
    profiles = payload.get('profiles')
    if not isinstance(created_at, int) or not isinstance(profiles, list):
        return None
    if now_ms() - created_at > HEALTH_CACHE_TTL_MS:
        return None
    if profile_id:
        profiles = [item for item in profiles if item.get('profileId') == profile_id]
        if not profiles:
            return None
    return profiles


def write_health_cache(results):
    write_json(HEALTH_CACHE, {
        'createdAt': now_ms(),
        'profiles': results,
    })


def clear_health_cache():
    try:
        HEALTH_CACHE.unlink()
    except FileNotFoundError:
        pass


def start():
    verifier, challenge = make_pkce_pair()
    state_token = secrets.token_hex(16)
    oauth_url = build_authorize_url(state_token, challenge)
    attempt_id = str(int(time.time() * 1000))
    state = {
        'id': attempt_id,
        'status': 'waiting_callback',
        'createdAt': int(time.time() * 1000),
        'oauthUrl': oauth_url,
        'callbackUrl': None,
        'verifier': verifier,
        'oauthState': state_token,
        'stdoutPath': str(RUNTIME / f'{attempt_id}.stdout.log'),
        'stderrPath': str(RUNTIME / f'{attempt_id}.stderr.log'),
        'callbackPath': str(RUNTIME / f'{attempt_id}.callback.txt'),
        'resultPath': str(RUNTIME / f'{attempt_id}.result.json'),
        'pidPath': str(RUNTIME / f'{attempt_id}.pid'),
    }
    Path(state['stdoutPath']).write_text('OAuth URL ready\n' + oauth_url + '\n', encoding='utf-8')
    Path(state['stderrPath']).write_text('', encoding='utf-8')
    Path(state['callbackPath']).write_text('', encoding='utf-8')
    Path(state['pidPath']).write_text(str(os.getpid()), encoding='utf-8')
    write_state(state)
    print(oauth_url)
    return 0


def health(profile_id=None):
    cached = read_health_cache(profile_id)
    if cached is not None:
        print(json.dumps({'profiles': cached}, ensure_ascii=False))
        return 0

    store_path = auth_profiles_path()
    store = ensure_auth_store(store_path)
    profiles = store.get('profiles', {})
    now = now_ms()
    results = []
    for pid, profile in profiles.items():
        if not pid.startswith(PROFILE_PREFIX):
            continue
        if profile_id and pid != profile_id:
            continue
        expires = profile.get('expires')
        try:
            expires_ms = int(expires)
            if expires_ms < 10**12:
                expires_ms *= 1000
        except Exception:
            expires_ms = None
        item = {
            'profileId': pid,
            'accountId': profile.get('accountId'),
            'accessStatus': 'valid' if (expires_ms and expires_ms > now) else 'expired',
            'accessExpires': expires_ms,
            'refreshStatus': 'unknown',
        }
        refresh = profile.get('refresh')
        if refresh:
            refreshed = refresh_token(refresh)
            if refreshed.get('ok'):
                update_profile_tokens(pid, refreshed)
                item['accessStatus'] = 'valid'
                item['accessExpires'] = refreshed.get('expires')
                item['refreshStatus'] = 'alive'
                item['refreshExpires'] = refreshed.get('expires')
                item['email'] = refreshed.get('email')
            else:
                item['refreshStatus'] = 'dead'
                item['refreshError'] = refreshed.get('error')
        results.append(item)

    if not profile_id:
        write_health_cache(results)
    print(json.dumps({'profiles': results}, ensure_ascii=False))
    return 0


def callback(callback_url):
    state = read_state()
    if not state:
        print('ERROR: no pending state', file=sys.stderr)
        return 1

    Path(state['callbackPath']).write_text(callback_url.strip() + '\n', encoding='utf-8')
    state['callbackUrl'] = callback_url.strip()
    write_state(state)

    code, state_token = parse_callback(callback_url)
    if not code:
        write_result(state, 'failed', 'missing authorization code in callback')
        print('missing authorization code in callback', file=sys.stderr)
        return 1
    if state_token and state_token != state.get('oauthState'):
        write_result(state, 'failed', 'state mismatch', {'expectedState': state.get('oauthState'), 'gotState': state_token})
        print('state mismatch', file=sys.stderr)
        return 1

    try:
        creds = exchange_code(code, state['verifier'])
        profile_id, account_id, email = insert_profile(creds)
        clear_health_cache()
        state['status'] = 'done'
        write_state(state)
        write_result(state, 'done', 'login completed', {
            'profileId': profile_id,
            'accountId': account_id,
            'email': email,
            'expires': creds['expires'],
        })
        print('OK\n' + profile_id)
        return 0
    except Exception as exc:
        state['status'] = 'failed'
        write_state(state)
        write_result(state, 'failed', str(exc))
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: oauth-helper.py start|callback <url>', file=sys.stderr)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == 'start':
        sys.exit(start())
    if cmd == 'callback':
        sys.exit(callback(sys.argv[2]))
    if cmd == 'health':
        sys.exit(health(sys.argv[2] if len(sys.argv) > 2 else None))
    print('usage: oauth-helper.py start|callback <url>|health [profile_id]', file=sys.stderr)
    sys.exit(2)
