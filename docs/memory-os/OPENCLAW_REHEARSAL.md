# OpenClaw Integration Rehearsal (Isolated)

This runbook validates `memory-os-openclaw-plugin` in **link mode** without touching OpenClaw core code.

## 0) Preconditions

- OpenClaw CLI installed and working.
- Plugin source at:
  - `/Users/yaotiankuo/.openclaw/workspace/memory-os-openclaw-plugin`
- Optional: `jq` for pretty JSON checks.

---

## 1) Exact link-mode install

```bash
# from anywhere
openclaw plugins install -l /Users/yaotiankuo/.openclaw/workspace/memory-os-openclaw-plugin
openclaw plugins enable memory-os-fast
openclaw gateway restart
openclaw plugins list
```

Expected: `memory-os-fast` appears as enabled.

---

## 2) Config (isolated plugin slot)

Edit `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "memory-os-fast": {
        "enabled": true,
        "config": {
          "enabled": true,
          "localMode": true,
          "timeoutMs": 180,
          "maxTopK": 8
        }
      }
    },
    "slots": {
      "memory": "memory-os-fast"
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
cd /Users/yaotiankuo/.openclaw/workspace/memory-os-openclaw-plugin
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
openclaw memory-os:ping
# expected: memory-os-fast: ok
```

---

## 5) Rollback / clean exit

Disable and unlink plugin:

```bash
openclaw plugins disable memory-os-fast
openclaw plugins remove memory-os-fast
openclaw gateway restart
openclaw plugins list
```

If you edited `~/.openclaw/openclaw.json`, remove or revert:

- `plugins.entries.memory-os-fast`
- `plugins.slots.memory`

---

## 6) Fast troubleshooting

- Plugin not listed: rerun install with absolute path and check path exists.
- Command not found (`memory-os:ping`): plugin not enabled or gateway not restarted.
- Smoke test fails: run `npm test` first, then rerun `bash scripts/rehearsal-smoke.sh`.
- Runtime mismatch: ensure OpenClaw version satisfies `peerDependencies.openclaw >=2026.3.1`.
