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

read_env() {
  local key="$1"
  [[ -f .env ]] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' .env
}

ensure_env_default() {
  local key="$1"
  local value="$2"
  local current
  current="$(read_env "$key")"
  if [[ -z "$current" ]]; then
    upsert_env "$key" "$value"
  fi
}

wait_http_ok() {
  local url="$1"
  local label="$2"
  local timeout="${3:-600}"
  local i
  echo "[memsense] waiting for $label at $url"
  for ((i = 1; i <= timeout; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[memsense] $label healthy"
      return 0
    fi
    sleep 1
  done
  echo "[memsense] $label did not become healthy within ${timeout}s" >&2
  return 1
}

host_tag_worker_available() {
  local provider
  provider="$(read_env MEMSENSE_TAGGER_PROVIDER)"
  provider="${provider:-auto}"
  case "$provider" in
    auto|openclaw|openclaw_cli)
      ;;
    *)
      return 1
      ;;
  esac
  command -v openclaw >/dev/null 2>&1 && command -v npm >/dev/null 2>&1
}

ensure_node_deps() {
  if [[ ! -d node_modules ]]; then
    echo "[memsense] installing Node dependencies for host tag-worker"
    npm ci
  fi
}

start_host_tag_worker() {
  local pg_host_port
  pg_host_port="${MEMSENSE_POSTGRES_PORT:-$(read_env MEMSENSE_POSTGRES_PORT)}"
  pg_host_port="${pg_host_port:-54329}"
  echo "[memsense] using host tag-worker so tags can reuse OpenClaw's configured model"
  docker compose stop tag-worker >/dev/null 2>&1 || true
  ensure_node_deps
  bash scripts/start-bash.sh \
    --tag-worker-only \
    --restart \
    --database-url "postgresql://memsense:memsense@127.0.0.1:${pg_host_port}/memsense"
}

wait_memsense_api() {
  wait_http_ok "http://127.0.0.1:${HOST_PORT}/healthz" "MemSense API"
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
BGE_HOST_PORT="${MEMSENSE_BGE_HOST_PORT:-8088}"

upsert_env MEMSENSE_PORT '8787'
upsert_env MEMSENSE_HOST_PORT "$HOST_PORT"
upsert_env MEMSENSE_API_URL "http://127.0.0.1:${HOST_PORT}"
upsert_env MEMSENSE_DASHBOARD_TOKENS_JSON '{"demo":"admin"}'
ensure_env_default MEMSENSE_TAGGER_PROVIDER 'auto'
ensure_env_default MEMSENSE_TAGGER_MODEL 'auto'
ensure_env_default MEMSENSE_TAG_WORKER_CONCURRENCY '3'

USE_HOST_TAG_WORKER=false
if host_tag_worker_available; then
  USE_HOST_TAG_WORKER=true
else
  echo "[memsense] host OpenClaw tagger not available; Docker tag-worker will run and auto mode will skip tagging unless MEMSENSE_TAGGER_PROVIDER=openai is configured"
fi

if [[ "$STRATEGY" == "openai" ]]; then
  echo "[memsense] starting with OPENAI-compatible embedding strategy"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'openai'
  echo "[memsense] ensure MEMSENSE_OPENAI_API_KEY is set in .env"
  docker compose build server
  if [[ "$USE_HOST_TAG_WORKER" == "true" ]]; then
    docker compose up -d postgres server worker
    wait_memsense_api
    start_host_tag_worker
  else
    docker compose up -d postgres server worker tag-worker
  fi
elif [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] starting with LOCAL BGE strategy (auto model pull on first run)"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'bge_http'
  upsert_env MEMSENSE_BGE_ENDPOINT 'http://bge:8080/embed'
  upsert_env MEMSENSE_BGE_MODEL 'BAAI/bge-large-zh-v1.5'
  docker compose --profile local-bge build server bge
  if [[ "$USE_HOST_TAG_WORKER" == "true" ]]; then
    docker compose --profile local-bge up -d postgres server worker bge
    wait_memsense_api
    start_host_tag_worker
  else
    docker compose --profile local-bge up -d
  fi
  wait_http_ok "http://127.0.0.1:${BGE_HOST_PORT}/healthz" "BGE embedding service"
else
  echo "[memsense] invalid strategy: $STRATEGY"
  echo "Usage: bash scripts/bootstrap.sh [openai|local]"
  exit 1
fi

echo "[memsense] done. Check services with: docker compose ps"
