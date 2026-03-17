import crypto from 'node:crypto';
import { buildCanonicalQa } from '../capture/canonical-qa.js';
import { query } from './db/client.js';
import { embedText, toPgVectorLiteral } from './embedding/client.js';
import { hybridRerank } from './retrieval/rerank.js';

function genMemoryId() {
  return `mem_${crypto.randomBytes(8).toString('hex')}`;
}

function normalizeQaChunkContent(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('memory_save only accepts qa_chunk content (json)');
  }
  const qa = buildCanonicalQa(parsed || {});
  if (!qa.user) {
    throw new Error('memory_save requires user_text');
  }
  if (/^Sender \(untrusted metadata\):/i.test(qa.user) || /^System:/i.test(qa.user)) {
    throw new Error('memory_save rejected unnormalized user_text');
  }
  return JSON.stringify(qa);
}

export async function saveChunk(input) {
  const timestamp = Number(input.timestamp ?? Date.now());
  const memoryId = genMemoryId();
  const tags = JSON.stringify(input.tags || []);
  const sql = `INSERT INTO memory_chunks
  (memory_id, tenant_id, scope, session_id, agent_id, user_id, content, type_hint, tags, task_tag, source, score, confidence, timestamp_ms, memory_kind)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
  RETURNING id, memory_id, timestamp_ms, score, memory_kind`;
  const qaContent = normalizeQaChunkContent(input.content);

  const dedupCheck = await query(
    `SELECT id, memory_id, timestamp_ms, score, memory_kind FROM memory_chunks
     WHERE tenant_id = $1
       AND scope = $2
       AND ($3::text IS NULL OR session_id = $3)
       AND ($4::text IS NULL OR agent_id = $4)
       AND ($5::text IS NULL OR user_id = $5)
       AND content = $6
       AND timestamp_ms >= $7
     ORDER BY timestamp_ms DESC
     LIMIT 1`,
    [input.tenant_id, input.scope, input.session_id || null, input.agent_id || null, input.user_id || null, qaContent, timestamp - 10 * 60 * 1000],
  );
  if (dedupCheck.rows.length) {
    const ex = dedupCheck.rows[0];
    return { memory_id: ex.memory_id, timestamp_ms: ex.timestamp_ms, score: ex.score, memory_kind: ex.memory_kind, deduped: true };
  }

  const vals = [
    memoryId,
    input.tenant_id,
    input.scope,
    input.session_id || null,
    input.agent_id || null,
    input.user_id || null,
    qaContent,
    'qa_chunk',
    tags,
    input.task_tag || null,
    input.source || 'session_auto',
    0.5,
    0.7,
    timestamp,
    input.memory_kind || 'episodic',
  ];
  const r = await query(sql, vals);
  const row = r.rows[0];

  await query(
    `INSERT INTO embedding_jobs (chunk_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
    [row.id, JSON.stringify({ content: qaContent })],
  );

  await query(
    `INSERT INTO tag_jobs (chunk_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
    [row.id, JSON.stringify({ content: qaContent })],
  );

  await query(
    `INSERT INTO memory_events (memory_id, tenant_id, scope, event_type, payload) VALUES ($1,$2,$3,'capture',$4::jsonb)`,
    [memoryId, input.tenant_id, input.scope, JSON.stringify({ source: input.source || 'session' })],
  );
  return { memory_id: row.memory_id, timestamp_ms: row.timestamp_ms, score: row.score, memory_kind: row.memory_kind };
}

export async function fetchRecent({ tenant_id, scope, session_id, agent_id, user_id, limit = 10 }) {
  const sql = `SELECT memory_id, content, tags, score, confidence, timestamp_ms, session_id, agent_id, user_id, memory_kind
  FROM memory_chunks
  WHERE tenant_id = $1
    AND scope = $2
    AND ($3::text IS NULL OR session_id = $3)
    AND ($4::text IS NULL OR agent_id = $4)
    AND ($5::text IS NULL OR user_id = $5)
    AND status = 'active'
  ORDER BY timestamp_ms DESC
  LIMIT $6`;
  const r = await query(sql, [tenant_id, scope, session_id || null, agent_id || null, user_id || null, Number(limit)]);
  return r.rows;
}

export async function searchChunks({ tenant_id, scope, session_id, agent_id, user_id, query_text, top_k = 8 }) {
  const q = String(query_text || '').trim();
  const qvec = await embedText(q);
  const qvecLiteral = toPgVectorLiteral(qvec);
  const vectorLimit = Number(Math.max(top_k * 4, 16));
  const lexicalLimit = Number(Math.max(top_k * 4, 16));

  const sql = `WITH filtered AS (
    SELECT c.id, c.memory_id, c.content, c.tags, c.score, c.confidence, c.timestamp_ms, c.session_id, c.agent_id, c.user_id,
           c.memory_kind, e.embedding,
           to_tsvector('simple', COALESCE(c.content, '')) AS tsv
    FROM memory_chunks c
    LEFT JOIN memory_chunk_embeddings e ON e.chunk_id = c.id
    WHERE c.tenant_id = $1
      AND c.scope = $2
      AND ($3::text IS NULL OR c.session_id = $3)
      AND ($4::text IS NULL OR c.agent_id = $4)
      AND ($5::text IS NULL OR c.user_id = $5)
      AND c.status = 'active'
  ),
  qfts AS (
    SELECT websearch_to_tsquery('simple', $7) AS tsq
  ),
  vector_candidates AS (
    SELECT f.id,
           COALESCE((1 - (f.embedding <=> $6::vector)), 0) AS vector_score,
           0::double precision AS lexical_raw,
           'vector'::text AS route
    FROM filtered f
    WHERE f.embedding IS NOT NULL
    ORDER BY vector_score DESC, f.score DESC, f.timestamp_ms DESC
    LIMIT $8
  ),
  lexical_candidates AS (
    SELECT f.id,
           0::double precision AS vector_score,
           ts_rank_cd(f.tsv, qfts.tsq) AS lexical_raw,
           'lexical'::text AS route
    FROM filtered f
    CROSS JOIN qfts
    WHERE qfts.tsq IS NOT NULL
      AND qfts.tsq <> ''::tsquery
      AND f.tsv @@ qfts.tsq
    ORDER BY lexical_raw DESC, f.score DESC, f.timestamp_ms DESC
    LIMIT $9
  ),
  candidates AS (
    SELECT id,
           MAX(vector_score) AS vector_score,
           MAX(lexical_raw) AS lexical_raw,
           ARRAY_AGG(DISTINCT route) AS routes
    FROM (
      SELECT * FROM vector_candidates
      UNION ALL
      SELECT * FROM lexical_candidates
    ) u
    GROUP BY id
  ),
  lexical_max AS (
    SELECT COALESCE(MAX(lexical_raw), 0) AS max_lexical_raw FROM candidates
  )
  SELECT f.memory_id, f.content, f.tags, f.score, f.confidence, f.timestamp_ms, f.session_id, f.agent_id, f.user_id,
         f.memory_kind, f.embedding::text AS embedding,
         COALESCE(c.vector_score, 0) AS vector_score,
         CASE
           WHEN lm.max_lexical_raw > 0 THEN LEAST(1, GREATEST(0, c.lexical_raw / lm.max_lexical_raw))
           ELSE 0
         END AS lexical_score,
         c.routes
  FROM candidates c
  JOIN filtered f ON f.id = c.id
  CROSS JOIN lexical_max lm
  ORDER BY GREATEST(COALESCE(c.vector_score, 0), CASE WHEN lm.max_lexical_raw > 0 THEN c.lexical_raw / lm.max_lexical_raw ELSE 0 END) DESC,
           f.score DESC,
           f.timestamp_ms DESC`;
  const r = await query(sql, [tenant_id, scope, session_id || null, agent_id || null, user_id || null, qvecLiteral, q, vectorLimit, lexicalLimit]);
  return hybridRerank(r.rows, Number(top_k));
}

export async function searchByTime({ tenant_id, scope, from_ts, to_ts, limit = 20, field = 'updated_at' }) {
  const fieldSql = field === 'created_at' ? 'created_at' : 'updated_at';
  const sql = `SELECT memory_id, content, tags, score, confidence, timestamp_ms, session_id, user_id, memory_kind, created_at, updated_at
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

function toDashboardMemoryRow(row) {
  return {
    memory_id: row.memory_id,
    content: row.content,
    status: row.status,
    timestamp_ms: row.timestamp_ms,
    meta: {
      memory_kind: row.memory_kind || 'episodic',
      tags: Array.isArray(row.tags) ? row.tags : [],
      source: row.source || '—',
      tenant_id: row.tenant_id || '—',
      scope: row.scope || '—',
      user_id: row.user_id || null,
      session_id: row.session_id || null,
      agent_id: row.agent_id || null,
      score: row.score,
      confidence: row.confidence,
    },
  };
}

export async function dashboardOverview({ q, limit = 20 }) {
  const queryText = String(q || '').trim();
  const search = queryText ? `%${queryText}%` : null;
  const args = [search, Number(limit)];
  const where = `WHERE (
    $1::text IS NULL
    OR memory_id ILIKE $1
    OR tenant_id ILIKE $1
    OR scope ILIKE $1
    OR COALESCE(session_id, '') ILIKE $1
    OR COALESCE(agent_id, '') ILIKE $1
    OR COALESCE(user_id, '') ILIKE $1
    OR content ILIKE $1
    OR COALESCE(memory_kind, '') ILIKE $1
    OR COALESCE(source, '') ILIKE $1
    OR COALESCE(tags::text, '') ILIKE $1
    OR COALESCE(status, '') ILIKE $1
  )`;

  const totalQ = await query(`SELECT COUNT(*)::int AS n FROM memory_chunks ${where}`, [search]);
  const activeQ = await query(`SELECT COUNT(*)::int AS n FROM memory_chunks ${where} AND status = 'active'`, [search]);
  const deletedQ = await query(`SELECT COUNT(*)::int AS n FROM memory_chunks ${where} AND status = 'deleted'`, [search]);
  const latestQ = await query(
    `SELECT memory_id, tenant_id, scope, session_id, agent_id, user_id, content, memory_kind, tags, score, confidence, source, timestamp_ms, status
     FROM memory_chunks ${where}
     ORDER BY timestamp_ms DESC LIMIT $2`,
    args,
  );
  const latest = latestQ.rows.map(toDashboardMemoryRow);
  return {
    counts: {
      total: totalQ.rows[0]?.n || 0,
      active: activeQ.rows[0]?.n || 0,
      deleted: deletedQ.rows[0]?.n || 0,
      showing: latest.filter((x) => x.status !== 'deleted').length,
    },
    latest,
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

export async function pipelineStatus() {
  const [chunksQ, embDoneQ, embPendingQ, embRunningQ, embFailedQ, tagPendingQ, tagRunningQ, tagFailedQ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM memory_chunks`),
    query(`SELECT COUNT(*)::int AS n FROM memory_chunk_embeddings`),
    query(`SELECT COUNT(*)::int AS n FROM embedding_jobs WHERE status='pending'`),
    query(`SELECT COUNT(*)::int AS n FROM embedding_jobs WHERE status='running'`),
    query(`SELECT COUNT(*)::int AS n FROM embedding_jobs WHERE status='failed'`),
    query(`SELECT COUNT(*)::int AS n FROM tag_jobs WHERE status='pending'`),
    query(`SELECT COUNT(*)::int AS n FROM tag_jobs WHERE status='running'`),
    query(`SELECT COUNT(*)::int AS n FROM tag_jobs WHERE status='failed'`),
  ]);

  const totalChunks = chunksQ.rows[0]?.n || 0;
  const embeddedChunks = embDoneQ.rows[0]?.n || 0;
  const vectorReadyRate = totalChunks ? Number((embeddedChunks / totalChunks).toFixed(4)) : 0;

  return {
    sections: [
      {
        key: 'chunks',
        label: 'Chunks',
        metrics: {
          total: totalChunks,
          embedded: embeddedChunks,
          vector_ready_rate: vectorReadyRate,
        },
      },
      {
        key: 'embedding_jobs',
        label: 'Embedding Jobs',
        metrics: {
          pending: embPendingQ.rows[0]?.n || 0,
          running: embRunningQ.rows[0]?.n || 0,
          failed: embFailedQ.rows[0]?.n || 0,
        },
      },
      {
        key: 'tag_jobs',
        label: 'Tag Jobs',
        metrics: {
          pending: tagPendingQ.rows[0]?.n || 0,
          running: tagRunningQ.rows[0]?.n || 0,
          failed: tagFailedQ.rows[0]?.n || 0,
        },
      },
    ],
  };
}
