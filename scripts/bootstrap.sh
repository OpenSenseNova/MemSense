#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[memsense] .env created from .env.example"
fi

STRATEGY="${1:-}"
if [[ -z "$STRATEGY" ]]; then
  echo "Choose embedding strategy:"
  echo "  1) openai  (OpenAI-compatible / Qwen embedding API)"
  echo "  2) local   (local BGE, auto-pull model)"
  read -r -p "Enter 1 or 2: " choice
  if [[ "$choice" == "1" ]]; then
    STRATEGY="openai"
  else
    STRATEGY="local"
  fi
fi

if [[ "$STRATEGY" == "openai" ]]; then
  echo "[memsense] starting with OPENAI-compatible embedding strategy"
  echo "[memsense] ensure MEMSENSE_OPENAI_API_KEY is set in .env"
  docker compose up -d postgres server worker
elif [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] starting with LOCAL BGE strategy (auto model pull on first run)"
  docker compose --profile local-bge up -d
else
  echo "[memsense] invalid strategy: $STRATEGY"
  echo "Usage: bash scripts/bootstrap.sh [openai|local]"
  exit 1
fi

echo "[memsense] done. Check services with: docker compose ps"
