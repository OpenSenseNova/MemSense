import test from 'node:test';
import assert from 'node:assert/strict';

test('worker queue module exports expected functions', async () => {
  const mod = await import('../src/worker/queue.js');
  assert.equal(typeof mod.claimNextEmbeddingJob, 'function');
  assert.equal(typeof mod.markJobDone, 'function');
  assert.equal(typeof mod.markJobRetry, 'function');
  assert.equal(typeof mod.markJobDlq, 'function');
});
