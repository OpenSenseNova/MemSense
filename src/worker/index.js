import { loadDotEnv } from '../env/load-env.js';

await loadDotEnv();

const [
  { embedText, toPgVectorLiteral },
  { query },
  { assertSchemaReady },
  { claimNextEmbeddingJob, markJobDone, markJobRetry, markJobDlq },
] = await Promise.all([
  import('../server/embedding/client.js'),
  import('../server/db/client.js'),
  import('../server/db/readiness.js'),
  import('./queue.js'),
]);

const MAX_ATTEMPTS = Number(process.env.MEMSENSE_WORKER_MAX_ATTEMPTS || 5);
const IDLE_MS = Number(process.env.MEMSENSE_WORKER_IDLE_MS || 800);

async function processOne(job) {
  const payload = job.payload || {};
  const text = String(payload.content || '');
  const kind = String(payload.kind || 'full');
  const vec = await embedText(text);
  const model = process.env.MEMSENSE_EMBEDDING_MODEL || process.env.MEMSENSE_BGE_MODEL || 'unknown';

  if (kind === 'user') {
    // 写入 user 视角 embedding：用于 user 检索通路，与 assistant 通路分离以避免视角稀释
    await query(
      `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, embedding_user, model)
       VALUES ($1, $2::vector, $2::vector, $3)
       ON CONFLICT (chunk_id) DO UPDATE
       SET embedding_user = EXCLUDED.embedding_user, model = EXCLUDED.model`,
      [job.chunk_id, toPgVectorLiteral(vec), model],
    );
  } else if (kind === 'assistant') {
    // 写入 assistant 视角 embedding
    await query(
      `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, embedding_assistant, model)
       VALUES ($1, $2::vector, $2::vector, $3)
       ON CONFLICT (chunk_id) DO UPDATE
       SET embedding_assistant = EXCLUDED.embedding_assistant, model = EXCLUDED.model`,
      [job.chunk_id, toPgVectorLiteral(vec), model],
    );
  } else if (kind === 'next_user') {
    // 写入"下一轮用户追问" embedding，构成第 8 条召回路由 (vec_next_user)。
    // chunk 行必然已存在（反向补写在 INSERT 之后触发），embedding 行可能尚未创建，
    // 故沿用 user/assistant 的 NOT NULL 占位 hack：首次 INSERT 用本 vec 占位 embedding，
    // 后续全 QA job 运行时会 UPDATE 覆盖 embedding，不影响最终正确性。
    await query(
      `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, embedding_next_user, model)
       VALUES ($1, $2::vector, $2::vector, $3)
       ON CONFLICT (chunk_id) DO UPDATE
       SET embedding_next_user = EXCLUDED.embedding_next_user, model = EXCLUDED.model`,
      [job.chunk_id, toPgVectorLiteral(vec), model],
    );
  } else if (kind === 'facet') {
    const facetType = String(payload.facet_type || '');
    const colMap = { personal_info: 'embedding_facet_personal_info', preferences: 'embedding_facet_preferences', events: 'embedding_facet_events' };
    const col = colMap[facetType];
    if (!col) throw new Error(`unknown facet_type: ${facetType}`);
    if (!Array.isArray(vec) || vec.length < 1) throw new Error(`facet embedding vec is empty (len=${vec?.length || 0})`);
    const vecLiteral = toPgVectorLiteral(vec);
    await query(
      `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, ${col}, model)
       VALUES ($1, $2::vector, $2::vector, $3)
       ON CONFLICT (chunk_id) DO UPDATE
       SET ${col} = EXCLUDED.${col}, model = EXCLUDED.model`,
      [job.chunk_id, vecLiteral, model],
    );
  } else {
    // 默认：整体 QA embedding（兼容旧 job + 作为 MMR 去重基础向量）
    await query(
      `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, model)
       VALUES ($1, $2::vector, $3)
       ON CONFLICT (chunk_id) DO UPDATE SET embedding=EXCLUDED.embedding, model=EXCLUDED.model`,
      [job.chunk_id, toPgVectorLiteral(vec), model],
    );
  }

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

await assertSchemaReady('memsense-worker');

loop().catch((e) => {
  console.error('[memsense-worker] fatal', e);
  process.exit(1);
});
