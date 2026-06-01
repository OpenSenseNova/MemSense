# Update Guide

> Docs → [MemSense Docs](../README.md)
> See also: [No-Docker Setup](no-docker-quickstart.md) · [API Smoke Test](api-smoke-test.md)

## Update MemSense

MemSense runs in your local/private environment. A remote repository update is not pushed into your machine automatically. To update, first pull the latest code yourself, then run the update script to rebuild the local runtime, apply database migrations, and refresh the OpenClaw plugin.

Update script strategy:

- Do not rewrite `.env`.
- Do not run `docker compose down -v`.
- Do not delete Docker volumes or local PostgreSQL data.
- Docker updates run database migrations automatically through the `server` container.
- Plugin reinstall is attempted only when the OpenClaw CLI is available; use `--skip-plugin` / `-SkipPlugin` to skip it.

---

## Docker update

The script detects the current embedding mode from `.env`. You can also pass `local` or `openai` explicitly.

macOS / Linux / WSL2:

```bash
bash scripts/update.sh
# or:
bash scripts/update.sh local
bash scripts/update.sh openai
```

Windows PowerShell:

```powershell
.\scripts\update.ps1
# or:
.\scripts\update.ps1 local
.\scripts\update.ps1 openai
```

What this does:

1. Rebuilds and restarts the Docker Compose services for the selected embedding mode.
2. Lets the `server` container run `npm run db:migrate` on startup.
3. Reinstalls and reconfigures the OpenClaw plugin if `openclaw` is available.

If you only want to update the service and leave the OpenClaw plugin unchanged:

```bash
bash scripts/update.sh --skip-plugin
```

```powershell
.\scripts\update.ps1 -SkipPlugin
```

---

## No-Docker update

No-Docker update is for macOS / Linux only. Windows no-Docker install is still being tested.

```bash
bash scripts/update.sh --runtime nodocker
```

After you pull the latest code yourself, these are the equivalent manual steps:

```bash
npm ci
npm run build
bash scripts/stop-bash.sh
npm run db:migrate
bash scripts/start-bash.sh
bash scripts/install-openclaw-plugin.sh --force
```

If your local BGE Python environment was never initialized, run the no-Docker setup first:

```bash
bash scripts/bootstrap-nodocker.sh local
bash scripts/start-bash.sh
```

---

## Verify after update

Docker:

```bash
docker compose ps
```

Dashboard:

```text
http://127.0.0.1:8787/dashboard?token=demo
```

If you use a custom `MEMSENSE_HOST_PORT`, replace `8787` with that port.

API smoke test:

```bash
MEMSENSE_SMOKE_BASE_URL=http://127.0.0.1:8787 \
MEMSENSE_SMOKE_TOKEN=demo \
npm run smoke:api
```

---

## Data safety

Updating code and rebuilding services does not delete memory data.

- Docker data stays in Docker volumes such as `memsense-pg` and `memsense-hf`.
- No-Docker data stays in your local PostgreSQL database and local model/cache directories.

Do not run `docker compose down -v` unless you intentionally want to remove Docker volumes and reset local data.
