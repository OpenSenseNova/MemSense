import { query } from '../server/db/client.js';
import { claimNextTagJob, markTagJobDone, markTagJobRetry, markTagJobDlq } from './tag-queue.js';
import { generateTagsWithOpenClaw, mergeTags } from './tag-model.js';

const MAX_ATTEMPTS = Number(process.env.MEMSENSE_TAG_WORKER_MAX_ATTEMPTS || 4);
const IDLE_MS = Number(process.env.MEMSENSE_TAG_WORKER_IDLE_MS || 1200);

async function processOne(job) {
  const payload = job.payload || {};
  const content = String(payload.content || '');
  const generated = await generateTagsWithOpenClaw(content);
  const current = await query(`SELECT tags, memory_kind FROM memory_chunks WHERE id = $1 LIMIT 1`, [job.chunk_id]);
  const existing = current.rows[0]?.tags || [];
  const merged = mergeTags(existing, generated.tags);
  const memoryKind = generated.memory_kind || current.rows[0]?.memory_kind || 'episodic';
  await query(
    `UPDATE memory_chunks SET tags = $2::jsonb, memory_kind = $3, updated_at = NOW() WHERE id = $1`,
    [job.chunk_id, JSON.stringify(merged), memoryKind],
  );
  await markTagJobDone(job.id);
}

async function loop() {
  while (true) {
    const job = await claimNextTagJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, IDLE_MS));
      continue;
    }
    try {
      await processOne(job);
    } catch (e) {
      if ((job.attempts || 0) + 1 >= MAX_ATTEMPTS) {
        await markTagJobDlq(job, e?.message || String(e));
      } else {
        await markTagJobRetry(job.id, job.attempts || 0, e?.message || String(e));
      }
    }
  }
}

loop().catch((e) => {
  console.error('[memsense-tag-worker] fatal', e);
  process.exit(1);
});
