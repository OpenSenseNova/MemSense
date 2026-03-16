import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupStatus } from '../src/server/system-status.js';

test('buildSetupStatus reports missing openai key', () => {
  const s = buildSetupStatus({ MEMSENSE_EMBEDDING_PROVIDER: 'openai' });
  assert.equal(s.provider, 'openai');
  assert.equal(s.ok, false);
});

test('buildSetupStatus accepts bge endpoint', () => {
  const s = buildSetupStatus({ MEMSENSE_EMBEDDING_PROVIDER: 'bge_http', MEMSENSE_BGE_ENDPOINT: 'http://bge:8080/embed' });
  assert.equal(s.provider, 'bge_http');
  assert.equal(s.ok, true);
});
