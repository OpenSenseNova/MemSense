/**
 * 扩展测试：tag-model.js facets 功能
 *
 * 新增功能：
 *  - sanitizeFacets：净化 LLM 输出的 facets 对象
 *  - tryExtractTaggerOutput：现在返回 { tags, memory_kind, summary, facets }
 *  - generateTagsWithOpenClaw：扩展 prompt 请求 facets
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTagsWithOpenClaw, mergeTags, sanitizeFacets, tryExtractTaggerOutput } from '../src/worker/tag-model.js';

test('mergeTags: 去重并截至 20 个', () => {
  const existing = Array.from({ length: 15 }, (_, i) => `e${i}`);
  const generated = Array.from({ length: 15 }, (_, i) => `g${i}`);
  const out = mergeTags(existing, generated);
  assert.equal(out.length, 20);
  assert.equal(new Set(out).size, 20);
});

test('sanitizeFacets: 只保留允许的类型', () => {
  const raw = {
    personal_info: 'name is John',
    preferences: 'likes coffee',
    events: 'attended meeting',
    unknown_type: 'should be removed',
  };
  const result = sanitizeFacets(raw);
  assert.equal(typeof result.personal_info, 'string');
  assert.equal(typeof result.preferences, 'string');
  assert.equal(typeof result.events, 'string');
  assert.equal('unknown_type' in result, false);
});

test('sanitizeFacets: 截断超长文本至 500 字', () => {
  const long = 'x'.repeat(600);
  const result = sanitizeFacets({ personal_info: long });
  assert.equal(result.personal_info.length, 500);
});

test('sanitizeFacets: 去掉空值', () => {
  const raw = { personal_info: '  ', preferences: 'has value' };
  const result = sanitizeFacets(raw);
  assert.equal('personal_info' in result, false);
  assert.equal(typeof result.preferences, 'string');
});

test('sanitizeFacets: 非对象输入返回空', () => {
  assert.deepEqual(sanitizeFacets(null), {});
  assert.deepEqual(sanitizeFacets([]), {});
  assert.deepEqual(sanitizeFacets('string'), {});
});

test('tryExtractTaggerOutput: 解析 JSON 并包含 facets', () => {
  const text = JSON.stringify({
    tags: ['tag1', 'tag2'],
    memory_kind: 'preference',
    summary: 'a summary',
    facets: { personal_info: 'John', preferences: 'coffee' }
  });
  const result = tryExtractTaggerOutput(text);
  assert.deepEqual(result.tags, ['tag1', 'tag2']);
  assert.equal(result.memory_kind, 'preference');
  assert.equal(result.summary, 'a summary');
  assert.deepEqual(result.facets, { personal_info: 'John', preferences: 'coffee' });
});

test('tryExtractTaggerOutput: 纯数组返回默认 facets', () => {
  const result = tryExtractTaggerOutput('["tag1", "tag2"]');
  assert.deepEqual(result.tags, ['tag1', 'tag2']);
  assert.equal(result.memory_kind, 'episodic');
  assert.equal(result.summary, null);
  assert.deepEqual(result.facets, {});
});

test('tryExtractTaggerOutput: 解析失败返回空', () => {
  const result = tryExtractTaggerOutput('invalid json {]');
  assert.deepEqual(result.tags, []);
  assert.equal(result.memory_kind, 'episodic');
  assert.equal(result.summary, null);
  assert.deepEqual(result.facets, {});
});

test('generateTagsWithOpenClaw: tagger 未配置时软降级', async () => {
  const saved = {
    baseUrl: process.env.MEMSENSE_TAGGER_BASE_URL,
    apiKey: process.env.MEMSENSE_TAGGER_API_KEY,
    model: process.env.MEMSENSE_TAGGER_MODEL,
  };
  delete process.env.MEMSENSE_TAGGER_BASE_URL;
  delete process.env.MEMSENSE_TAGGER_API_KEY;
  delete process.env.MEMSENSE_TAGGER_MODEL;
  try {
    const result = await generateTagsWithOpenClaw('hello');
    assert.deepEqual(result, { tags: [], memory_kind: 'episodic', summary: null, facets: {} });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      const envKey = key === 'baseUrl' ? 'MEMSENSE_TAGGER_BASE_URL'
        : key === 'apiKey' ? 'MEMSENSE_TAGGER_API_KEY'
          : 'MEMSENSE_TAGGER_MODEL';
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;
    }
  }
});
