# API Smoke Test

> Docs → [Memsense Docs](../README.md)  
> See also: [No-Docker Quickstart](no-docker-quickstart.md) · [Dashboard & RBAC](dashboard-rbac.md)

## What this page is for

This page provides a minimal runtime verification step after deployment or after important changes.

---

## Command

```bash
MEMSENSE_SMOKE_BASE_URL=http://127.0.0.1:8787 \
MEMSENSE_SMOKE_TOKEN=demo \
npm run smoke:api
```

---

## Covered endpoints

- `GET /healthz`
- `GET /v1/system/setup-status`
- `GET /v1/dashboard/pipeline_status`
- `POST /v1/memory/fetch_recent`
- `POST /v1/memory/search`
- `POST /v1/dashboard/overview`

This is intended as a real runtime smoke test after deployment or after merging PRs.

---

## Next pages

- Read [Dashboard & RBAC](dashboard-rbac.md) for dashboard access and roles.
- Read [Worker / Retry / DLQ](worker-retry-dlq.md) for background processing reliability.
