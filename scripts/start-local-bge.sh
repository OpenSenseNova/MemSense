#!/usr/bin/env bash
set -euo pipefail

# One-click local deployment with auto model download (first startup)
# Requires Docker/Compose.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[memsense] .env created from .env.example"
fi

echo "[memsense] starting postgres + server + worker + local bge ..."
docker compose --profile local-bge up -d

echo "[memsense] done. First run may take longer while downloading BGE model."
echo "[memsense] check logs: docker compose logs -f bge"
