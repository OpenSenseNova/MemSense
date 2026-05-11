import { loadDotEnv } from '../env/load-env.js';

await loadDotEnv();

const [
  { query },
  { assertSchemaReady },
  { claimNextTagJob, markTagJobDone, markTagJobRetry, markTagJobDlq },
  { generateTagsWithOpenClaw, mergeTags },
] = await Promise.all([
  import('../server/db/client.js'),
  import('../server/db/readiness.js'),
  import('./tag-queue.js'),
  import('./tag-model.js'),
]);

const MAX_ATTEMPTS = Number(process.env.MEMSENSE_TAG_WORKER_MAX_ATTEMPTS || 4);
const IDLE_MS = Number(process.env.MEMSENSE_TAG_WORKER_IDLE_MS || 1200);

async function processOne(job) {
  const payload = job.payload || {};
  // taggingContent: 用于 LLM 打标，优先用 tag_context（session 级别的丰富文本）
  const taggingContent = String(payload.tag_context || payload.content || '');
  const generated = await generateTagsWithOpenClaw(taggingContent);
  const current = await query(`SELECT tags, memory_kind, task_tag FROM memory_chunks WHERE id = $1 LIMIT 1`, [job.chunk_id]);
  const existing = current.rows[0]?.tags || [];
  const merged = mergeTags(existing, generated.tags);
  const hasGeneratedSignal = Boolean(
    (generated.tags || []).length || generated.summary || Object.keys(generated.facets || {}).length,
  );
  const memoryKind = hasGeneratedSignal && generated.memory_kind
    ? generated.memory_kind
    : current.rows[0]?.memory_kind || 'episodic';
  const taskTag = hasGeneratedSignal && generated.summary
    ? generated.summary
    : current.rows[0]?.task_tag || null;
  await query(
    `UPDATE memory_chunks SET tags = $2::jsonb, memory_kind = $3, task_tag = $4, updated_at = NOW() WHERE id = $1`,
    [job.chunk_id, JSON.stringify(merged), memoryKind, taskTag],
  );

  // facet 文本直接写入 memory_chunks 对应列，按需填充
  const facets = generated.facets || {};
  const facetCols = [];
  const facetVals = [];
  let idx = 2;
  for (const [facetType, facetText] of Object.entries(facets)) {
    const col = `facet_${facetType}`;
    facetCols.push(`${col} = $${idx}`);
    facetVals.push(facetText);
    idx += 1;
  }
  if (facetCols.length) {
    await query(
      `UPDATE memory_chunks SET ${facetCols.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [job.chunk_id, ...facetVals],
    );
  }

  for (const [facetType, facetText] of Object.entries(facets)) {
    await query(
      `INSERT INTO embedding_jobs (chunk_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
      [job.chunk_id, JSON.stringify({ content: facetText, kind: 'facet', facet_type: facetType })],
    );
  }

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

await assertSchemaReady('memsense-tag-worker');

loop().catch((e) => {
  console.error('[memsense-tag-worker] fatal', e);
  process.exit(1);
});
