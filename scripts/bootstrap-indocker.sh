#!/usr/bin/env bash
# Bootstrap script for running INSIDE a Docker container (Ubuntu/Debian).
# Uses sudo for system deps; PostgreSQL already installed, pgvector built from source.
# BGE python deps (fastapi, uvicorn, sentence-transformers) assumed globally available.
# Usage: bash scripts/bootstrap-indocker.sh [openai|local]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[memsense] ROOT_DIR: $ROOT_DIR"
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

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env; then
    # Escape special characters in value for sed
    local escaped_value="${value//\//\\/}"
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
  echo $key $value
}

# ── PostgreSQL ────────────────────────────────────────────────────────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "[memsense] installing PostgreSQL..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql postgresql-contrib
fi

if ! pg_isready -h 127.0.0.1 -q 2>/dev/null; then
  echo "[memsense] starting PostgreSQL..."
  sudo service postgresql start
  sleep 2
fi

# ── pgvector ──────────────────────────────────────────────────────────────────
PG_VERSION="$(pg_config --version | grep -oP '\d+' | head -1)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" 2>/dev/null | grep -q 1; then
  echo "[memsense] installing pgvector (build from source)..."
  sudo apt-get install -y -qq build-essential "postgresql-server-dev-${PG_VERSION}" git
  TMP_DIR="$(mktemp -d)"
  # pgvector 0.8.0+ requires PG 13+; use 0.7.4 for PG 12
  if [[ "$PG_VERSION" -lt 13 ]]; then
    git clone --depth 1 --branch v0.7.4 https://github.com/pgvector/pgvector.git "$TMP_DIR"
  else
    git clone --depth 1 https://github.com/pgvector/pgvector.git "$TMP_DIR"
  fi
  make -C "$TMP_DIR" PG_CONFIG="$(which pg_config)"
  sudo make -C "$TMP_DIR" install PG_CONFIG="$(which pg_config)"
  rm -rf "$TMP_DIR"
  sudo service postgresql restart
  sleep 2
fi

# ── Strategy ──────────────────────────────────────────────────────────────────
STRATEGY="${1:-}"
if [[ -z "$STRATEGY" ]]; then
  echo "Choose embedding strategy (in-docker):"
  echo "  1) openai  (OpenAI-compatible / Qwen embedding API)"
  echo "  2) local   (local BGE python service)"
  read -r -p "Enter 1 or 2: " choice
  if [[ "$choice" == "1" ]]; then
    STRATEGY="openai"
  else
    STRATEGY="local"
  fi
fi

# ── Env defaults ──────────────────────────────────────────────────────────────
CURRENT_USER="$(whoami)"
upsert_env MEMSENSE_DATABASE_URL "postgresql://${CURRENT_USER}@127.0.0.1:5432/memsense"
upsert_env MEMSENSE_PORT '8787'
upsert_env MEMSENSE_DASHBOARD_TOKENS_JSON '{"demo":"admin"}'

npm install

if [[ "$STRATEGY" == "openai" ]]; then
  echo "[memsense] in-docker openai mode selected"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'openai'
  echo "[memsense] ensure MEMSENSE_OPENAI_API_KEY is set in .env"

elif [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] in-docker local BGE mode selected"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'bge_http'
  upsert_env MEMSENSE_BGE_ENDPOINT 'http://127.0.0.1:8080/embed'
  upsert_env MEMSENSE_BGE_MODEL 'BAAI/bge-large-zh-v1.5'

  # BGE deps (fastapi, uvicorn, sentence-transformers) expected globally available.
  # Download HF model.
  BGE_MODEL="$(grep '^MEMSENSE_BGE_MODEL=' .env | cut -d= -f2-)"
  mkdir -p "$ROOT_DIR/.models"

  # Check if model already downloaded
  MODEL_PATH="$ROOT_DIR/.models/models--${BGE_MODEL//\//--}"
  if [[ -d "$MODEL_PATH" ]]; then
    echo "[memsense] model $BGE_MODEL already downloaded, skipping"
  else
    echo "[memsense] downloading model $BGE_MODEL..."
    huggingface-cli download "$BGE_MODEL" --cache-dir "$ROOT_DIR/.models"
  fi

else
  echo "[memsense] invalid strategy: $STRATEGY"
  echo "Usage: bash scripts/bootstrap-indocker.sh [openai|local]"
  exit 1
fi

echo "[memsense] using database: $(grep '^MEMSENSE_DATABASE_URL=' .env | cut -d= -f2-)"
if [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] using local embedding endpoint: $(grep '^MEMSENSE_BGE_ENDPOINT=' .env | cut -d= -f2-)"
fi

# ── Create database user and database ────────────────────────────────────────
CURRENT_USER="$(whoami)"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${CURRENT_USER}'" 2>/dev/null | grep -q 1; then
  echo "[memsense] creating user ${CURRENT_USER}..."
  sudo -u postgres createuser -s "${CURRENT_USER}"
fi

if ! sudo -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw memsense; then
  echo "[memsense] creating database memsense..."
  sudo -u postgres createdb memsense
fi

set -a
source .env
set +a

npm run db:migrate

echo "[memsense] in-docker setup completed"
