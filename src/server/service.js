import crypto from 'node:crypto';
import { query } from './db/client.js';

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
  RETURNING memory_id, timestamp_ms, score`;
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
  await query(
    `INSERT INTO memory_events (memory_id, tenant_id, scope, event_type, payload) VALUES ($1,$2,$3,'capture',$4::jsonb)`,
    [memoryId, input.tenant_id, input.scope, JSON.stringify({ source: input.source || 'session' })],
  );
  return r.rows[0];
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
  // NOTE: 当前使用 PostgreSQL ILIKE 作为第一版检索；向量检索后续接 pgvector。
  const sql = `SELECT memory_id, content, tags, score, confidence, timestamp_ms, session_id, user_id,
    (CASE WHEN content ILIKE '%' || $5 || '%' THEN 1 ELSE 0 END) AS lexical_hit
  FROM memory_chunks
  WHERE tenant_id = $1
    AND scope = $2
    AND ($3::text IS NULL OR session_id = $3)
    AND ($4::text IS NULL OR user_id = $4)
    AND status = 'active'
  ORDER BY lexical_hit DESC, score DESC, timestamp_ms DESC
  LIMIT $6`;
  const r = await query(sql, [tenant_id, scope, session_id || null, user_id || null, String(query_text || ''), Number(top_k)]);
  return r.rows;
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
