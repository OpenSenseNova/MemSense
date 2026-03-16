#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

mkdir -p .runtime

if [[ -f .runtime/server.pid ]] && kill -0 "$(cat .runtime/server.pid)" 2>/dev/null; then
  echo "[memsense] server already running"
else
  nohup npm run server > .runtime/server.log 2>&1 &
  echo $! > .runtime/server.pid
  echo "[memsense] server started pid=$(cat .runtime/server.pid)"
fi

if [[ -f .runtime/worker.pid ]] && kill -0 "$(cat .runtime/worker.pid)" 2>/dev/null; then
  echo "[memsense] worker already running"
else
  nohup npm run worker > .runtime/worker.log 2>&1 &
  echo $! > .runtime/worker.pid
  echo "[memsense] worker started pid=$(cat .runtime/worker.pid)"
fi

if [[ -f .runtime/tag-worker.pid ]] && kill -0 "$(cat .runtime/tag-worker.pid)" 2>/dev/null; then
  echo "[memsense] tag-worker already running"
else
  nohup npm run tag-worker > .runtime/tag-worker.log 2>&1 &
  echo $! > .runtime/tag-worker.pid
  echo "[memsense] tag-worker started pid=$(cat .runtime/tag-worker.pid)"
fi

echo "[memsense] logs: tail -f .runtime/server.log .runtime/worker.log .runtime/tag-worker.log"
