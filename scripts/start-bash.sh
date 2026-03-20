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

# checkout whether the port is used by other services
if lsof -i :$MEMSENSE_BGE_PORT | grep -q "python"; then
  echo "[memsense] port $MEMSENSE_BGE_PORT is used by other services. Please stop the service first."
  exit 1
fi
# check 
if lsof -i :$MEMSENSE_PORT | grep -q "node"; then
  echo "[memsense] port $MEMSENSE_PORT is used by other services. Please stop the service first."
  exit 1
fi

export MEMSENSE_BGE_SAVE_DIR="$ROOT_DIR/.models"
./.venv-bge/bin/python scripts/bge_local_server.py > .runtime/bge.log 2>&1 &
echo $! > .runtime/bge.pid

npm run server > .runtime/server.log 2>&1 &
echo $! > .runtime/server.pid

npm run worker > .runtime/worker.log 2>&1 &
echo $! > .runtime/worker.pid

npm run tag-worker > .runtime/tag-worker.log 2>&1 &
echo $! > .runtime/tag-worker.pid


# wait 10 seconds for all services to start
sleep 15

echo "[memsense] services started"
for subtask in bge server worker tag-worker; do
  # check if the log contains "Error"
  tail .runtime/$subtask.log
  if grep -q "Error" .runtime/$subtask.log; then
    echo "[memsense] $subtask service failed to start. Check the logs for errors."
    kill $(cat .runtime/$subtask.pid) 2>/dev/null || true
    rm -f .runtime/$subtask.pid
  fi
  echo "  - $subtask (pid: $(cat .runtime/$subtask.pid))"
done
echo "[memsense] logs in $ROOT_DIR/.runtime/*.log"
