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
- Tool aliases:
  - `memory_save`
  - `memory_search`
  - `memory_fetch_recent`
- Compatibility tools:
  - `memory_os_write`
  - `memory_os_retrieve`
  - `memory_os_list_recent`
  - `memory_os_search_by_time`
  - `memory_os_feedback`
  - `memory_os_promote_demote`
  - `memory_os_forget`
  - `memory_os_audit`

---

## Architecture (at a glance)

- **Plugin gateway** (`index.ts`) for OpenClaw tools
- **Backend API** (`src/server`) for memory services
- **Storage** (`memory_chunks`, `memory_chunk_embeddings`, `memory_events`)
- **Worker** (`src/worker`) for embedding jobs with retry/DLQ
- **Dashboard** (`/dashboard`) with token-based RBAC

---

## Quick Start

### 1) Start backend stack

```bash
docker compose up -d
```

### One-click local BGE deployment (auto model pull)

```bash
cp .env.example .env
bash scripts/start-local-bge.sh
```

> First startup may take longer because the BGE model is downloaded automatically.

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

## Security & Operations

- Dashboard RBAC via:
  - `MEMSENSE_DASHBOARD_TOKENS_JSON={"token_viewer":"viewer","token_ops":"operator","token_admin":"admin"}`
- Worker resilience:
  - queue claim with lock
  - exponential retry
  - DLQ fallback

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
