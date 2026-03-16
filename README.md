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
- Search currently uses PostgreSQL lexical match (`ILIKE`) for v1; vector retrieval (`pgvector`) is not wired yet.
- Dashboard UI is not implemented yet (API/backend foundation is done first).
