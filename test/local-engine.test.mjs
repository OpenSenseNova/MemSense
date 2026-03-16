import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalMemoryStore, rankCandidates, retainScore } from '../src/local-engine.js';

test('retainScore returns numeric score', () => {
  const s = retainScore({ usage: 2, freshnessMs: 1000, trust: 0.9, taskGain: 0.4, risk: 0.1 });
  assert.equal(typeof s, 'number');
});

test('rankCandidates sorts descending by score', () => {
  const now = Date.now();
  const items = [
    { content: 'python data script', confidence: 0.9, importance: 0.9, createdAt: now - 1000 },
    { content: 'go backend service', confidence: 0.6, importance: 0.4, createdAt: now - 1000 * 60 * 60 },
  ];
  const ranked = rankCandidates({ query: 'python', items, topK: 2 });
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].score >= ranked[1].score);
});

test('LocalMemoryStore write/retrieve/forget', () => {
  const store = new LocalMemoryStore();
  const item = store.write({ tenantId: 't1', scope: 'user', content: 'prefer python', typeHint: 'semantic' });
  const hits = store.retrieve({ tenantId: 't1', scope: 'user', query: 'python', topK: 8 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].memoryId, item.memoryId);
  const deleted = store.forget({ memoryId: item.memoryId });
  assert.equal(deleted.deleted, true);
});
