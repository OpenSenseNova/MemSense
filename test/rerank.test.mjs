import test from 'node:test';
import assert from 'node:assert/strict';
import { hybridRerank } from '../src/server/retrieval/rerank.js';

test('hybridRerank sorts by final_score and keeps explain', () => {
  const rows = [
    { memory_id: 'a', vector_score: 0.9, lexical_score: 0.1, score: 0.5, confidence: 0.8, memory_kind: 'stable', timestamp_ms: Date.now() },
    { memory_id: 'b', vector_score: 0.2, lexical_score: 1.0, score: 0.8, confidence: 0.9, memory_kind: 'preference', timestamp_ms: Date.now() },
  ];
  const ranked = hybridRerank(rows, 2, { nowMs: Date.now() });
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].final_score >= ranked[1].final_score);
  assert.ok(ranked[0].explain);
  assert.ok(typeof ranked[0].explain.temporal_score === 'number');
  assert.deepEqual(ranked[0].explain.weights, { vector: 0.35, lexical: 0.2, memory: 0.15, confidence: 0.1, temporal: 0.2 });
});

test('hybridRerank lexical weight can beat weaker vector when other signals are close', () => {
  const now = Date.now();
  const rows = [
    { memory_id: 'lexical-strong', vector_score: 0.65, lexical_score: 1.0, score: 0.5, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now },
    { memory_id: 'vector-strong', vector_score: 0.9, lexical_score: 0.0, score: 0.5, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now },
  ];
  const ranked = hybridRerank(rows, 2, { nowMs: now });
  assert.equal(ranked[0].memory_id, 'lexical-strong');
});

test('hybridRerank penalizes stale preference memories versus fresh ones', () => {
  const now = Date.now();
  const rows = [
    { memory_id: 'fresh', vector_score: 0.72, lexical_score: 0.2, score: 0.5, confidence: 0.7, memory_kind: 'preference', timestamp_ms: now - 2 * 24 * 60 * 60 * 1000 },
    { memory_id: 'stale', vector_score: 0.75, lexical_score: 0.2, score: 0.5, confidence: 0.7, memory_kind: 'preference', timestamp_ms: now - 80 * 24 * 60 * 60 * 1000 },
  ];
  const ranked = hybridRerank(rows, 2, { nowMs: now });
  assert.equal(ranked[0].memory_id, 'fresh');
  assert.ok(ranked[0].explain.temporal_score > ranked[1].explain.temporal_score);
});

test('hybridRerank diversifies near-duplicate embeddings', () => {
  const now = Date.now();
  const rows = [
    { memory_id: 'dup-1', vector_score: 0.95, lexical_score: 0.5, score: 0.6, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now, embedding: '[1,0]', tags: ['response_style', 'detailed'] },
    { memory_id: 'dup-2', vector_score: 0.94, lexical_score: 0.5, score: 0.6, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now, embedding: '[0.9999,0.0001]', tags: ['response_style', 'detailed'] },
    { memory_id: 'diverse', vector_score: 0.7, lexical_score: 0.4, score: 0.6, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now, embedding: '[0,1]', tags: ['planning_style', 'stepwise'] },
  ];
  const ranked = hybridRerank(rows, 2, { nowMs: now, lambda: 0.75, duplicateThreshold: 0.93 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].memory_id, 'dup-1');
  assert.equal(ranked[1].memory_id, 'diverse');
});
