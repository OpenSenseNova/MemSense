import test from 'node:test';
import assert from 'node:assert/strict';
import { DedupGate } from '../src/core/dedup.js';

test('DedupGate blocks duplicate content in window', () => {
  const gate = new DedupGate();
  const input = { tenantId: 't', scope: 'user', sessionId: 's', userId: 'u', content: 'same' };
  assert.equal(gate.accept(input).accepted, true);
  const second = gate.accept(input);
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'duplicate_in_window');
});

test('DedupGate key includes tenant/scope/session/user', () => {
  const gate = new DedupGate();
  assert.equal(gate.accept({ tenantId: 't1', scope: 'user', sessionId: 's', userId: 'u', content: 'same' }).accepted, true);
  assert.equal(gate.accept({ tenantId: 't2', scope: 'user', sessionId: 's', userId: 'u', content: 'same' }).accepted, true);
});
