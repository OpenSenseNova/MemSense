# Dashboard & RBAC

> Docs → [Memsense Docs](../README.md)  
> See also: [Architecture Overview](architecture-overview.md) · [API Smoke Test](api-smoke-test.md)

## What this page is for

This page explains the dashboard surface and the token-based access model.

---

## Dashboard capabilities

Memsense provides a session-first dashboard at `/dashboard`.

Main capabilities:
- filter by tenant / scope / session / user
- inspect overview counts and recent records
- view memory metadata and status
- perform archive / restore style status operations

---

## Access control

Dashboard access uses token-based RBAC.

Roles:
- `viewer` — read overview and inspect data
- `operator` — perform status operations such as archive / restore
- `admin` — reserved

Configuration example:

```text
MEMSENSE_DASHBOARD_TOKENS_JSON={"token":"viewer"}
```

---

## Why it exists

The dashboard is the operational window into the memory system.
It helps teams:
- inspect what is being stored
- debug retrieval inputs and outputs
- verify worker progress and memory state
- operate the system without reading raw tables directly

---

## Next pages

- Read [Architecture Overview](architecture-overview.md) for the full system flow.
- Read [API Smoke Test](api-smoke-test.md) for runtime verification.
