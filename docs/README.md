# Memsense Docs

> Docs hub for onboarding, architecture, retrieval, and operations.

**Start here:** [`../README.md`](../README.md)

---

## Reading paths

### 1) I want to try Memsense quickly
- [`../README.md`](../README.md) — product story + quick start
- [`features/no-docker-quickstart.md`](features/no-docker-quickstart.md) — simplest local path without Docker
- [`features/local-bge-oneclick.md`](features/local-bge-oneclick.md) — local embedding setup
- [`features/api-smoke-test.md`](features/api-smoke-test.md) — verify the system is actually working

### 2) I want to understand how it works
- [`features/architecture-overview.md`](features/architecture-overview.md) — the full system flow
- [`features/retrieval-algorithm.md`](features/retrieval-algorithm.md) — ranking and selection logic
- [`features/embedding-search.md`](features/embedding-search.md) — compact retrieval/storage summary

### 3) I want to operate or debug it
- [`features/dashboard-rbac.md`](features/dashboard-rbac.md) — dashboard surfaces and access control
- [`features/worker-retry-dlq.md`](features/worker-retry-dlq.md) — async jobs, retry, DLQ
- [`features/api-smoke-test.md`](features/api-smoke-test.md) — runtime verification

---

## System mental model

Memsense can be understood in four layers:

1. **capture** — online interaction becomes memory chunks
2. **enrichment** — embeddings, tags, and memory semantics are added
3. **retrieval** — candidates are recalled with semantic + lexical signals
4. **selection** — results are reranked for relevance, time-awareness, and diversity

That is the system meaning of:

**From agent history to living memory.**

---

## Documentation map

| Area | Page | What it covers |
|---|---|---|
| Product | [`../README.md`](../README.md) | Vision, story, quick start |
| Setup | [`features/no-docker-quickstart.md`](features/no-docker-quickstart.md) | Local startup without Docker |
| Setup | [`features/local-bge-oneclick.md`](features/local-bge-oneclick.md) | Local embedding service |
| Architecture | [`features/architecture-overview.md`](features/architecture-overview.md) | System flow and data movement |
| Retrieval | [`features/retrieval-algorithm.md`](features/retrieval-algorithm.md) | Dual recall, scoring, MMR-style selection |
| Retrieval | [`features/embedding-search.md`](features/embedding-search.md) | Compact search/storage summary |
| Ops | [`features/dashboard-rbac.md`](features/dashboard-rbac.md) | Dashboard surfaces and RBAC |
| Ops | [`features/worker-retry-dlq.md`](features/worker-retry-dlq.md) | Worker reliability and job lifecycle |
| Validation | [`features/api-smoke-test.md`](features/api-smoke-test.md) | Runtime verification |

---

## Documentation principles

- `README.md` sells the vision and gets people to try it.
- `docs/README.md` tells people where to go next.
- `docs/features/*.md` explains one concrete part of the system at a time.
