#!/usr/bin/env bash
set -euo pipefail

LAUNCH_DIR="$HOME/Library/LaunchAgents"
for name in local.memsense.bge local.memsense.server local.memsense.worker local.memsense.tag-worker; do
  launchctl unload "$LAUNCH_DIR/${name}.plist" >/dev/null 2>&1 || true
  rm -f "$LAUNCH_DIR/${name}.plist"
  echo "[memsense] removed $name"
done
