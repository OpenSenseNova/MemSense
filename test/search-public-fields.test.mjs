import test from 'node:test';
import assert from 'node:assert/strict';
import { stripSearchInternalFields } from '../src/server/service.js';

test('stripSearchInternalFields removes embeddings from search API chunks', () => {
  const out = stripSearchInternalFields({
    memory_id: 'mem_test',
    content: '{"user":"u","assistant":"a"}',
    embedding: [0.1, 0.2],
    neighbors: [
      { memory_id: 'mem_prev', content: 'prev', embedding: [0.3] },
    ],
  });

  assert.equal(out.memory_id, 'mem_test');
  assert.equal('embedding' in out, false);
  assert.equal('embedding' in out.neighbors[0], false);
});
