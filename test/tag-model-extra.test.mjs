import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTags } from '../src/worker/tag-model.js';

test('mergeTags trims to 20 unique tags max', () => {
  const existing = Array.from({ length: 15 }, (_, i) => `e${i}`);
  const generated = Array.from({ length: 15 }, (_, i) => `g${i}`);
  const out = mergeTags(existing, generated);
  assert.equal(out.length, 20);
  assert.equal(new Set(out).size, 20);
});
