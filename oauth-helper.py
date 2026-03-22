#!/usr/bin/env python3
import json, os, re, signal, subprocess, sys, time, shutil
from pathlib import Path

BASE = Path.home()/'.openclaw/extensions/codex-list'
STATE = BASE/'oauth-state.json'
RUNTIME = BASE/'oauth-runtime'
RUNTIME.mkdir(parents=True, exist_ok=True)


def resolve_node():
    for cand in [shutil.which('node'), '/opt/homebrew/bin/node', '/opt/homebrew/opt/node/bin/node', '/usr/local/bin/node', '/usr/bin/node']:
        if cand and Path(cand).exists():
            return cand
    nvm = Path.home()/'.nvm/versions/node'
    if nvm.exists():
        for p in sorted(nvm.glob('*/bin/node'), reverse=True):
            if p.exists():
                return str(p)
    return 'node'


def resolve_openclaw_argv():
    home = Path.home()
    shim = home/'.npm-global/bin/openclaw'
    dist = home/'.openclaw/lib/node_modules/openclaw/dist/index.js'
    try:
        text = shim.read_text(errors='ignore')
        if text.startswith('#!'):
            return [str(shim), 'models', 'auth', 'login', '--provider', 'openai-codex']
    except Exception:
        pass
    if dist.exists():
        return [resolve_node(), str(dist), 'models', 'auth', 'login', '--provider', 'openai-codex']
    return ['openclaw', 'models', 'auth', 'login', '--provider', 'openai-codex']


def write_state(data):
    STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def read_state():
    if not STATE.exists():
        return None
    return json.loads(STATE.read_text())


def clear_state_files(state=None):
    st = state or read_state()
    if st:
        for key in ('outPath', 'callbackPath', 'resultPath', 'expectPath'):
            p = st.get(key)
            if p:
                try: Path(p).unlink()
                except FileNotFoundError: pass
        for key in ('daemonPid', 'loginPid'):
            pid = st.get(key)
            if pid:
                try: os.kill(pid, signal.SIGTERM)
                except OSError: pass
    try: STATE.unlink()
    except FileNotFoundError: pass


def build_expect_script(state, argv):
    argv_quoted = ' '.join('{' + a.replace('}', '\\}') + '}' for a in argv)
    template = r'''log_user 0
set timeout -1
set outPath {{{outPath}}}
set callbackPath {{{callbackPath}}}
set resultPath {{{resultPath}}}
proc log_append {{path text}} {{
  set f [open $path a]
  puts -nonewline $f $text
  close $f
}}
spawn -noecho {argv}
set deadline [expr [clock seconds] + 180]
set callback_sent 0
set callback_deadline 0
while {{1}} {{
  expect {{
    -re {{.+}} {{ log_append $outPath $expect_out(buffer) }}
    timeout {{ }}
    eof {{
      if {{$callback_sent}} {{ log_append $resultPath "EXITED\n" }} else {{ log_append $resultPath "NO_URL\n" }}
      exit 0
    }}
  }}
  if {{[file exists $callbackPath] && !$callback_sent}} {{
    set cf [open $callbackPath r]
    set cb [string trim [read $cf]]
    close $cf
    if {{$cb ne ""}} {{
      send -- $cb
      send -- "\r"
      set callback_sent 1
      set callback_deadline [expr [clock seconds] + 25]
    }}
  }}
  if {{$callback_sent && [clock seconds] > $callback_deadline}} {{
    log_append $resultPath "TIMEOUT\ncallback wait expired\n"
    exit 0
  }}
  if {{[clock seconds] > $deadline}} {{
    log_append $resultPath "TIMEOUT\nflow expired after 180s\n"
    catch {{close}}
    exit 0
  }}
}}
'''
    return template.format(outPath=state['outPath'], callbackPath=state['callbackPath'], resultPath=state['resultPath'], argv=argv_quoted)


def start():
    old = read_state()
    if old:
        clear_state_files(old)
    sid = str(int(time.time() * 1000))
    state = {'id': sid, 'createdAt': int(time.time() * 1000), 'outPath': str(RUNTIME / f'{sid}.out'), 'callbackPath': str(RUNTIME / f'{sid}.callback'), 'resultPath': str(RUNTIME / f'{sid}.result'), 'expectPath': str(RUNTIME / f'{sid}.exp')}
    for k in ('outPath', 'callbackPath', 'resultPath'): Path(state[k]).write_text('')
    argv = resolve_openclaw_argv()
    Path(state['expectPath']).write_text(build_expect_script(state, argv))
    proc = subprocess.Popen(['/usr/bin/expect', state['expectPath']], start_new_session=True)
    state['daemonPid'] = proc.pid
    state['argv'] = argv
    write_state(state)
    deadline = time.time() + 15
    out_path = Path(state['outPath'])
    while time.time() < deadline:
        text = out_path.read_text(errors='ignore')
        m = re.search(r'https://auth\.openai\.com/oauth/authorize\S+', text)
        if m:
            state = read_state() or state
            state['url'] = m.group(0)
            write_state(state)
            print(m.group(0))
            return 0
        time.sleep(0.2)
    print('ERROR: no oauth url', file=sys.stderr)
    return 1


def callback(url):
    state = read_state()
    if not state:
        print('ERROR: no pending state', file=sys.stderr)
        return 1
    auth_path = Path.home()/'.openclaw/agents/main/agent/auth-profiles.json'
    before = set()
    try:
        before = set(json.loads(auth_path.read_text()).get('profiles', {}).keys())
    except Exception:
        pass
    Path(state['callbackPath']).write_text(url + '\n')
    deadline = time.time() + 30
    result_path = Path(state['resultPath'])
    out_path = Path(state['outPath'])
    while time.time() < deadline:
        try:
            after = set(json.loads(auth_path.read_text()).get('profiles', {}).keys())
        except Exception:
            after = before
        codex_new = sorted(x for x in (after - before) if x.startswith('openai-codex'))
        if codex_new:
            print('OK\n' + '\n'.join(codex_new))
            return 0
        txt = result_path.read_text(errors='ignore')
        if txt.strip():
            print(txt.strip())
            return 0 if txt.startswith('OK') else 1
        time.sleep(0.25)
    tail = '\n'.join(out_path.read_text(errors='ignore').splitlines()[-20:]) if out_path.exists() else ''
    print(('ERROR: callback timeout\n' + tail).strip(), file=sys.stderr)
    return 1

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage: oauth-helper.py start|callback <url>', file=sys.stderr); sys.exit(2)
    if sys.argv[1] == 'start': sys.exit(start())
    if sys.argv[1] == 'callback': sys.exit(callback(sys.argv[2]))
    print('usage: oauth-helper.py start|callback <url>', file=sys.stderr); sys.exit(2)
