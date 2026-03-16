# Memsense Architecture (refined)

## Layers

1. **Plugin Gateway (`index.ts`)**
   - OpenClaw tool surface only
   - request validation + trace id + backend API dispatch

2. **Backend API (`src/server/app.js`)**
   - REST routes for memory CRUD/search/dashboard
   - stateless, horizontally scalable

3. **Domain Service (`src/server/service.js`)**
   - memory write/search/fetch logic
   - status transitions (active/archived/deleted)
   - audit event writes

4. **Embedding Layer (`src/server/embedding/client.js`)**
   - provider abstraction: `openai-compatible` / `bge_http`
   - stable return shape for vector retrieval pipeline

5. **Persistence Layer (PostgreSQL + pgvector)**
   - `memory_chunks`
   - `memory_chunk_embeddings`
   - `memory_events`

6. **Dashboard (`/dashboard`)**
   - session-first operational view
   - filter/search/status operation

## What we borrowed from OpenViking style

- clear separation between API/domain/storage
- config-driven provider adapters
- filesystem-like observability mindset (session-first traceability)
- explicit docs for architecture and deployment path

## Explicitly unfinished items

- Advanced retrieval rerank (hybrid + cross-encoder) not yet done
- Dedicated worker (retry/DLQ) is done; DLQ replay UI/tooling not yet done
- Dashboard auth + RBAC is done with token roles; SSO/OAuth not yet done
- SLA/metrics alerting not yet done
