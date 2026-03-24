#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="codex-list"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST_DIR="$HOME/.openclaw/extensions/$PLUGIN_ID"
CONFIG="$HOME/.openclaw/openclaw.json"

mkdir -p "$DEST_DIR"
cp "$SRC_DIR/openclaw.plugin.json" "$SRC_DIR/index.js" "$SRC_DIR/oauth-helper.py" "$SRC_DIR/README.md" "$DEST_DIR/"
chmod +x "$DEST_DIR/oauth-helper.py"

python3 - <<'PY'
import json, pathlib
config_path = pathlib.Path.home()/'.openclaw'/'openclaw.json'
obj = json.loads(config_path.read_text())
plugins = obj.setdefault('plugins', {})
allow = plugins.setdefault('allow', [])
if 'codex-list' not in allow:
    allow.append('codex-list')
entries = plugins.setdefault('entries', {})
entries.setdefault('codex-list', {})['enabled'] = True
config_path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
print('patched', config_path)
PY

echo "Installed to $DEST_DIR"
echo "Restart gateway: openclaw gateway restart"
