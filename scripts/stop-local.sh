#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for svc in server worker; do
  pid_file=".runtime/${svc}.pid"
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
      echo "[memsense] stopped ${svc} pid=$pid"
    fi
    rm -f "$pid_file"
  fi
done
