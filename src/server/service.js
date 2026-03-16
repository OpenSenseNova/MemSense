import crypto from 'node:crypto';
import { query } from './db/client.js';
import { embedText, toPgVectorLiteral } from './embedding/client.js';
import { hybridRerank } from './retrieval/rerank.js';

function genMemoryId() {
  return `mem_${crypto.randomBytes(8).toString('hex')}`;
}

export async function saveChunk(input) {
  const timestamp = Number(input.timestamp ?? Date.now());
  const memoryId = genMemoryId();
  const tags = JSON.stringify(input.tags || []);
  const sql = `INSERT INTO memory_chunks
  (memory_id, tenant_id, scope, session_id, user_id, content, type_hint, tags, task_tag, source, score, confidence, timestamp_ms)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)
  RETURNING id, memory_id, timestamp_ms, score`;
  const vals = [
    memoryId,
    input.tenant_id,
    input.scope,
    input.session_id || null,
    input.user_id || null,
    String(input.content || '').trim(),
    input.type_hint || 'qa_chunk',
    tags,
    input.task_tag || null,
    input.source || 'session',
    Number(input.score ?? 0.5),
    Number(input.confidence ?? 0.7),
    timestamp,
  ];
  const r = await query(sql, vals);
  const row = r.rows[0];

  const embedding = await embedText(String(input.content || ''));
  await query(
    `INSERT INTO memory_chunk_embeddings (chunk_id, embedding, model) VALUES ($1, $2::vector, $3)`,
    [row.id, toPgVectorLiteral(embedding), process.env.MEMSENSE_EMBEDDING_MODEL || process.env.MEMSENSE_BGE_MODEL || 'unknown'],
  );

  await query(
    `INSERT INTO memory_events (memory_id, tenant_id, scope, event_type, payload) VALUES ($1,$2,$3,'capture',$4::jsonb)`,
    [memoryId, input.tenant_id, input.scope, JSON.stringify({ source: input.source || 'session' })],
  );
  return { memory_id: row.memory_id, timestamp_ms: row.timestamp_ms, score: row.score };
}

export async function fetchRecent({ tenant_id, scope, session_id, user_id, limit = 10 }) {
  const sql = `SELECT memory_id, content, tags, score, confidence, timestamp_ms, session_id, user_id
  FROM memory_chunks
  WHERE tenant_id = $1
    AND scope = $2
    AND ($3::text IS NULL OR session_id = $3)
    AND ($4::text IS NULL OR user_id = $4)
    AND status = 'active'
  ORDER BY timestamp_ms DESC
  LIMIT $5`;
  const r = await query(sql, [tenant_id, scope, session_id || null, user_id || null, Number(limit)]);
  return r.rows;
}

export async function searchChunks({ tenant_id, scope, session_id, user_id, query_text, top_k = 8 }) {
  const q = String(query_text || '');
  const qvec = await embedText(q);
  const qvecLiteral = toPgVectorLiteral(qvec);
  const sql = `SELECT c.memory_id, c.content, c.tags, c.score, c.confidence, c.timestamp_ms, c.session_id, c.user_id,
    (1 - (e.embedding <=> $5::vector)) AS vector_score,
    (CASE WHEN c.content ILIKE '%' || $6 || '%' THEN 1 ELSE 0 END) AS lexical_score
  FROM memory_chunks c
  JOIN memory_chunk_embeddings e ON e.chunk_id = c.id
  WHERE c.tenant_id = $1
    AND c.scope = $2
    AND ($3::text IS NULL OR c.session_id = $3)
    AND ($4::text IS NULL OR c.user_id = $4)
    AND c.status = 'active'
  ORDER BY vector_score DESC, c.score DESC, c.timestamp_ms DESC
  LIMIT $7`;
  const r = await query(sql, [tenant_id, scope, session_id || null, user_id || null, qvecLiteral, q, Number(Math.max(top_k * 3, top_k))]);
  return hybridRerank(r.rows, Number(top_k));
}

