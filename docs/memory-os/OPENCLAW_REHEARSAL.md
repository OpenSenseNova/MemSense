# OpenClaw Integration Rehearsal (Isolated)

This runbook validates `memsense` in **link mode** without touching OpenClaw core code.

## 0) Preconditions

- OpenClaw CLI installed and working.
- Plugin source at:
  - `<path-to-memsense>`
- Optional: `jq` for pretty JSON checks.

---

## 1) Exact link-mode install

```bash
# from anywhere
openclaw plugins install -l <path-to-memsense>
openclaw plugins enable memsense
openclaw gateway restart
openclaw plugins list
```

Expected: `memsense` appears as enabled.

---

## 2) Config (isolated plugin slot)

Edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "memsense": {
        "enabled": true
      }
    },
    "slots": {
      "memory": "memsense"
    }
  }
}
```

Apply:

```bash
openclaw gateway restart
```

---

## 3) Rehearsal smoke test (non-destructive)

From plugin repo:

```bash
cd <path-to-memsense>
bash scripts/rehearsal-smoke.sh
```

What this validates:

1. **write** creates a memory id
2. **retrieve** returns the created memory for matching query
3. **feedback** writes an event
4. **audit** includes capture + feedback
5. **forget** deletes memory
6. **audit-after-forget** still contains lifecycle history
7. **degraded-path checks**:
   - retrieve on empty tenant/scope returns empty array
   - forget unknown memory returns `{ deleted: false }`
   - audit unknown memory returns empty list

All checks run against in-memory local engine and leave no persistent external state.

---

## 4) Optional live CLI sanity

If plugin is linked/enabled, verify CLI registration:

```bash
openclaw memsense:ping
# expected: memsense: ok
```

---

## 5) Rollback / clean exit

Disable and unlink plugin:

```bash
openclaw plugins disable memsense
openclaw plugins remove memsense
openclaw gateway restart
openclaw plugins list
```

If you edited `~/.openclaw/openclaw.json`, remove or revert:

- `plugins.entries.memsense`
- `plugins.slots.memory`

---

## 6) Fast troubleshooting

- Plugin not listed: rerun install with absolute path and check path exists.
- Command not found (`memsense:ping`): plugin not enabled or gateway not restarted.
- Smoke test fails: run `npm test` first, then rerun `bash scripts/rehearsal-smoke.sh`.
- Runtime mismatch: ensure OpenClaw version satisfies `peerDependencies.openclaw >=2026.3.1`.
