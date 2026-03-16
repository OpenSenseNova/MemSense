# Local BGE One-Click Deployment

Memsense supports one-click local embedding deployment with automatic model download.

## Start

```bash
cp .env.example .env
bash scripts/start-local-bge.sh
```

## What happens

- Starts `postgres`, `server`, `worker`, and `bge` services.
- `bge` service (TEI) automatically pulls `BAAI/bge-large-zh-v1.5` on first run.
- Server/worker call local endpoint via `MEMSENSE_BGE_ENDPOINT=http://bge:8080/embed`.

## Verify

```bash
docker compose ps
docker compose logs -f bge
```

When model download finishes, semantic search works without external API keys.
