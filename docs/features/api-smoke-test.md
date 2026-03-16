# API Smoke Test

Run this against a live Memsense deployment to verify the main HTTP surface.

## Command

```bash
MEMSENSE_SMOKE_BASE_URL=http://127.0.0.1:8787 \
MEMSENSE_SMOKE_TOKEN=demo \
npm run smoke:api
```

## Covered endpoints

- `GET /healthz`
- `GET /v1/system/setup-status`
- `GET /v1/dashboard/pipeline_status`
- `POST /v1/memory/fetch_recent`
- `POST /v1/memory/search`
- `POST /v1/dashboard/overview`

This is intended as a real runtime smoke test after deployment or after merging PRs.
