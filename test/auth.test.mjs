import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuth } from '../src/server/auth.js';

function runMw(mw, req) {
  return new Promise((resolve) => {
    const res = {
      code: 200,
      body: null,
      status(c) { this.code = c; return this; },
      json(b) { this.body = b; resolve({ code: this.code, body: this.body }); },
    };
    mw(req, res, () => resolve({ code: 200, body: { ok: true } }));
  });
}

test('auth middleware denies missing token', async () => {
  process.env.MEMSENSE_DASHBOARD_TOKENS_JSON = JSON.stringify({ t1: 'viewer' });
  const { requireRole } = createAuth();
  const out = await runMw(requireRole('viewer'), { headers: {}, query: {} });
  assert.equal(out.code, 401);
});

test('auth middleware allows sufficient role', async () => {
  process.env.MEMSENSE_DASHBOARD_TOKENS_JSON = JSON.stringify({ t2: 'admin' });
  const { requireRole } = createAuth();
  const out = await runMw(requireRole('operator'), { headers: { 'x-memsense-token': 't2' }, query: {} });
  assert.equal(out.code, 200);
});
