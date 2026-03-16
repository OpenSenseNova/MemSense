import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChunk } from '../src/capture/chunk-builder.js';

test('buildChunk returns qa_chunk payload', () => {
  const c = buildChunk({
    tenantId: 't1',
    scope: 'user',
    sessionId: 's1',
    userId: 'u1',
    userText: 'hello',
    assistantText: 'world',
    tags: ['preference'],
  });
  assert.equal(c.typeHint, 'qa_chunk');
  assert.equal(c.tenantId, 't1');
  assert.equal(typeof c.content, 'string');
  const qa = JSON.parse(c.content);
  assert.equal(qa.user, 'hello');
  assert.equal(qa.assistant, 'world');
});
