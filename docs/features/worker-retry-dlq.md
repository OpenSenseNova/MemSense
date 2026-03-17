# Worker / Retry / DLQ

> Docs → [Memsense Docs](../README.md)  
> See also: [Architecture Overview](architecture-overview.md) · [API Smoke Test](api-smoke-test.md)

## What this page is for

This page explains how async enrichment works and how Memsense handles failures.

---

## Why async workers exist

Embedding and tag enrichment are processed asynchronously by independent workers.

This keeps the write path fast while still allowing:
- semantic retrieval
- tag enrichment
- memory-type classification
- retryable background processing

---

## Job lifecycle

1. save request inserts chunk
2. save request enqueues `embedding_jobs`
3. save request enqueues `tag_jobs`
4. worker claims jobs with `FOR UPDATE SKIP LOCKED`
5. on success: mark done and write outputs
6. on failure: retry with backoff
7. after max attempts: move to DLQ

---

## Why retry / DLQ matter

They make the system more reliable when model calls or network calls fail.

Benefits:
- avoid blocking writes on transient failures
- keep failures operationally visible
- make retries explicit instead of silent
- preserve bad jobs for inspection after max attempts

---

## Next pages

- Read [Architecture Overview](architecture-overview.md) for where workers sit in the full system.
- Read [API Smoke Test](api-smoke-test.md) for validation after deployment.
