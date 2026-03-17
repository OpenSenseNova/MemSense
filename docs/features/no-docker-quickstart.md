# No-Docker Quickstart

> Docs → [Memsense Docs](../README.md)  
> See also: [Local BGE One-Click Deployment](local-bge-oneclick.md) · [API Smoke Test](api-smoke-test.md)

## What this page is for

This page is the fastest setup path for environments where Docker is unavailable.

---

## Prerequisites

- Node.js + npm
- PostgreSQL (running and reachable)
- optional: Python 3 with venv support for local embedding

---

## One-click bootstrap

```bash
cp .env.example .env
bash scripts/bootstrap-nodocker.sh
```

The script asks which embedding strategy you want:
- `openai` — use an OpenAI-compatible embedding API
- `local` — start local BGE automatically

---

## Runtime controls

```bash
bash scripts/run-local.sh
bash scripts/stop-local.sh
```

Logs:
- `.runtime/server.log`
- `.runtime/worker.log`
- `.runtime/bge.log` (if local BGE mode)

---

## Next pages

- Read [Local BGE One-Click Deployment](local-bge-oneclick.md) for local embedding details.
- Read [API Smoke Test](api-smoke-test.md) to verify the deployment.
