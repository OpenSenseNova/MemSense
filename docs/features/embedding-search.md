# Embedding & Search

> Docs → [Memsense Docs](../README.md)  
> See also: [Architecture Overview](architecture-overview.md) · [Retrieval Algorithm](retrieval-algorithm.md)

## What this page is for

This page gives a compact summary of how Memsense stores embeddings and performs search.

---

## What it does

- save flow writes cleaned QA chunk metadata into `memory_chunks`
- structured metadata noise is stripped before ingest
- worker computes embeddings and stores vectors in `memory_chunk_embeddings`
- search uses vector similarity + lexical signal + hybrid rerank

---

## Configuration

- OpenAI-compatible: `MEMSENSE_EMBEDDING_PROVIDER=openai`
- Local BGE: `MEMSENSE_EMBEDDING_PROVIDER=bge_http`

---

## Output

Search returns ranked chunks with fields such as:
- `final_score`
- `vector_score`
- `lexical_score`
- `explain`

---

## Next pages

- Read [Retrieval Algorithm](retrieval-algorithm.md) for scoring details.
- Read [Architecture Overview](architecture-overview.md) for the full system flow.
