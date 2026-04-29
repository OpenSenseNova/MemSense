# Embedding & Search

> Docs → [Memsense Docs](../README.md)  
> See also: [Architecture Overview](architecture-overview.md) · [Retrieval Algorithm](retrieval-algorithm.md)

## What this page is for

This page gives a compact summary of how Memsense stores embeddings and performs search.

---

## What it does

- save flow writes cleaned QA chunk metadata into `memory_chunks`
- structured metadata noise is stripped before ingest
- worker computes full/user/assistant/next-user/facet embeddings and stores vectors in `memory_chunk_embeddings`
- search uses 8-route recall, SQL RRF fusion, session-first hybrid selection when session chunks are present, and MMR diversity selection

---

## Configuration

- OpenAI-compatible: `MEMSENSE_EMBEDDING_PROVIDER=openai`
- Local BGE: `MEMSENSE_EMBEDDING_PROVIDER=bge_http`

---

## Output

Search returns ranked chunks with fields such as:
- `final_score`
- `rrf_score`
- `routes`
- `explain`

---

## Next pages

- Read [Retrieval Algorithm](retrieval-algorithm.md) for scoring details.
- Read [Architecture Overview](architecture-overview.md) for the full system flow.