export async function searchByTime({ tenant_id, scope, from_ts, to_ts, limit = 20, field = 'updated_at' }) {
  const fieldSql = field === 'created_at' ? 'created_at' : 'updated_at';
  const sql = `SELECT memory_id, content, tags, score, confidence, timestamp_ms, session_id, user_id, created_at, updated_at
  FROM memory_chunks
  WHERE tenant_id = $1 AND scope = $2
    AND (EXTRACT(EPOCH FROM ${fieldSql}) * 1000) >= $3
    AND (EXTRACT(EPOCH FROM ${fieldSql}) * 1000) <= $4
  ORDER BY ${fieldSql} DESC
  LIMIT $5`;
  const r = await query(sql, [tenant_id, scope, Number(from_ts), Number(to_ts), Number(limit)]);
  return r.rows;
}

export async function feedback({ memory_id, label }) {
  const r = await query('SELECT tenant_id, scope FROM memory_chunks WHERE memory_id = $1 LIMIT 1', [memory_id]);
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  await query(
    `INSERT INTO memory_events (memory_id, tenant_id, scope, event_type, payload) VALUES ($1,$2,$3,'feedback',$4::jsonb)`,
    [memory_id, r.rows[0].tenant_id, r.rows[0].scope, JSON.stringify({ label })],
  );
  return { ok: true };
}

export async function promoteDemote({ memory_id, action }) {
  const delta = action === 'promote' ? 0.15 : -0.15;
  const r = await query(
    `UPDATE memory_chunks
     SET score = LEAST(1, GREATEST(0, score + $2)), updated_at = NOW()
     WHERE memory_id = $1
     RETURNING memory_id, score`,
    [memory_id, delta],
  );
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  return { ok: true, memory: r.rows[0] };
}

export async function forget({ memory_id }) {
  const r = await query(
    `UPDATE memory_chunks SET status = 'deleted', updated_at = NOW() WHERE memory_id = $1 RETURNING memory_id`,
    [memory_id],
  );
  return { deleted: r.rows.length > 0 };
}

export async function audit({ memory_id }) {
  const r = await query(
    `SELECT event_type, payload, created_at FROM memory_events WHERE memory_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [memory_id],
  );
  return { events: r.rows };
}

export async function dashboardOverview({ tenant_id, scope, session_id, user_id, limit = 20 }) {
  const args = [tenant_id || null, scope || null, session_id || null, user_id || null, Number(limit)];
  const where = `WHERE ($1::text IS NULL OR tenant_id = $1)
    AND ($2::text IS NULL OR scope = $2)
    AND ($3::text IS NULL OR session_id = $3)
    AND ($4::text IS NULL OR user_id = $4)`;

  const totalQ = await query(`SELECT COUNT(*)::int AS n FROM memory_chunks ${where}`, args.slice(0, 4));
  const activeQ = await query(`SELECT COUNT(*)::int AS n FROM memory_chunks ${where} AND status = 'active'`, args.slice(0, 4));
  const deletedQ = await query(`SELECT COUNT(*)::int AS n FROM memory_chunks ${where} AND status = 'deleted'`, args.slice(0, 4));
  const latestQ = await query(
    `SELECT memory_id, tenant_id, scope, session_id, user_id, score, timestamp_ms, status
     FROM memory_chunks ${where}
     ORDER BY timestamp_ms DESC LIMIT $5`,
    args,
  );
  return {
    counts: {
      total: totalQ.rows[0]?.n || 0,
      active: activeQ.rows[0]?.n || 0,
      deleted: deletedQ.rows[0]?.n || 0,
    },
    latest: latestQ.rows,
  };
}

export async function setChunkStatus({ memory_id, status }) {
  if (!['active', 'archived', 'deleted'].includes(String(status))) {
    throw new Error('invalid status');
  }
  const r = await query(
    `UPDATE memory_chunks SET status = $2, updated_at = NOW() WHERE memory_id = $1 RETURNING memory_id, status`,
    [memory_id, status],
  );
  if (!r.rows.length) return { ok: false, reason: 'not_found' };
  return { ok: true, item: r.rows[0] };
}
