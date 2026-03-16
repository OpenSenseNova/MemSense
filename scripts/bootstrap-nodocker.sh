#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[memsense] .env created from .env.example"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[memsense] node is required"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[memsense] npm is required"
  exit 1
fi

STRATEGY="${1:-}"
if [[ -z "$STRATEGY" ]]; then
  echo "Choose embedding strategy (no docker):"
  echo "  1) openai  (OpenAI-compatible / Qwen embedding API)"
  echo "  2) local   (local BGE python service)"
  read -r -p "Enter 1 or 2: " choice
  if [[ "$choice" == "1" ]]; then
    STRATEGY="openai"
  else
    STRATEGY="local"
  fi
fi

npm install

if [[ "$STRATEGY" == "openai" ]]; then
  echo "[memsense] no-docker openai mode selected"
  echo "[memsense] ensure MEMSENSE_OPENAI_API_KEY and MEMSENSE_DATABASE_URL in .env"
elif [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] no-docker local BGE mode selected"
  bash scripts/start-local-bge-python.sh
else
  echo "[memsense] invalid strategy: $STRATEGY"
  echo "Usage: bash scripts/bootstrap-nodocker.sh [openai|local]"
  exit 1
fi

npm run db:migrate

echo "[memsense] starting server + worker in background"
bash scripts/run-local.sh

echo "[memsense] no-docker setup completed"
