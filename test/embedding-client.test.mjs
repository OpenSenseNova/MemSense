import test from 'node:test';
import assert from 'node:assert/strict';
import { toPgVectorLiteral, embedText } from '../src/server/embedding/client.js';

test('toPgVectorLiteral serializes vector', () => {
  const s = toPgVectorLiteral([0.1, 0.2, 0.3]);
  assert.equal(s.startsWith('['), true);
  assert.equal(s.endsWith(']'), true);
});

test('embedText openai provider requires api key', async () => {
  const oldProvider = process.env.MEMSENSE_EMBEDDING_PROVIDER;
  const oldKey = process.env.MEMSENSE_OPENAI_API_KEY;
  process.env.MEMSENSE_EMBEDDING_PROVIDER = 'openai';
  delete process.env.MEMSENSE_OPENAI_API_KEY;
  await assert.rejects(() => embedText('hello'), /MEMSENSE_OPENAI_API_KEY/);
  process.env.MEMSENSE_EMBEDDING_PROVIDER = oldProvider;
  if (oldKey) process.env.MEMSENSE_OPENAI_API_KEY = oldKey;
});
