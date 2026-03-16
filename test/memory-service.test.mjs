import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService } from '../src/tools/memory-service.js';

test('MemoryService dedups near-duplicate writes in window', () => {
  const service = new MemoryService();
  const first = service.save({ tenantId: 't1', scope: 'user', content: 'remember this' });
  const second = service.save({ tenantId: 't1', scope: 'user', content: 'remember this' });
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.deduped, true);
});
