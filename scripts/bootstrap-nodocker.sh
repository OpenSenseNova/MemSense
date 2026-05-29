#!/usr/bin/env bash
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

# Check PostgreSQL
if ! command -v psql >/dev/null 2>&1; then
  echo "[memsense] PostgreSQL not found, installing..."
  if command -v brew >/dev/null 2>&1; then
    brew install postgresql@17
    brew services start postgresql@17
    brew link --overwrite postgresql@17
  else
    echo "[memsense] Please install PostgreSQL 17+ manually"
    exit 1
  fi
fi

# Check pgvector
if ! psql -d postgres -c "SELECT 1" >/dev/null 2>&1; then
  echo "[memsense] PostgreSQL not running, starting..."
  brew services start postgresql@17 || brew services start postgresql
fi

if ! psql -d postgres -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" 2>/dev/null | grep -q 1; then
  echo "[memsense] pgvector not found, installing..."
  if command -v brew >/dev/null 2>&1; then
    brew install pgvector
    brew services restart postgresql@17 || brew services restart postgresql
  else
    echo "[memsense] Please install pgvector manually"
    exit 1
  fi
fi

upsert_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" .env; then
    perl -0pi -e "s#^${key}=.*#${key}=${value}#m" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

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

# Sensible defaults for no-docker mode.
upsert_env MEMSENSE_DATABASE_URL 'postgresql://127.0.0.1:5432/memsense'
upsert_env MEMSENSE_PORT '8787'
upsert_env MEMSENSE_API_URL 'http://127.0.0.1:8787'
upsert_env MEMSENSE_DASHBOARD_TOKENS_JSON '{"demo":"admin"}'

npm install

if [[ "$STRATEGY" == "openai" ]]; then
  echo "[memsense] no-docker openai mode selected"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'openai'
  echo "[memsense] ensure MEMSENSE_OPENAI_API_KEY is set in .env"
elif [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] no-docker local BGE mode selected"
  BGE_MODEL="${MEMSENSE_BGE_MODEL:-}"
  if [[ -z "$BGE_MODEL" ]]; then
    BGE_MODEL="$(awk -F= '$1 == "MEMSENSE_BGE_MODEL" { sub(/^[^=]*=/, ""); print; exit }' .env)"
  fi
  BGE_MODEL="${BGE_MODEL:-BAAI/bge-large-zh-v1.5}"
  upsert_env MEMSENSE_EMBEDDING_PROVIDER 'bge_http'
  upsert_env MEMSENSE_BGE_ENDPOINT 'http://127.0.0.1:8080/embed'
  upsert_env MEMSENSE_BGE_MODEL "$BGE_MODEL"
  # install bge python service
  PYTHON_BIN="${PYTHON_BIN:-python3}"
  VENV_DIR=".venv-bge"
  if [[ ! -d "$VENV_DIR" ]]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  fi
  source "$VENV_DIR/bin/activate"
  pip install --upgrade pip >/dev/null
  pip install fastapi uvicorn sentence-transformers >/dev/null
  # download hf model
  mkdir -p "$ROOT_DIR/.models"
  if command -v hf >/dev/null 2>&1; then
    hf download "$BGE_MODEL" --cache-dir "$ROOT_DIR/.models"
  elif command -v huggingface-cli >/dev/null 2>&1; then
    huggingface-cli download "$BGE_MODEL" --cache-dir "$ROOT_DIR/.models"
  else
    echo "[memsense] Hugging Face CLI not found after installing sentence-transformers"
    exit 1
  fi
else
  echo "[memsense] invalid strategy: $STRATEGY"
  echo "Usage: bash scripts/bootstrap-nodocker.sh [openai|local]"
  exit 1
fi

echo "[memsense] using database: $(grep '^MEMSENSE_DATABASE_URL=' .env | cut -d= -f2-)"
if [[ "$STRATEGY" == "local" ]]; then
  echo "[memsense] using local embedding endpoint: $(grep '^MEMSENSE_BGE_ENDPOINT=' .env | cut -d= -f2-)"
fi

# Create database if not exists
if ! psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw memsense; then
  echo "[memsense] creating database memsense..."
  createdb memsense
fi

set -a
source .env
set +a

npm run db:migrate
# move this part to start-bash.sh
# echo "[memsense] starting server + worker in background"
# bash scripts/run-local.sh

echo "[memsense] no-docker setup completed"
