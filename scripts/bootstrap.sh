#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[memsense] .env created from .env.example"
fi

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env; then
    local tmp
    tmp="$(mktemp)"
    awk -v key="$key" -v value="$value" '
      $0 ~ "^" key "=" { print key "=" value; next }
      { print }
    ' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

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

HOST_PORT="${MEMSENSE_HOST_PORT:-${MEMSENSE_PORT:-8787}}"

upsert_env MEMSENSE_PORT '8787'
upsert_env MEMSENSE_HOST_PORT "$HOST_PORT"
upsert_env MEMSENSE_DASHBOARD_TOKENS_JSON '{"demo":"admin"}'

if [[ "$STRATEGY" == "openai" ]]; then
  echo "[memsense] starting with OPENAI-compatible embedding strategy"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'openai'
  echo "[memsense] ensure MEMSENSE_OPENAI_API_KEY is set in .env"
  docker compose build server
  docker compose up -d postgres server worker tag-worker
elif [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] starting with LOCAL BGE strategy (auto model pull on first run)"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'bge_http'
  upsert_env MEMSENSE_BGE_ENDPOINT 'http://bge:8080/embed'
  upsert_env MEMSENSE_BGE_MODEL 'BAAI/bge-large-zh-v1.5'
  docker compose --profile local-bge build server bge
  docker compose --profile local-bge up -d
else
  echo "[memsense] invalid strategy: $STRATEGY"
  echo "Usage: bash scripts/bootstrap.sh [openai|local]"
  exit 1
fi

echo "[memsense] done. Check services with: docker compose ps"
