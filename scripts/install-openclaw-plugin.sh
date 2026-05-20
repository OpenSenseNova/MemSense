#!/usr/bin/env bash
# Install the MemSense plugin into OpenClaw (Quick Start steps 3–5).
# Usage: bash scripts/install-openclaw-plugin.sh [--force] [--dry-run] [--plugin-path <path>]
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
DRY_RUN=false
FORCE=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)   DRY_RUN=true;  shift ;;
    --force)     FORCE=true;    shift ;;
    --plugin-path)
      PLUGIN_PATH="$(cd "$2" && pwd)"
      shift 2
      ;;
    *)
      echo "[memsense] unknown option: $1" >&2
      echo "Usage: $0 [--force] [--dry-run] [--plugin-path <path>]" >&2
      exit 1
      ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────
run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[memsense] (dry-run) $*"
  else
    echo "[memsense] running: $*"
    "$@"
  fi
}

# ── Step 0: Check prerequisites ───────────────────────────────────────────────
echo "[memsense] checking prerequisites..."
if ! command -v openclaw >/dev/null 2>&1; then
  echo "[memsense] error: 'openclaw' CLI not found on \$PATH." >&2
  echo "[memsense] Install OpenClaw and make sure it is on your PATH, then retry." >&2
  exit 1
fi
echo "[memsense] openclaw CLI found: $(command -v openclaw)"

# ── Step 1: Build the plugin ──────────────────────────────────────────────────
if [[ "$FORCE" == "true" ]] || [[ ! -d "$PLUGIN_PATH/dist" ]]; then
  echo "[memsense] building plugin (npm ci && npm run build)..."
  run npm --prefix "$PLUGIN_PATH" ci
  run npm --prefix "$PLUGIN_PATH" run build
else
  echo "[memsense] dist/ already exists; skipping build (pass --force to rebuild)"
fi

# ── Step 2: Install & enable ──────────────────────────────────────────────────
echo "[memsense] installing plugin into OpenClaw..."
run openclaw plugins install -l --dangerously-force-unsafe-install "$PLUGIN_PATH"

echo "[memsense] enabling plugin..."
run openclaw plugins enable memsense

# ── Step 3: Grant conversation access ─────────────────────────────────────────
echo "[memsense] granting conversation access (allowConversationAccess)..."
run openclaw config set plugins.entries.memsense.hooks.allowConversationAccess true

# ── Step 4: Bind the memory slot ──────────────────────────────────────────────
echo "[memsense] binding memory slot..."
run openclaw config set plugins.entries.memsense.enabled true
run openclaw config set plugins.slots.memory memsense

# ── Step 5: Restart the gateway ───────────────────────────────────────────────
echo "[memsense] restarting OpenClaw gateway..."
run openclaw gateway restart

# ── Step 6: Verify ────────────────────────────────────────────────────────────
echo "[memsense] verifying installation..."
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[memsense] (dry-run) openclaw plugins list | grep memsense"
else
  if openclaw plugins list 2>/dev/null | grep -q "memsense"; then
    echo "[memsense] memsense plugin found in plugin list ✓"
  else
    echo "[memsense] warning: memsense not found in 'openclaw plugins list' — check gateway logs" >&2
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│               MemSense plugin installed ✓                   │"
echo "├─────────────────────────────────────────────────────────────┤"
echo "│  plugin path : ${PLUGIN_PATH}"
echo "│  config keys set:                                           │"
echo "│    plugins.entries.memsense.hooks.allowConversationAccess   │"
echo "│    plugins.entries.memsense.enabled                         │"
echo "│    plugins.slots.memory = memsense                          │"
echo "├─────────────────────────────────────────────────────────────┤"
echo "│  Next step: open the MemSense dashboard                     │"
echo "│    http://127.0.0.1:8787/dashboard?token=demo               │"
echo "└─────────────────────────────────────────────────────────────┘"