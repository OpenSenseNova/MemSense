import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalMemoryStore } from '../src/storage/local-store.js';

test('LocalMemoryStore filters by session/user in retrieve', () => {
  const store = new LocalMemoryStore();
  store.write({ tenantId: 't', scope: 'user', sessionId: 's1', userId: 'u1', content: 'python tips' });
  store.write({ tenantId: 't', scope: 'user', sessionId: 's2', userId: 'u2', content: 'python tips' });
  const s1 = store.retrieve({ tenantId: 't', scope: 'user', query: 'python', sessionId: 's1', topK: 10 });
  assert.equal(s1.length, 1);
  assert.equal(s1[0].sessionId, 's1');
});

test('LocalMemoryStore listRecent sorts by timestamp desc', () => {
  const store = new LocalMemoryStore();
  store.write({ tenantId: 't', scope: 'user', content: 'old', timestamp: 1000 });
  store.write({ tenantId: 't', scope: 'user', content: 'new', timestamp: 2000 });
  const recents = store.listRecent({ tenantId: 't', scope: 'user', limit: 2 });
  assert.equal(recents[0].content, 'new');
  assert.equal(recents[1].content, 'old');
});
