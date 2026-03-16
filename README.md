# memory-os-openclaw-plugin

Memory OS plugin scaffold for OpenClaw.

## What is implemented now
- Plugin id: `memory-os-fast`
- Tools:
  - v1 aliases: `memory_save`, `memory_search`, `memory_fetch_recent`
  - compatibility: `memory_os_write`, `memory_os_retrieve`, `memory_os_list_recent`, `memory_os_search_by_time`
  - `memory_os_feedback`
  - `memory_os_promote_demote`
  - `memory_os_forget`
  - `memory_os_audit`
- Local mode engine (`src/local-engine.js`) for quick local test.

## Local test
```bash
cd memory-os-openclaw-plugin
npm test
```

## Install into local OpenClaw (linked dev mode)
```bash
openclaw plugins install -l /Users/yaotiankuo/.openclaw/workspace/memory-os-openclaw-plugin
openclaw plugins enable memory-os-fast
openclaw gateway restart
openclaw plugins list
```

## Config suggestion (`~/.openclaw/openclaw.json`)
```json
{
  "plugins": {
    "entries": {
      "memory-os-fast": {
        "enabled": true,
        "config": {
          "enabled": true,
          "localMode": true,
          "timeoutMs": 180,
          "maxTopK": 8
        }
      }
    },
    "slots": {
      "memory": "memory-os-fast"
    }
  }
}
```

## Production migration status

✅ Done in this repo now:
- Plugin tools call a real HTTP backend (`MEMSENSE_API_URL`) instead of local in-memory store.
- Added `memsense-server` with PostgreSQL persistence.
- Added DB schema + migration script.
- Added docker-compose for local production-like startup.

⚠️ Remaining placeholder(s) (explicitly tracked):
- Dashboard auth is token-based RBAC for v1 (no SSO/OAuth yet).
- Worker retry/DLQ is implemented, but advanced ops panel for DLQ replay is not implemented yet.

## Dashboard RBAC

Set token-role mapping via env:

`MEMSENSE_DASHBOARD_TOKENS_JSON={"token_viewer":"viewer","token_ops":"operator","token_admin":"admin"}`

Role levels:
- `viewer`: can read overview
- `operator`: can archive/restore status
- `admin`: reserved for future privileged operations

## Embedding config (production)

Memsense now uses vector retrieval (pgvector). Configure one embedding provider:

### A) OpenAI-compatible (recommended for Qwen embedding)
- `MEMSENSE_EMBEDDING_PROVIDER=openai`
- `MEMSENSE_OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1` (or your compatible endpoint)
- `MEMSENSE_OPENAI_API_KEY=...`
- `MEMSENSE_EMBEDDING_MODEL=text-embedding-v4`

### B) Local BGE HTTP service
- `MEMSENSE_EMBEDDING_PROVIDER=bge_http`
- `MEMSENSE_BGE_ENDPOINT=http://127.0.0.1:8000/embed`
- `MEMSENSE_BGE_MODEL=bge-large-zh-v1.5`

Both save/search will call the configured embedding provider.

## Retrieval strategy (current)

- Vector recall with pgvector
- Lexical signal (`ILIKE`) for keyword boost
- Hybrid rerank (vector + lexical + memory_score + confidence)
- Returned results include `final_score` and `explain` fields for observability
