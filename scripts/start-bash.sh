#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p "$ROOT_DIR/.runtime"

if [[ ! -f .env ]]; then
  echo "[memsense] missing .env; create it first"
  exit 1
fi

set -a
source .env
set +a

./.venv-bge/bin/python scripts/bge_local_server.py > .runtime/bge.out.log 2> .runtime/bge.err.log &
echo $! > .runtime/bge.pid

npm run server > .runtime/server.out.log 2> .runtime/server.err.log &
echo $! > .runtime/server.pid

npm run worker > .runtime/worker.out.log 2> .runtime/worker.err.log &
echo $! > .runtime/worker.pid

npm run tag-worker > .runtime/tag-worker.out.log 2> .runtime/tag-worker.err.log &
echo $! > .runtime/tag-worker.pid

echo "[memsense] services started"
echo "  - bge (pid: $(cat .runtime/bge.pid))"
echo "  - server (pid: $(cat .runtime/server.pid))"
echo "  - worker (pid: $(cat .runtime/worker.pid))"
echo "  - tag-worker (pid: $(cat .runtime/tag-worker.pid))"
echo "[memsense] logs in $ROOT_DIR/.runtime/*.log"
