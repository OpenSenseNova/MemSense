import test from 'node:test';
import assert from 'node:assert/strict';
import { assert as helperAssert, summarizeResult } from '../scripts/rehearsal-helpers.mjs';

test('helper assert throws on falsy condition', () => {
  assert.throws(() => helperAssert(false, 'boom'), /boom/);
});

test('summarizeResult returns expected shape', () => {
  const out = summarizeResult({
    writtenId: 'mem_123',
    retrievedCount: 1,
    auditCountBeforeForget: 2,
    auditCountAfterForget: 3,
  });
  assert.equal(out.ok, true);
  assert.equal(out.writtenId, 'mem_123');
  assert.equal(typeof out.timestamp, 'string');
});
