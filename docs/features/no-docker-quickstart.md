# No-Docker Quickstart

For environments where Docker is unavailable, Memsense supports local startup.

## Prerequisites

- Node.js + npm
- PostgreSQL (running and reachable)
- (Optional for local embedding) Python 3 with venv support

## One-click bootstrap (no docker)

```bash
cp .env.example .env
bash scripts/bootstrap-nodocker.sh
```

The script asks strategy:
- `openai`: use OpenAI-compatible embedding API
- `local`: start local BGE Python service automatically

## Runtime controls

```bash
bash scripts/run-local.sh
bash scripts/stop-local.sh
```

Logs:
- `.runtime/server.log`
- `.runtime/worker.log`
- `.runtime/bge.log` (if local BGE mode)
