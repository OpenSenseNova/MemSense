#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .runtime

for name in bge server worker tag-worker; do
  if [[ -f .runtime/${name}.pid ]]; then
    pid="$(cat ".runtime/${name}.pid")"
    if kill "$pid" 2>/dev/null; then
      echo "[memsense] stopped $name (pid: $pid)"
    else
      echo "[memsense] $name was not running (pid: $pid)"
    fi
    rm -f ".runtime/${name}.pid"
  fi
done

pkill -f "scripts/bge_local_server.py" 2>/dev/null || true
pkill -f "src/worker/tag-worker.js" 2>/dev/null || true
pkill -f "src/worker/index.js" 2>/dev/null || true
pkill -f "src/server/index.js" 2>/dev/null || true

find .runtime -maxdepth 1 -type f -delete
echo "[memsense] local bash services stopped"
