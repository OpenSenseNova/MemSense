import crypto from 'node:crypto';
import { buildCanonicalQa } from '../capture/canonical-qa.js';
import { query } from './db/client.js';
import { embedText, toPgVectorLiteral } from './embedding/client.js';
import { hybridRerank } from './retrieval/rerank.js';

const EVAL_SESSION_SOURCE = 'eval_ingest_session';
const EVAL_TURN_SOURCE = 'eval_ingest_turn';

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
  const chunkSource = input.source || 'session_auto';
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
    chunkSource,
    0.5,
    0.7,
    timestamp,
    input.memory_kind || 'episodic',
  ];
  const r = await query(sql, vals);
  const row = r.rows[0];

  const extraEmbeddingJobs = [];
  try {
    const qa = JSON.parse(qaContent);
    const qaUser = String(qa?.user || '').trim();
    const qaAssistant = String(qa?.assistant || '').trim();
    if (qaUser) extraEmbeddingJobs.push({ content: qaUser, kind: 'user' });
    if (qaAssistant) extraEmbeddingJobs.push({ content: qaAssistant, kind: 'assistant' });
  } catch { /* normalizeQaChunkContent already validated qaContent */ }

  const facetInputs = {
    personal_info: input.facet_personal_info || null,
    preferences: input.facet_preferences || null,
    events: input.facet_events || null,
  };

  // Write facets from payload if provided by client-side tagger (--generate-tags).
  // The server-side tag worker may also update these later via tag_context.
  if (input.facet_personal_info || input.facet_preferences || input.facet_events) {
    await query(
      `UPDATE memory_chunks
       SET facet_personal_info = COALESCE($2, facet_personal_info),
           facet_preferences   = COALESCE($3, facet_preferences),
           facet_events        = COALESCE($4, facet_events)
       WHERE id = $1`,
      [row.id, input.facet_personal_info || null, input.facet_preferences || null, input.facet_events || null],
    );

    for (const [facetType, facetText] of Object.entries(facetInputs)) {
      if (facetText) {
        extraEmbeddingJobs.push({ content: facetText, kind: 'facet', facet_type: facetType });
      }
    }
  }

  await query(
    `INSERT INTO embedding_jobs (chunk_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
    [row.id, JSON.stringify({ content: qaContent })],
  );
  for (const payload of extraEmbeddingJobs) {
    await query(
      `INSERT INTO embedding_jobs (chunk_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
      [row.id, JSON.stringify(payload)],
    );
  }

  if (!input.skip_tag_job) {
    await query(
      `INSERT INTO tag_jobs (chunk_id, payload, status) VALUES ($1, $2::jsonb, 'pending')`,
      [row.id, JSON.stringify({ content: qaContent, tag_context: input.tag_context || null })],
    );
  }

  await query(
    `INSERT INTO memory_events (memory_id, tenant_id, scope, event_type, payload) VALUES ($1,$2,$3,'capture',$4::jsonb)`,
    [memoryId, input.tenant_id, input.scope, JSON.stringify({ source: chunkSource })],
  );

  // 反向补写：把本轮的 user 文本写回前一条同 session chunk 的 next_user_text，
  // 并为前一条投递 kind=next_user 的 embedding job（构成第 8 条召回路由的来源）。
  // 约束：本轮 user 文本必须非空；session_id 必须非空（否则跨会话误命中风险高）；
  // 只在前一条 next_user_text 为空时写一次，保证幂等。
  let curUserText = '';
  try { curUserText = String(JSON.parse(qaContent)?.user || '').trim(); } catch { /* qaContent 已校验过 */ }
  if (curUserText && input.session_id && chunkSource !== EVAL_SESSION_SOURCE) {
    const prev = await query(
      `SELECT id FROM memory_chunks
       WHERE tenant_id = $1
         AND scope = $2
         AND session_id = $3
         AND ($4::text IS NULL OR agent_id = $4)
         AND ($5::text IS NULL OR user_id = $5)
         AND source = $8
         AND status = 'active'
         AND (timestamp_ms < $6 OR (timestamp_ms = $6 AND id < $7))
       ORDER BY timestamp_ms DESC, id DESC
       LIMIT 1`,
      [input.tenant_id, input.scope, input.session_id, input.agent_id || null, input.user_id || null, timestamp, row.id, chunkSource],
    );
    const prevId = prev.rows[0]?.id;
    if (prevId) {
      await query(
        `WITH updated AS (
           UPDATE memory_chunks
           SET next_user_text = $2, updated_at = NOW()
           WHERE id = $1
             AND (next_user_text IS NULL OR next_user_text = '')
           RETURNING id
         )
         INSERT INTO embedding_jobs (chunk_id, payload, status)
         SELECT id, $3::jsonb, 'pending' FROM updated`,
        [prevId, curUserText, JSON.stringify({ content: curUserText, kind: 'next_user' })],
      );
    }
  }

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

