# No-Docker Setup

> Docs → [MemSense Docs](../README.md)
> See also: [Local BGE One-Click Deployment](local-bge-oneclick.md) · [API Smoke Test](api-smoke-test.md)

## What this page is for

This page covers the advanced setup path for macOS / Linux environments where Docker is unavailable. The main README uses Docker as the recommended path because it brings up Postgres, the API server, workers, and local BGE together.

Windows no-Docker setup is still being tested. Windows users should use Docker Desktop and the PowerShell commands in the main README.

---

## Prerequisites

- Node.js 20+ and npm
- PostgreSQL 16+ with `pgvector`
- Python 3.11+ with venv support for local BGE embedding

On macOS, the bootstrap script can install PostgreSQL and pgvector through Homebrew. On Linux, install PostgreSQL, pgvector, Python, and venv support with your system package manager first.

---

## Choose an embedding mode

Run one setup path.

### Local embedding

```bash
bash scripts/bootstrap-nodocker.sh local
bash scripts/start-bash.sh
```

This installs dependencies, initializes the database, prepares the local BGE Python service, and starts the server, embedding worker, tag worker, and BGE service.

### OpenAI-compatible embedding

Set `MEMSENSE_OPENAI_API_KEY` in `.env`, then run:

```bash
bash scripts/bootstrap-nodocker.sh openai
bash scripts/start-bash.sh
```

This installs dependencies, initializes the database, and starts the server, embedding worker, and tag worker.

---

## Runtime controls

```bash
bash scripts/start-bash.sh
bash scripts/stop-bash.sh
```

Logs:
- `.runtime/server.log`
- `.runtime/worker.log`
- `.runtime/tag-worker.log`
- `.runtime/bge.log` (if local BGE mode)

---

## Next pages

- Read [Local BGE One-Click Deployment](local-bge-oneclick.md) for local embedding details.
- Read [API Smoke Test](api-smoke-test.md) to verify the deployment.
