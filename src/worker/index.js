import { embedText, toPgVectorLiteral } from '../server/embedding/client.js';
import { query } from '../server/db/client.js';
import { claimNextEmbeddingJob, markJobDone, markJobRetry, markJobDlq } from './queue.js';

const MAX_ATTEMPTS = Number(process.env.MEMSENSE_WORKER_MAX_ATTEMPTS || 5);
const IDLE_MS = Number(process.env.MEMSENSE_WORKER_IDLE_MS || 800);

async function processOne(job) {
  const payload = job.payload || {};
  const text = String(payload.content || '');
  const vec = await embedText(text);
  await query(
    `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, model)
     VALUES ($1, $2::vector, $3)
     ON CONFLICT (chunk_id) DO UPDATE SET embedding=EXCLUDED.embedding, model=EXCLUDED.model`,
    [job.chunk_id, toPgVectorLiteral(vec), process.env.MEMSENSE_EMBEDDING_MODEL || process.env.MEMSENSE_BGE_MODEL || 'unknown'],
  );
  await markJobDone(job.id);
}

async function loop() {
  while (true) {
    const job = await claimNextEmbeddingJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, IDLE_MS));
      continue;
    }
    try {
      await processOne(job);
    } catch (e) {
      if ((job.attempts || 0) + 1 >= MAX_ATTEMPTS) {
        await markJobDlq(job, e?.message || String(e));
      } else {
        await markJobRetry(job.id, job.attempts || 0, e?.message || String(e));
      }
    }
  }
}

loop().catch((e) => {
  console.error('[memsense-worker] fatal', e);
  process.exit(1);
});