function buildTurnSupport(rows) {
  const bySession = new Map();
  for (const row of rows || []) {
    if (row?.source !== EVAL_TURN_SOURCE || !row?.session_id) continue;
    const rrf = Number(row.rrf_score) || 0;
    const current = bySession.get(row.session_id) || {
      supporting_turn_count: 0,
      best_turn_rrf_score: 0,
      best_turn_routes: [],
    };
    current.supporting_turn_count += 1;
    if (rrf > current.best_turn_rrf_score) {
      current.best_turn_rrf_score = rrf;
      current.best_turn_routes = Array.isArray(row.routes) ? row.routes : [];
    }
    bySession.set(row.session_id, current);
  }
  return bySession;
}

async function fetchSessionRowsForSupport({ tenant_id, scope, agent_id, user_id, sessionIds }) {
  const ids = [...new Set((sessionIds || []).filter(Boolean))];
  if (!ids.length) return [];
  const sql = `SELECT c.id AS chunk_id, c.memory_id, c.content, c.tags, c.task_tag, c.score, c.timestamp_ms,
                      c.session_id, c.agent_id, c.user_id, c.memory_kind, c.source, c.next_user_text,
                      e.embedding::text AS embedding,
                      0::double precision AS rrf_score,
                      ARRAY[]::text[] AS routes
               FROM memory_chunks c
               LEFT JOIN memory_chunk_embeddings e ON e.chunk_id = c.id
               WHERE c.tenant_id = $1
                 AND c.scope = $2
                 AND ($3::text IS NULL OR c.agent_id = $3)
                 AND ($4::text IS NULL OR c.user_id = $4)
                 AND c.source = $5
                 AND c.session_id = ANY($6::text[])
                 AND c.status = 'active'
               ORDER BY c.timestamp_ms DESC, c.id DESC`;
  const r = await query(sql, [tenant_id, scope, agent_id || null, user_id || null, EVAL_SESSION_SOURCE, ids]);
  return r.rows;
}

