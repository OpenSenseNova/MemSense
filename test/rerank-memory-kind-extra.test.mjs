/**
 * 扩展测试：针对改动后的 normalizeRows
 *
 * 旧版本：normalizeRows 处理 memory_kind 字段和 temporal_score
 * 新版本：不再处理 memory_kind（SQL 已注入），不计算 temporal_score（信号移除）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRows, hybridRerank } from '../src/server/retrieval/rerank.js';

test('normalizeRows: score 被 clamp 到 [0,1]', () => {
  const rows = normalizeRows([
    { memory_id: 'x', score: 1.5, rrf_score: 0.05, embedding: null }
  ]);
  assert.equal(rows[0].score, 1);
});

test('hybridRerank: MMR 在所有候选都近似重复时仍返回结果', () => {
  const rows = [
    { memory_id: 'dup-1', rrf_score: 0.05, score: 0.5, embedding: '[1,0]', tags: ['a'] },
    { memory_id: 'dup-2', rrf_score: 0.04, score: 0.5, embedding: '[1,0]', tags: ['a'] },
  ];
  const ranked = hybridRerank(rows, 2, { duplicateThreshold: 0.1 });
  assert.equal(ranked.length, 2, '即使全部重复，也应返回所有 topK 结果');
  assert.equal(ranked[0].memory_id, 'dup-1');
});
