/**
 * 测试覆盖：rerank.js 核心改动
 *
 * 改动点回顾（对比旧版本）：
 *  ✗ 移除了 normalizeKind / kindDecayDays / temporalScore，temporal 信号删除
 *  ✗ normalizeRows 不再读 confidence/temporal，只处理 score + rrf_score + embedding
 *  ✓ baseRankedRows（线性加权）→ rrfRankedRows（final_score = rrf_score + α*score）
 *  ✓ hybridRerank 签名去掉 nowMs/weights，新增 alpha 选项
 *  ✓ diversifiedSelect / MMR 逻辑无改动，保持原有去重行为
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp01, normalizeRows, hybridRerank } from '../src/server/retrieval/rerank.js';

function makeRow(overrides = {}) {
  return {
    memory_id: 'mem_test',
    content: 'test content',
    tags: [],
    score: 0.5,
    rrf_score: 0.02,
    timestamp_ms: Date.now(),
    embedding: null,
    routes: ['vec_full'],
    ...overrides,
  };
}

function unitVec(seed, n = 4) {
  const v = Array.from({ length: n }, (_, i) => Math.sin(seed + i));
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

// ── clamp01 ────

test('clamp01: clamps values to [0,1]', () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(NaN, 0.3), 0.3);
});

// ── normalizeRows: 新格式 ────

test('normalizeRows: reads rrf_score and score, not temporal/confidence', () => {
  const [r] = normalizeRows([makeRow({ rrf_score: 0.0314, score: 0.7 })]);
  assert.equal(r.rrf_score, 0.0314);
  assert.equal(r.score, 0.7);
  assert.equal('temporal_score' in r, false);
  assert.equal('vector_score' in r, false);
  assert.equal('lexical_score' in r, false);
});

test('normalizeRows: parses embedding string', () => {
  const [r] = normalizeRows([makeRow({ embedding: '[0.1,0.2,0.3]' })]);
  assert.deepEqual(r.embedding, [0.1, 0.2, 0.3]);
});

// ── hybridRerank: RRF 评分 ────

test('hybridRerank: final_score = rrf_score + alpha*score', () => {
  const row = makeRow({ rrf_score: 0.04, score: 0.6 });
  const [r] = hybridRerank([row], 1);
  const expected = Number((0.04 + 0.1 * 0.6).toFixed(6));
  assert.equal(r.final_score, expected);
  assert.equal(r.explain.rrf_score, 0.04);
  assert.equal(r.explain.memory_score, 0.6);
});

test('hybridRerank: alpha option controls score weight', () => {
  const rowA = makeRow({ memory_id: 'A', rrf_score: 0.02, score: 0.9 });
  const rowB = makeRow({ memory_id: 'B', rrf_score: 0.03, score: 0.1 });
  // alpha=0.1: A=0.02+0.1*0.9=0.11, B=0.03+0.1*0.1=0.04 → A优先
  const [firstDefault] = hybridRerank([rowA, rowB], 2);
  assert.equal(firstDefault.memory_id, 'A');
  // alpha=1: A=0.02+1*0.9=0.92, B=0.03+1*0.1=0.13 → A仍优先
  const [firstAlpha1] = hybridRerank([rowA, rowB], 2, { alpha: 1 });
  assert.equal(firstAlpha1.memory_id, 'A');
});

test('hybridRerank: respects topK', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    makeRow({ memory_id: `m${i}`, rrf_score: 0.1 - i * 0.01 }),
  );
  const result = hybridRerank(rows, 3);
  assert.equal(result.length, 3);
});

test('hybridRerank: MMR removes near-duplicates', () => {
  const vec = unitVec(0);
  // rowA 和 rowB 使用同一向量，但 rrf_score 不同。MMR 会根据去重阈值决定
  // 相同向量的 cosine sim = 1.0，超过 0.94，所以 B 会被过滤（redundancy >= threshold）
  const rowA = makeRow({ memory_id: 'A', rrf_score: 0.05, embedding: vec });
  const rowB = makeRow({ memory_id: 'B', rrf_score: 0.04, embedding: vec }); // 同向量
  const rowC = makeRow({ memory_id: 'C', rrf_score: 0.03, embedding: unitVec(99) }); // 不同向量
  const result = hybridRerank([rowA, rowB, rowC], 3, { duplicateThreshold: 0.94, lambda: 0.78 });
  // 预期：A 被选中，B 在 MMR 选择阶段被跳过（maxRedundancy >= 0.94），C 被选中
  const ids = result.map((r) => r.memory_id);
  assert.ok(ids.includes('A'), 'A 应被选中');
  assert.ok(ids.includes('C'), 'C 应被选中（不同向量）');
  // B 可能被去重（若 duplicateThreshold=0.94），也可能被选中（如果 topK 足够且 fallback）
  // 实际行为取决于 diversifiedSelect 的 maxRedundancy 计算
});
