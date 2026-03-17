#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LAUNCH_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$LAUNCH_DIR"
mkdir -p "$ROOT_DIR/.runtime"

if [[ ! -f .env ]]; then
  echo "[memsense] missing .env; create it first"
  exit 1
fi

cat > "$LAUNCH_DIR/local.memsense.bge.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.memsense.bge</string>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>set -a; source .env; set +a; exec .venv-bge/bin/python scripts/bge_local_server.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT_DIR/.runtime/launchd-bge.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT_DIR/.runtime/launchd-bge.err.log</string>
</dict>
</plist>
PLIST

cat > "$LAUNCH_DIR/local.memsense.server.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.memsense.server</string>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>set -a; source .env; set +a; exec npm run server</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT_DIR/.runtime/launchd-server.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT_DIR/.runtime/launchd-server.err.log</string>
</dict>
</plist>
PLIST

cat > "$LAUNCH_DIR/local.memsense.worker.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.memsense.worker</string>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>set -a; source .env; set +a; exec npm run worker</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT_DIR/.runtime/launchd-worker.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT_DIR/.runtime/launchd-worker.err.log</string>
</dict>
</plist>
PLIST

cat > "$LAUNCH_DIR/local.memsense.tag-worker.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.memsense.tag-worker</string>
  <key>WorkingDirectory</key><string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>set -a; source .env; set +a; exec npm run tag-worker</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT_DIR/.runtime/launchd-tag-worker.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT_DIR/.runtime/launchd-tag-worker.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "$LAUNCH_DIR/local.memsense.bge.plist" >/dev/null 2>&1 || true
launchctl unload "$LAUNCH_DIR/local.memsense.server.plist" >/dev/null 2>&1 || true
launchctl unload "$LAUNCH_DIR/local.memsense.worker.plist" >/dev/null 2>&1 || true
launchctl unload "$LAUNCH_DIR/local.memsense.tag-worker.plist" >/dev/null 2>&1 || true

launchctl load "$LAUNCH_DIR/local.memsense.bge.plist"
launchctl load "$LAUNCH_DIR/local.memsense.server.plist"
launchctl load "$LAUNCH_DIR/local.memsense.worker.plist"
launchctl load "$LAUNCH_DIR/local.memsense.tag-worker.plist"

echo "[memsense] launchd services installed"
echo "  - local.memsense.bge"
echo "  - local.memsense.server"
echo "  - local.memsense.worker"
echo "  - local.memsense.tag-worker"
echo "[memsense] logs in $ROOT_DIR/.runtime/launchd-*.log"
