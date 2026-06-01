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

MEMSENSE_PORT="${MEMSENSE_PORT:-8787}"
MEMSENSE_EMBEDDING_PROVIDER="${MEMSENSE_EMBEDDING_PROVIDER:-openai}"
MEMSENSE_BGE_PORT="${MEMSENSE_BGE_PORT:-8080}"
MEMSENSE_BGE_HOST_PORT="${MEMSENSE_BGE_HOST_PORT:-8088}"
MEMSENSE_BGE_ENDPOINT="${MEMSENSE_BGE_ENDPOINT:-http://127.0.0.1:8080/embed}"

started=()

port_in_use() {
  local port="$1"
  command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

cleanup_started() {
  local name pid
  for name in "${started[@]:-}"; do
    if [[ -f ".runtime/${name}.pid" ]]; then
      pid="$(cat ".runtime/${name}.pid")"
      kill "$pid" 2>/dev/null || true
      rm -f ".runtime/${name}.pid"
    fi
  done
}

fail() {
  echo "[memsense] $*" >&2
  cleanup_started
  exit 1
}

require_node_deps() {
  if [[ ! -d node_modules ]]; then
    fail "missing node_modules; run 'npm ci' for no-Docker mode, or use Docker Compose with MEMSENSE_SERVICE_MODE=external"
  fi
  node -e "await import('express'); await import('pg')" >/dev/null 2>&1 \
    || fail "required Node dependencies are missing; run 'npm ci'"
}

start_detached() {
  local log_file="$1"
  shift
  : > "$log_file"
  if command -v setsid >/dev/null 2>&1; then
    nohup setsid "$@" > "$log_file" 2>&1 < /dev/null &
    echo "$!"
  elif command -v perl >/dev/null 2>&1; then
    perl -MPOSIX=setsid -e '
      my $log = shift @ARGV;
      my $pid = fork();
      die "fork failed: $!" unless defined $pid;
      if ($pid) { print "$pid\n"; exit 0; }
      setsid() or die "setsid failed: $!";
      open STDIN, "<", "/dev/null" or die "stdin: $!";
      open STDOUT, ">>", $log or die "stdout: $!";
      open STDERR, ">&", \*STDOUT or die "stderr: $!";
      exec @ARGV or die "exec failed: $!";
    ' "$log_file" "$@"
  else
    nohup "$@" > "$log_file" 2>&1 < /dev/null &
    echo "$!"
  fi
}

start_process() {
  local name="$1"
  shift
  local pid
  pid="$(start_detached ".runtime/${name}.log" "$@")"
  echo "$pid" > ".runtime/${name}.pid"
  started+=("$name")
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 80 ".runtime/${name}.log" || true
    fail "$name failed to start"
  fi
  echo "[memsense] $name started (pid: $pid)"
}

wait_http_ok() {
  local url="$1"
  local label="$2"
  local timeout="${3:-30}"
  local i
  for ((i = 1; i <= timeout; i++)); do
    if node -e "fetch(process.argv[1]).then(async r => { const j = await r.json().catch(() => ({})); process.exit(r.ok && j.ok === true ? 0 : 1); }).catch(() => process.exit(1));" "$url" >/dev/null 2>&1; then
      echo "[memsense] $label healthy at $url"
      return 0
    fi
    sleep 1
    if [[ -f ".runtime/${label}.pid" ]] && ! kill -0 "$(cat ".runtime/${label}.pid")" 2>/dev/null; then
      tail -n 80 ".runtime/${label}.log" || true
      fail "$label exited before becoming healthy"
    fi
  done
  tail -n 80 ".runtime/${label}.log" 2>/dev/null || true
  fail "$label did not become healthy at $url within ${timeout}s"
}

require_node_deps

if port_in_use "$MEMSENSE_PORT"; then
  fail "port $MEMSENSE_PORT is already in use; choose another MEMSENSE_PORT or stop the listener"
fi

export MEMSENSE_BGE_SAVE_DIR="${MEMSENSE_BGE_SAVE_DIR:-$ROOT_DIR/.models}"

if [[ "$MEMSENSE_EMBEDDING_PROVIDER" == "bge_http" ]]; then
  if [[ "$MEMSENSE_BGE_ENDPOINT" =~ ^https?://bge(:|/) ]]; then
    fail "MEMSENSE_BGE_ENDPOINT=$MEMSENSE_BGE_ENDPOINT points to a Docker Compose service name; start-bash.sh is for no-Docker local services. Use Docker Compose, or set MEMSENSE_BGE_ENDPOINT=http://127.0.0.1:${MEMSENSE_BGE_HOST_PORT}/embed"
  elif [[ "$MEMSENSE_BGE_ENDPOINT" =~ ^https?://(127\.0\.0\.1|localhost)(:|/) ]]; then
    if [[ ! -x "$ROOT_DIR/.venv-bge/bin/python" ]]; then
      fail "local BGE endpoint is configured but .venv-bge is missing; run scripts/bootstrap-nodocker.sh local first"
    fi
    if port_in_use "$MEMSENSE_BGE_PORT"; then
      fail "port $MEMSENSE_BGE_PORT is already in use; choose another MEMSENSE_BGE_PORT or stop the listener"
    fi
    start_process bge "$ROOT_DIR/.venv-bge/bin/python" scripts/bge_local_server.py
    wait_http_ok "http://127.0.0.1:${MEMSENSE_BGE_PORT}/healthz" bge 120
  else
    echo "[memsense] using externally managed BGE endpoint: $MEMSENSE_BGE_ENDPOINT"
  fi
fi

start_process server node src/server/index.js
wait_http_ok "http://127.0.0.1:${MEMSENSE_PORT}/healthz" server 45

start_process worker node src/worker/index.js
start_process tag-worker node src/worker/tag-worker.js

echo "[memsense] services started"
for name in "${started[@]}"; do
  echo "  - $name (pid: $(cat ".runtime/${name}.pid"))"
done
echo "[memsense] logs in $ROOT_DIR/.runtime/*.log"
