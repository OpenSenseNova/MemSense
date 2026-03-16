# Embedding & Search

Memsense uses PostgreSQL + pgvector for semantic retrieval.

## What it does
- Save flow writes cleaned QA chunk metadata into `memory_chunks`.
- Structured metadata noise is stripped before ingest (session/agent/tool wrappers are not stored as memory text).
- Worker computes embeddings and stores vectors in `memory_chunk_embeddings`.
- Search uses vector similarity + lexical signal + hybrid rerank.

## Config
- OpenAI-compatible: `MEMSENSE_EMBEDDING_PROVIDER=openai`
- Local BGE: `MEMSENSE_EMBEDDING_PROVIDER=bge_http`

## Output
Search returns ranked chunks with `final_score` and `explain` fields.
