import { query } from '../server/db/client.js';

export async function claimNextEmbeddingJob() {
  const sql = `WITH cte AS (
    SELECT id FROM embedding_jobs
    WHERE status = 'pending' AND run_at <= NOW()
    ORDER BY run_at ASC, id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE embedding_jobs j
  SET status = 'running', updated_at = NOW()
  FROM cte
  WHERE j.id = cte.id
  RETURNING j.*`;
  const r = await query(sql);
  return r.rows[0] || null;
}

export async function markJobDone(id) {
  await query(`UPDATE embedding_jobs SET status='done', updated_at=NOW() WHERE id=$1`, [id]);
  await query(`SELECT pg_notify('memsense_jobs', 'emb_done')`);
}

export async function markJobRetry(id, attempts, err) {
  const nextSec = Math.min(300, Math.pow(2, attempts));
  await query(
    `UPDATE embedding_jobs
     SET status='pending', attempts=attempts+1, last_error=$2, run_at = NOW() + ($3 || ' seconds')::interval, updated_at=NOW()
     WHERE id=$1`,
    [id, String(err || 'error').slice(0, 1000), String(nextSec)],
  );
}

export async function markJobDlq(job, err) {
  await query(`UPDATE embedding_jobs SET status='failed', updated_at=NOW(), last_error=$2 WHERE id=$1`, [job.id, String(err || 'error').slice(0, 1000)]);
  await query(
    `INSERT INTO embedding_dlq (job_id, chunk_id, payload, error) VALUES ($1,$2,$3::jsonb,$4)`,
    [job.id, job.chunk_id, JSON.stringify(job.payload || {}), String(err || 'error').slice(0, 2000)],
  );
  await query(`SELECT pg_notify('memsense_jobs', 'emb_failed')`);
}
