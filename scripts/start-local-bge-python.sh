#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR=".venv-bge"

if [[ ! -d "$VENV_DIR" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install --upgrade pip >/dev/null
pip install fastapi uvicorn sentence-transformers >/dev/null

mkdir -p .runtime
if [[ -f .runtime/bge.pid ]] && kill -0 "$(cat .runtime/bge.pid)" 2>/dev/null; then
  echo "[memsense] local bge python service already running"
else
  nohup "$VENV_DIR/bin/python" scripts/bge_local_server.py > .runtime/bge.log 2>&1 &
  echo $! > .runtime/bge.pid
  echo "[memsense] local bge python service started pid=$(cat .runtime/bge.pid)"
fi

echo "[memsense] bge log: tail -f .runtime/bge.log"
