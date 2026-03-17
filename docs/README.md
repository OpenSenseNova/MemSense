# Memsense Docs

This is the documentation hub for Memsense.

The top-level [`README.md`](../README.md) is the landing page: it tells the story, explains why Memsense exists, and helps new users get started quickly.

This `docs/` folder is for people who want to **go deeper**:
- understand how Memsense works
- learn the main system flows
- validate a local deployment
- study the operational and retrieval logic behind the product

---

## Reading guide

### If you're new here
Start with these in order:

1. [`../README.md`](../README.md) — product story + quick start
2. [`features/no-docker-quickstart.md`](features/no-docker-quickstart.md) — simplest local setup path
3. [`features/local-bge-oneclick.md`](features/local-bge-oneclick.md) — local embedding setup
4. [`features/api-smoke-test.md`](features/api-smoke-test.md) — verify the system is actually working

---

## Core system logic

These docs explain the main technical ideas behind Memsense.

- [`features/architecture-overview.md`](features/architecture-overview.md)  
  The full system flow: capture, enrichment, retrieval, selection, dashboard, and data movement.

- [`features/retrieval-algorithm.md`](features/retrieval-algorithm.md)  
  The ranking logic: dual recall, temporal scoring, hybrid weighting, and diversity-aware selection.

- [`features/embedding-search.md`](features/embedding-search.md)  
  A compact explanation of storage, embeddings, vector search, lexical signal, and hybrid rerank.

- [`features/worker-retry-dlq.md`](features/worker-retry-dlq.md)  
  How async enrichment works: job queueing, retries, and dead-letter handling.

- [`features/dashboard-rbac.md`](features/dashboard-rbac.md)  
  How the dashboard is organized and how token-based RBAC is enforced.

---

## Suggested mental model

You can understand Memsense in four layers:

1. **capture**  
   Online interaction history is captured into memory chunks.

2. **enrichment**  
   Embeddings, tags, and memory-type semantics are added asynchronously.

3. **retrieval**  
   Candidate memories are recalled from storage with semantic + lexical signals.

4. **selection**  
   Results are reranked for relevance, time-awareness, and lower redundancy.

This is the core logic behind the product story:
**from agent history to living memory**.

---

## For builders and researchers

If you want to study Memsense more deeply, focus on these themes:

- how agent interaction history becomes structured memory
- how retrieval improves beyond naive similarity top-k
- how async enrichment keeps write-path latency low
- how identity fields such as `session_id`, `agent_id`, and `user_id` support multi-agent and long-horizon use cases
- how the stored traces can become a foundation for replay, tuning, and future continual-learning workflows

---

## Documentation map

### Product / onboarding
- [`../README.md`](../README.md)
- [`features/no-docker-quickstart.md`](features/no-docker-quickstart.md)
- [`features/local-bge-oneclick.md`](features/local-bge-oneclick.md)

### Architecture / logic
- [`features/architecture-overview.md`](features/architecture-overview.md)
- [`features/retrieval-algorithm.md`](features/retrieval-algorithm.md)
- [`features/embedding-search.md`](features/embedding-search.md)

### Operations / reliability
- [`features/worker-retry-dlq.md`](features/worker-retry-dlq.md)
- [`features/dashboard-rbac.md`](features/dashboard-rbac.md)
- [`features/api-smoke-test.md`](features/api-smoke-test.md)

---

## Principle

- `README.md` sells the vision and gets people to try it.
- `docs/README.md` explains where to learn more.
- `docs/features/*.md` holds the concrete system details.
