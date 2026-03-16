import test from 'node:test';
import assert from 'node:assert/strict';
import { hybridRerank, normalizeRows } from '../src/server/retrieval/rerank.js';

test('normalizeRows falls back unknown memory_kind to episodic', () => {
  const rows = normalizeRows([
    { memory_id: 'x', memory_kind: 'weird-kind', vector_score: 0.5, lexical_score: 0.2, score: 0.5, confidence: 0.7, timestamp_ms: Date.now() }
  ]);
  assert.equal(rows[0].memory_kind, 'episodic');
});

test('hybridRerank still returns results when all candidates are near-duplicates', () => {
  const now = Date.now();
  const rows = [
    { memory_id: 'dup-1', vector_score: 0.95, lexical_score: 0.3, score: 0.5, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now, embedding: '[1,0]', tags: ['a'] },
    { memory_id: 'dup-2', vector_score: 0.94, lexical_score: 0.31, score: 0.5, confidence: 0.7, memory_kind: 'episodic', timestamp_ms: now, embedding: '[1,0]', tags: ['a'] },
  ];
  const ranked = hybridRerank(rows, 2, { nowMs: now, duplicateThreshold: 0.1 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].memory_id, 'dup-1');
});
