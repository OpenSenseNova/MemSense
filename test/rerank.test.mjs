import test from 'node:test';
import assert from 'node:assert/strict';
import { hybridRerank } from '../src/server/retrieval/rerank.js';

test('hybridRerank sorts by final_score and keeps explain', () => {
  const rows = [
    { memory_id: 'a', vector_score: 0.9, lexical_score: 0.1, score: 0.5, confidence: 0.8 },
    { memory_id: 'b', vector_score: 0.2, lexical_score: 1.0, score: 0.8, confidence: 0.9 },
  ];
  const ranked = hybridRerank(rows, 2);
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].final_score >= ranked[1].final_score);
  assert.ok(ranked[0].explain);
});
