CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_chunks (
  id BIGSERIAL PRIMARY KEY,
  memory_id TEXT UNIQUE NOT NULL,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  session_id TEXT,
  agent_id TEXT,
  user_id TEXT,
  content TEXT NOT NULL,
  type_hint TEXT NOT NULL DEFAULT 'qa_chunk',
  memory_kind TEXT NOT NULL DEFAULT 'episodic',
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_tag TEXT,
  source TEXT NOT NULL DEFAULT 'session',
  score DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  timestamp_ms BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS memory_kind TEXT;
ALTER TABLE memory_chunks ADD COLUMN IF NOT EXISTS agent_id TEXT;
ALTER TABLE memory_chunks ALTER COLUMN memory_kind SET DEFAULT 'episodic';
UPDATE memory_chunks SET memory_kind = 'episodic' WHERE memory_kind IS NULL;
ALTER TABLE memory_chunks ALTER COLUMN memory_kind SET NOT NULL;

CREATE TABLE IF NOT EXISTS memory_chunk_embeddings (
  chunk_id BIGINT PRIMARY KEY REFERENCES memory_chunks(id) ON DELETE CASCADE,
  embedding vector NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_tenant_scope_time
  ON memory_chunks (tenant_id, scope, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_session
  ON memory_chunks (tenant_id, scope, session_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_agent
  ON memory_chunks (tenant_id, scope, agent_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_user
  ON memory_chunks (tenant_id, scope, user_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_agent_session
  ON memory_chunks (tenant_id, scope, agent_id, session_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_status
  ON memory_chunks (tenant_id, scope, status, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_kind_time
  ON memory_chunks (tenant_id, scope, memory_kind, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_fts_simple
  ON memory_chunks USING GIN (to_tsvector('simple', COALESCE(content, '')));

-- NOTE:
-- Some pgvector versions require fixed dimensions (for example vector(1024))
-- before building ivfflat indexes. We keep the embedding column dimension-flexible
-- here so different embedding backends can work in local/no-docker setups.
-- For small/self-hosted deployments, sequential scan is acceptable.
-- Add an ANN index later once dimensions are standardized.

CREATE TABLE IF NOT EXISTS memory_events (
  id BIGSERIAL PRIMARY KEY,
  memory_id TEXT,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id BIGSERIAL PRIMARY KEY,
  chunk_id BIGINT NOT NULL REFERENCES memory_chunks(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_embedding_jobs_status_runat ON embedding_jobs(status, run_at);

CREATE TABLE IF NOT EXISTS embedding_dlq (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL,
  chunk_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  error TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tag_jobs (
  id BIGSERIAL PRIMARY KEY,
  chunk_id BIGINT NOT NULL REFERENCES memory_chunks(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tag_jobs_status_runat ON tag_jobs(status, run_at);

CREATE TABLE IF NOT EXISTS tag_dlq (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL,
  chunk_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  error TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
