import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService } from '../src/tools/memory-service.js';

test('captureTurn saves when explicit trigger hit', () => {
  const service = new MemoryService();
  const r = service.captureTurn({
    tenantId: 't1',
    scope: 'user',
    sessionId: 's1',
    userId: 'u1',
    userText: '记住这个：我的偏好是短回答',
    assistantText: '收到',
  });
  assert.equal(r.accepted, true);
  const items = service.fetchRecent({ tenantId: 't1', scope: 'user', sessionId: 's1' });
  assert.equal(items.length, 1);
});

test('captureTurn skips when no trigger hit', () => {
  const service = new MemoryService();
  const r = service.captureTurn({
    tenantId: 't1',
    userText: '今天天气不错',
    assistantText: '是的',
  });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'no_trigger');
});
