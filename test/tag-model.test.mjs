import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTags } from '../src/worker/tag-model.js';

test('mergeTags merges and dedups', () => {
  const out = mergeTags(['a', 'b'], ['b', 'c']);
  assert.deepEqual(out, ['a', 'b', 'c']);
});
