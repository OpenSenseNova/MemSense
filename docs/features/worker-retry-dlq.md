# Worker / Retry / DLQ

Embedding and tag enrichment are processed asynchronously by independent workers.

## Flow
1. Save request inserts chunk
2. Save request enqueues `embedding_jobs`
3. Worker claims jobs with `FOR UPDATE SKIP LOCKED`
4. On success: mark done and write vector
5. On failure: retry with backoff; max attempts -> `embedding_dlq`

## Why
- Avoid blocking write path
- Better reliability under model/network errors
- Operationally traceable failures
