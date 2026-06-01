#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STRATEGY=""
RUNTIME="docker"
SKIP_PLUGIN=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: bash scripts/update.sh [local|openai] [options]

Options:
  --runtime docker|nodocker  Runtime to update (default: docker)
  --docker                  Same as --runtime docker
  --no-docker               Same as --runtime nodocker
  --skip-plugin             Do not reinstall the OpenClaw plugin
  --dry-run                 Print commands without running them
  -h, --help                Show this help
EOF
}

log() {
  echo "[memsense] $*"
}

fail() {
  echo "[memsense] $*" >&2
  exit 1
}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    log "(dry-run) $*"
  else
    log "running: $*"
    "$@"
  fi
}

read_env() {
  local key="$1"
  [[ -f .env ]] || return 0
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' .env
}

detect_strategy() {
  if [[ -n "$STRATEGY" ]]; then
    return
  fi

  local provider
  provider="$(read_env MEMSENSE_EMBEDDING_PROVIDER)"
  case "$provider" in
    openai)
      STRATEGY="openai"
      ;;
    bge_http|"")
      STRATEGY="local"
      ;;
    *)
      fail "cannot infer embedding mode from MEMSENSE_EMBEDDING_PROVIDER=$provider; pass local or openai"
      ;;
  esac
}

update_docker() {
  if [[ "$DRY_RUN" != "true" ]]; then
    command -v docker >/dev/null 2>&1 || fail "Docker is required for docker runtime"
  fi

  if [[ "$STRATEGY" == "openai" ]]; then
    run docker compose up -d --build postgres server worker tag-worker
  else
    run docker compose --profile local-bge up -d --build
  fi
}

update_nodocker() {
  if [[ "$DRY_RUN" != "true" ]]; then
    command -v npm >/dev/null 2>&1 || fail "npm is required for no-Docker runtime"
  fi

  run npm ci
  run npm run build
  run bash scripts/stop-bash.sh
  run npm run db:migrate
  run bash scripts/start-bash.sh
}

update_plugin() {
  if [[ "$SKIP_PLUGIN" == "true" ]]; then
    log "skipping OpenClaw plugin reinstall"
    return
  fi

  if [[ "$DRY_RUN" == "true" ]] || command -v openclaw >/dev/null 2>&1; then
    run bash scripts/install-openclaw-plugin.sh --force
  else
    log "openclaw CLI not found; service updated, plugin reinstall skipped"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    local|openai)
      STRATEGY="$1"
      shift
      ;;
    --runtime)
      [[ $# -ge 2 && "${2:-}" != -* ]] || fail "--runtime requires docker or nodocker"
      RUNTIME="${2:-}"
      shift 2
      ;;
    --docker)
      RUNTIME="docker"
      shift
      ;;
    --no-docker)
      RUNTIME="nodocker"
      shift
      ;;
    --skip-plugin)
      SKIP_PLUGIN=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ "$RUNTIME" == "docker" || "$RUNTIME" == "nodocker" ]] || fail "invalid runtime: $RUNTIME"
[[ -f .env ]] || fail "missing .env; run the install bootstrap first"

detect_strategy
log "runtime: $RUNTIME"
log "embedding mode: $STRATEGY"

if [[ "$RUNTIME" == "docker" ]]; then
  update_docker
else
  update_nodocker
fi

update_plugin

host_port="$(read_env MEMSENSE_HOST_PORT)"
host_port="${host_port:-$(read_env MEMSENSE_PORT)}"
host_port="${host_port:-8787}"

log "update complete"
log "dashboard: http://127.0.0.1:${host_port}/dashboard?token=demo"
