CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_chunks (
  id BIGSERIAL PRIMARY KEY,
  memory_id TEXT UNIQUE NOT NULL,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  content TEXT NOT NULL,
  type_hint TEXT NOT NULL DEFAULT 'qa_chunk',
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
CREATE INDEX IF NOT EXISTS idx_chunks_user
  ON memory_chunks (tenant_id, scope, user_id, timestamp_ms DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_status
  ON memory_chunks (tenant_id, scope, status, timestamp_ms DESC);

CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_ivfflat
  ON memory_chunk_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS memory_events (
  id BIGSERIAL PRIMARY KEY,
  memory_id TEXT,
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
