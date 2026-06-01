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
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTagsWithOpenClaw, mergeTags, sanitizeFacets, tryExtractTaggerOutput } from '../src/worker/tag-model.js';

const TAGGER_ENV_KEYS = [
  'MEMSENSE_TAGGER_PROVIDER',
  'MEMSENSE_TAGGER_BASE_URL',
  'MEMSENSE_TAGGER_API_KEY',
  'MEMSENSE_TAGGER_MODEL',
  'MEMSENSE_OPENCLAW_TAGGER_MODEL',
  'MEMSENSE_OPENCLAW_CLI',
  'MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS',
  'MEMSENSE_TAG_RETRY',
];

function saveTaggerEnv() {
  return Object.fromEntries(TAGGER_ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreTaggerEnv(saved) {
  for (const key of TAGGER_ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

async function writeMockOpenClawCli(body) {
  const dir = await mkdtemp(join(tmpdir(), 'memsense-openclaw-cli-'));
  const cli = join(dir, 'openclaw-mock');
  await writeFile(cli, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.join(' ') === 'models status --plain') {
  console.log('ark/mock-model');
  process.exit(0);
}
if (args[0] === 'infer' && args[1] === 'model' && args[2] === 'run') {
  const model = args[args.indexOf('--model') + 1];
  if (model !== 'ark/mock-model') {
    console.error('unexpected model ' + model);
    process.exit(2);
  }
  console.log(${JSON.stringify(JSON.stringify(body))});
  process.exit(0);
}
console.error('unexpected args ' + args.join(' '));
process.exit(2);
`);
  await chmod(cli, 0o755);
  return cli;
}

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

test('generateTagsWithOpenClaw: auto 模式找不到 OpenClaw CLI 时软降级', async () => {
  const saved = saveTaggerEnv();
  for (const key of TAGGER_ENV_KEYS) delete process.env[key];
  process.env.MEMSENSE_OPENCLAW_CLI = join(tmpdir(), 'missing-openclaw-cli');
  process.env.MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS = '1000';
  try {
    const result = await generateTagsWithOpenClaw('hello');
    assert.deepEqual(result, { tags: [], memory_kind: 'episodic', summary: null, facets: {} });
  } finally {
    restoreTaggerEnv(saved);
  }
});

test('generateTagsWithOpenClaw: 默认 auto 复用 OpenClaw 默认模型', async () => {
  const saved = saveTaggerEnv();
  const cli = await writeMockOpenClawCli({
    outputs: [{ text: JSON.stringify({
      memory_kind: 'preference',
      tags: ['Apple Ecosystem'],
      summary: 'User prefers Apple devices.',
      facets: { preferences: 'Prefers Apple devices.' },
    }) }],
  });
  for (const key of TAGGER_ENV_KEYS) delete process.env[key];
  process.env.MEMSENSE_OPENCLAW_CLI = cli;
  process.env.MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS = '5000';
  try {
    const result = await generateTagsWithOpenClaw('用户喜欢苹果设备');
    assert.deepEqual(result.tags, ['apple ecosystem']);
    assert.equal(result.memory_kind, 'preference');
    assert.equal(result.summary, 'User prefers Apple devices.');
    assert.deepEqual(result.facets, { preferences: 'Prefers Apple devices.' });
  } finally {
    restoreTaggerEnv(saved);
  }
});

test('generateTagsWithOpenClaw: openclaw_cli 复用 OpenClaw 默认模型', async () => {
  const saved = saveTaggerEnv();
  const cli = await writeMockOpenClawCli({
    content: JSON.stringify({
      memory_kind: 'preference',
      tags: ['Apple Ecosystem', 'iPhone'],
      summary: 'User prefers the Apple ecosystem.',
      facets: { preferences: 'Prefers Apple ecosystem devices.' },
    }),
  });
  for (const key of TAGGER_ENV_KEYS) delete process.env[key];
  process.env.MEMSENSE_TAGGER_PROVIDER = 'openclaw_cli';
  process.env.MEMSENSE_TAGGER_MODEL = 'auto';
  process.env.MEMSENSE_OPENCLAW_CLI = cli;
  process.env.MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS = '5000';
  try {
    const result = await generateTagsWithOpenClaw('用户喜欢苹果生态');
    assert.deepEqual(result.tags, ['apple ecosystem', 'iphone']);
    assert.equal(result.memory_kind, 'preference');
    assert.equal(result.summary, 'User prefers the Apple ecosystem.');
    assert.deepEqual(result.facets, { preferences: 'Prefers Apple ecosystem devices.' });
  } finally {
    restoreTaggerEnv(saved);
  }
});

test('generateTagsWithOpenClaw: openclaw_cli 配置后失败会抛错', async () => {
  const saved = saveTaggerEnv();
  const dir = await mkdtemp(join(tmpdir(), 'memsense-openclaw-cli-fail-'));
  const cli = join(dir, 'openclaw-mock-fail');
  await writeFile(cli, `#!/usr/bin/env node
console.error('Connection error.');
process.exit(1);
`);
  await chmod(cli, 0o755);
  for (const key of TAGGER_ENV_KEYS) delete process.env[key];
  process.env.MEMSENSE_TAGGER_PROVIDER = 'openclaw_cli';
  process.env.MEMSENSE_TAGGER_MODEL = 'auto';
  process.env.MEMSENSE_OPENCLAW_CLI = cli;
  process.env.MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS = '5000';
  process.env.MEMSENSE_TAG_RETRY = '1';
  try {
    await assert.rejects(() => generateTagsWithOpenClaw('hello'), /tagger failed: openclaw CLI failed/);
  } finally {
    restoreTaggerEnv(saved);
  }
});
