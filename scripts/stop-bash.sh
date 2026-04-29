#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

for name in bge server worker tag-worker; do
  if [[ -f .runtime/${name}.pid ]]; then
    pid=$(cat .runtime/${name}.pid)
    kill "$pid" 2>/dev/null || true
    rm -f .runtime/${name}.pid
    echo "[memsense] stopped $name (pid: $pid)"
  fi
done

pkill -f src/worker/tag-worker.js
pkill -f src/worker/index.js
pkill -f src/server/index.js

rm .runtime/*
