# Local BGE One-Click Deployment

> Docs → [Memsense Docs](../README.md)  
> See also: [No-Docker Quickstart](no-docker-quickstart.md) · [Embedding & Search](embedding-search.md)

## What this page is for

This page explains how to run Memsense with local embedding and automatic model download.

---

## Start

```bash
cp .env.example .env
bash scripts/bootstrap.sh local
```

---

## What happens

- starts `postgres`, `server`, `worker`, and `bge`
- `bge` automatically pulls `BAAI/bge-large-zh-v1.5` on first run
- server / worker call the local endpoint via `MEMSENSE_BGE_ENDPOINT=http://bge:8080/embed`

---

## Verify

```bash
docker compose ps
docker compose logs -f bge
```

When model download finishes, semantic search works without external API keys.

---

## Next pages

- Read [No-Docker Quickstart](no-docker-quickstart.md) for non-Docker environments.
- Read [Embedding & Search](embedding-search.md) for retrieval behavior.
