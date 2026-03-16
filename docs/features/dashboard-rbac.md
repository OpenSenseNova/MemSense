# Dashboard & RBAC

Memsense provides a session-first dashboard at `/dashboard`.

## Capabilities
- Filter by tenant/scope/session/user
- Overview counts and latest memory records
- Archive/restore status operations

## Access control
Token-based RBAC:
- `viewer`: read overview
- `operator`: archive/restore
- `admin`: reserved

Configure with:
`MEMSENSE_DASHBOARD_TOKENS_JSON={"token":"viewer"}`
