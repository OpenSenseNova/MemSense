<div align="center">

# Memsense

<p><strong>Production-ready memory system for OpenClaw agents</strong></p>
<p>Vector retrieval · Hybrid rerank · Async worker · Operational dashboard</p>

<p>
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-4f46e5" />
  <img alt="status" src="https://img.shields.io/badge/status-beta-0ea5e9" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e" />
  <img alt="deployment" src="https://img.shields.io/badge/deployment-self--hosted-f59e0b" />
</p>

<p>
  <img alt="pricing" src="https://img.shields.io/badge/pricing-open--source%20%7C%20infra--cost%20only-111827" />
</p>

</div>

---

## Why Memsense

Memsense is built for real agent workloads:

- **Long-term memory that scales** (PostgreSQL + pgvector)
- **Better retrieval quality** (vector + lexical + hybrid rerank)
- **Reliable write path** (async worker, retry, DLQ)
- **Operational visibility** (session-first dashboard + RBAC)
- **OpenClaw-native integration** (memory slot plugin)

---

## Core Capabilities

- OpenClaw plugin id: `memsense`
- Exposed tools:
  - `memory_save` (QA-only; captures latest session history with optional `k`, default 5; model does not pass session_id)
  - `memory_search`
  - `memory_fetch_recent`

---

## Architecture (at a glance)

- **Plugin gateway** (`index.ts`) for OpenClaw tools
- **Backend API** (`src/server`) for memory services
- **Storage** (`memory_chunks`, `memory_chunk_embeddings`, `memory_events`)
- **Worker** (`src/worker`) for embedding + async tagging jobs (retry/DLQ)
- **Dashboard** (`/dashboard`) with token-based RBAC

---

## Quick Start

### 1) One-click bootstrap (recommended)

**Docker available:**

```bash
cp .env.example .env
bash scripts/bootstrap.sh
```

**No Docker environment:**

```bash
cp .env.example .env
bash scripts/bootstrap-nodocker.sh
```

Both commands will ask you to choose embedding strategy:
- `openai` (OpenAI-compatible / Qwen embedding API)
- `local` (local BGE)

Non-interactive:

```bash
bash scripts/bootstrap.sh openai
bash scripts/bootstrap.sh local

bash scripts/bootstrap-nodocker.sh openai
bash scripts/bootstrap-nodocker.sh local
```

For **no-docker mode**, the bootstrap script will automatically normalize `.env` to localhost defaults:
- `MEMSENSE_DATABASE_URL=postgresql://127.0.0.1:5432/memsense`
- `MEMSENSE_BGE_ENDPOINT=http://127.0.0.1:8080/embed`

> Local mode first startup may take longer because the BGE model is downloaded automatically.

### Optional: run as persistent macOS services (launchd)

For no-docker deployments on macOS, you can install persistent user services:

```bash
bash scripts/install-launchd.sh
```

This installs and loads three LaunchAgents:
- `local.memsense.bge`
- `local.memsense.server`
- `local.memsense.worker`

Logs are written to:
- `.runtime/launchd-bge.out.log`
- `.runtime/launchd-bge.err.log`
- `.runtime/launchd-server.out.log`
- `.runtime/launchd-server.err.log`
- `.runtime/launchd-worker.out.log`
- `.runtime/launchd-worker.err.log`

To uninstall them later:

```bash
bash scripts/uninstall-launchd.sh
```

### 2) Install plugin into OpenClaw

```bash
openclaw plugins install -l <path-to-memsense>
openclaw plugins enable memsense
openclaw gateway restart
openclaw plugins list
```

### 3) Bind memory slot

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "memsense": { "enabled": true }
    },
    "slots": {
      "memory": "memsense"
    }
  }
}
```

---

## Embedding Provider Configuration

Memsense supports two modes:

### OpenAI-compatible (recommended for Qwen embedding)

- `MEMSENSE_EMBEDDING_PROVIDER=openai`
- `MEMSENSE_OPENAI_BASE_URL=...`
- `MEMSENSE_OPENAI_API_KEY=...`
- `MEMSENSE_EMBEDDING_MODEL=...`

### Local BGE HTTP

- `MEMSENSE_EMBEDDING_PROVIDER=bge_http`
- `MEMSENSE_BGE_ENDPOINT=http://127.0.0.1:8000/embed`
- `MEMSENSE_BGE_MODEL=bge-large-zh-v1.5`

---

## Enter Dashboard

Dashboard includes a **Tool Playground** panel to test real API calls for:
- `memory_search` (`/v1/memory/search`)
- `memory_fetch_recent` (`/v1/memory/fetch_recent`)


After startup, open:

- `http://127.0.0.1:8787/dashboard?token=<your_token>`

If you expose a different port/host, replace accordingly.

Token is configured by:

- `MEMSENSE_DASHBOARD_TOKENS_JSON={"token_viewer":"viewer","token_ops":"operator","token_admin":"admin"}`

Examples:

- Viewer access: `http://127.0.0.1:8787/dashboard?token=token_viewer`
- Operator access: `http://127.0.0.1:8787/dashboard?token=token_ops`

---

## Security & Operations

- Dashboard RBAC via token roles (`viewer` / `operator` / `admin`)
- Worker resilience:
  - queue claim with lock
  - exponential retry
  - DLQ fallback
- Async tag enrichment (user-invisible):
  - tag jobs run in background
  - uses OpenClaw agent command internally for tag generation

---

## Feature Docs

- `docs/features/embedding-search.md`
- `docs/features/dashboard-rbac.md`
- `docs/features/worker-retry-dlq.md`

(Internal deep-dive engineering docs are kept in Obsidian.)

---

## Local Validation

```bash
npm test
```