function uniqueRowsByChunkId(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row?.chunk_id || row?.memory_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function stripSearchInternalFields(chunk) {
  if (!chunk || typeof chunk !== 'object') return chunk;
  const { embedding, ...publicChunk } = chunk;
  if (Array.isArray(publicChunk.neighbors)) {
    publicChunk.neighbors = publicChunk.neighbors.map((neighbor) => {
      if (!neighbor || typeof neighbor !== 'object') return neighbor;
      const { embedding: _embedding, ...publicNeighbor } = neighbor;
      return publicNeighbor;
    });
  }
  return publicChunk;
}

function toPublicSearchChunks(chunks) {
  return (chunks || []).map(stripSearchInternalFields);
}

export async function searchChunks({ tenant_id, scope, session_id, agent_id, user_id, query_text, top_k = 4 }) {
  const q = String(query_text || '').trim();
  console.log('[memsense-search] query:', q.slice(0, 100));
  const qvec = await embedText(q);
  const qvecLiteral = toPgVectorLiteral(qvec);
  const candidateLimit = Math.max(Number(top_k) * 4, 32);
  const routeLimit = Number(Math.max(candidateLimit * 2, 40));

  // Phase 1: 8 条独立检索通路 + SQL 内 RRF 融合
  //
  // 通路设计：
  //   r_vec_full      - 整体 QA embedding（原有通路，兼容无 user/assistant 分离的旧数据）
  //   r_vec_user      - user 视角 embedding（tag-worker 生成，分离后不被 assistant 内容稀释）
  //   r_vec_asst      - assistant 视角 embedding
  //   r_lex           - 全文检索（task_tag 优先，回退 content）
  //   r_facet_pi      - personal_info facet 向量
  //   r_facet_pref    - preferences facet 向量
  //   r_facet_ev      - events facet 向量
  //   r_vec_next_user - 下一轮用户追问 embedding（反向补写，构成 QAQ 召回效果）
  //
  // RRF 公式：score(chunk) = Σ 1/(k + rank_in_route)，k=15
  // k=15 而非常规的 60，因为语料规模小（~30 chunks），需要更大的排名区分度。
  // 只看排名不看绝对值，避免各通路分数量纲不同导致的权重调参问题。
  console.log('[memsense-search] phase 1: 8-route retrieval + RRF, route_limit=', routeLimit);
  const phase1Sql = `WITH filtered AS (
    SELECT c.id, c.memory_id, c.content, c.tags, c.task_tag, c.score, c.timestamp_ms,
           c.session_id, c.agent_id, c.user_id, c.memory_kind, c.source, c.next_user_text,
           e.embedding, e.embedding_user, e.embedding_assistant,
           e.embedding_facet_personal_info, e.embedding_facet_preferences, e.embedding_facet_events,
           e.embedding_next_user
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
    SELECT websearch_to_tsquery('english', $7) AS tsq
  ),
  r_vec_full AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding <=> $6::vector)) DESC) AS rn,
           'vec_full'::text AS route
    FROM filtered WHERE embedding IS NOT NULL
    LIMIT $8
  ),
  r_vec_user AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding_user <=> $6::vector)) DESC) AS rn,
           'vec_user'::text AS route
    FROM filtered WHERE embedding_user IS NOT NULL
    LIMIT $8
  ),
  r_vec_asst AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding_assistant <=> $6::vector)) DESC) AS rn,
           'vec_asst'::text AS route
    FROM filtered WHERE embedding_assistant IS NOT NULL
    LIMIT $8
  ),
  r_lex AS (
    SELECT f.id,
           ROW_NUMBER() OVER (ORDER BY ts_rank_cd(
             to_tsvector('english', COALESCE(f.task_tag, '') || ' ' || COALESCE(f.content, '')),
             qfts.tsq) DESC) AS rn,
           'lexical'::text AS route
    FROM filtered f CROSS JOIN qfts
    WHERE qfts.tsq IS NOT NULL
      AND qfts.tsq <> ''::tsquery
      AND to_tsvector('english', COALESCE(f.task_tag, '') || ' ' || COALESCE(f.content, '')) @@ qfts.tsq
    LIMIT $8
  ),
  r_facet_pi AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding_facet_personal_info <=> $6::vector)) DESC) AS rn,
           'facet_personal_info'::text AS route
    FROM filtered WHERE embedding_facet_personal_info IS NOT NULL
    LIMIT $8
  ),
  r_facet_pref AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding_facet_preferences <=> $6::vector)) DESC) AS rn,
           'facet_preferences'::text AS route
    FROM filtered WHERE embedding_facet_preferences IS NOT NULL
    LIMIT $8
  ),
  r_facet_ev AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding_facet_events <=> $6::vector)) DESC) AS rn,
           'facet_events'::text AS route
    FROM filtered WHERE embedding_facet_events IS NOT NULL
    LIMIT $8
  ),
  r_vec_next_user AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY (1 - (embedding_next_user <=> $6::vector)) DESC) AS rn,
           'vec_next_user'::text AS route
    FROM filtered WHERE embedding_next_user IS NOT NULL
    LIMIT $8
  ),
  rrf AS (
    SELECT id,
           SUM(1.0 / (15 + rn)) AS rrf_score,
           ARRAY_AGG(DISTINCT route ORDER BY route) AS routes
    FROM (
      SELECT id, rn, route FROM r_vec_full
      UNION ALL SELECT id, rn, route FROM r_vec_user
      UNION ALL SELECT id, rn, route FROM r_vec_asst
      UNION ALL SELECT id, rn, route FROM r_lex
      UNION ALL SELECT id, rn, route FROM r_facet_pi
      UNION ALL SELECT id, rn, route FROM r_facet_pref
      UNION ALL SELECT id, rn, route FROM r_facet_ev
      UNION ALL SELECT id, rn, route FROM r_vec_next_user
    ) u
    GROUP BY id
  )
  SELECT f.id AS chunk_id, f.memory_id, f.content, f.tags, f.task_tag, f.score, f.timestamp_ms,
         f.session_id, f.agent_id, f.user_id, f.memory_kind, f.source, f.next_user_text,
         f.embedding::text AS embedding,
         r.rrf_score,
         r.routes
  FROM rrf r
  JOIN filtered f ON f.id = r.id
  ORDER BY r.rrf_score DESC
  LIMIT $9`;

  const r = await query(phase1Sql, [
    tenant_id, scope,
    session_id || null, agent_id || null, user_id || null,
    qvecLiteral, q,
    routeLimit,
    candidateLimit,
  ]);
  console.log('[memsense-search] phase 1 returned:', r.rows.length, 'candidates');
  r.rows.forEach((row, i) => {
    const n = Number(row?.rrf_score);
    console.log(
      `[memsense-search] phase1[${i}]: rrf_score=${Number.isFinite(n) ? n.toFixed(4) : row?.rrf_score}, routes=${(row?.routes || []).join(',')}`,
    );
  });

  const turnSupport = buildTurnSupport(r.rows);
  const supportedSessionRows = await fetchSessionRowsForSupport({
    tenant_id,
    scope,
    agent_id,
    user_id,
    sessionIds: [...turnSupport.keys()],
  });
  const sessionRows = uniqueRowsByChunkId([
    ...r.rows.filter((row) => row?.source === EVAL_SESSION_SOURCE),
    ...supportedSessionRows,
  ]);

  if (sessionRows.length) {
    console.log('[memsense-search] phase 2: session-first hybrid rerank to top_k=', top_k);
    const boosted = sessionRows.map((row) => {
      const support = turnSupport.get(row.session_id);
      const sessionRrf = Number(row.rrf_score) || 0;
      const turnSupportScore = support ? Math.min(0.12, 0.6 * Number(support.best_turn_rrf_score || 0)) : 0;
      const routes = Array.isArray(row.routes) ? [...row.routes] : [];
      if (turnSupportScore > 0 && !routes.includes('turn_support')) routes.push('turn_support');
      return {
        ...row,
        rrf_score: sessionRrf + turnSupportScore,
        routes,
        session_rrf_score: sessionRrf,
        turn_support: turnSupportScore,
        supporting_turn_count: support?.supporting_turn_count || 0,
        best_turn_routes: support?.best_turn_routes || [],
      };
    });
    const final = hybridRerank(boosted, Number(top_k)).map((chunk) => ({
      ...chunk,
      neighbors: [],
      explain: {
        ...chunk.explain,
        session_first: true,
        session_rrf_score: chunk.session_rrf_score,
        turn_support: chunk.turn_support,
        supporting_turn_count: chunk.supporting_turn_count,
        best_turn_routes: chunk.best_turn_routes,
      },
    }));
    console.log('[memsense-search] final session-first result:', final.length, 'chunks');
    return toPublicSearchChunks(final);
  }

  // Phase 2 fallback: MMR 去重，返回 top_k
  console.log('[memsense-search] phase 2: fallback MMR dedup to top_k=', top_k);
  const final = hybridRerank(r.rows, Number(top_k));
  console.log('[memsense-search] final fallback result:', final.length, 'chunks');

  // Phase 3 fallback: 邻居扩展（neighbor expansion）
  // 对每条 core chunk（session_id 非空时），查同 source + 同 session 时序上前后各 1 条。
  // 邻居不参与排序，挂到 chunk.neighbors 供 prompt formatter 拼接额外上下文。
  const neighborSql = `
    (SELECT memory_id, content, tags, task_tag, score, timestamp_ms, session_id, memory_kind, source,
            next_user_text, -1 AS neighbor_distance
     FROM memory_chunks
     WHERE tenant_id = $1 AND scope = $2 AND session_id = $3
       AND ($6::text IS NULL OR agent_id = $6)
       AND ($7::text IS NULL OR user_id = $7)
       AND ($8::text IS NULL OR source = $8)
       AND status = 'active'
       AND (timestamp_ms < $4 OR (timestamp_ms = $4 AND id < $5))
     ORDER BY timestamp_ms DESC, id DESC LIMIT 1)
    UNION ALL
    (SELECT memory_id, content, tags, task_tag, score, timestamp_ms, session_id, memory_kind, source,
            next_user_text, 1 AS neighbor_distance
     FROM memory_chunks
     WHERE tenant_id = $1 AND scope = $2 AND session_id = $3
       AND ($6::text IS NULL OR agent_id = $6)
       AND ($7::text IS NULL OR user_id = $7)
       AND ($8::text IS NULL OR source = $8)
       AND status = 'active'
       AND (timestamp_ms > $4 OR (timestamp_ms = $4 AND id > $5))
     ORDER BY timestamp_ms ASC, id ASC LIMIT 1)`;
  for (const chunk of final) {
    if (!chunk.session_id) {
      chunk.neighbors = [];
      continue;
    }
    const nr = await query(neighborSql, [
      tenant_id,
      scope,
      chunk.session_id,
      chunk.timestamp_ms,
      chunk.chunk_id,
      agent_id || null,
      user_id || null,
      chunk.source || null,
    ]);
    chunk.neighbors = nr.rows.map((row) => ({
      memory_id: row.memory_id,
      content: row.content,
      tags: row.tags,
      task_tag: row.task_tag,
      score: Number(row.score),
      timestamp_ms: Number(row.timestamp_ms),
      session_id: row.session_id,
      memory_kind: row.memory_kind,
      source: row.source,
      next_user_text: row.next_user_text ?? null,
      neighbor_distance: Number(row.neighbor_distance),
    }));
  }
  console.log('[memsense-search] neighbor expansion done');

  return toPublicSearchChunks(final);
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
