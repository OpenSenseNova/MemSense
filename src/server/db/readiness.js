import { query } from './client.js';

const REQUIRED_TABLES = [
  'memory_chunks',
  'memory_chunk_embeddings',
  'embedding_jobs',
  'embedding_dlq',
  'tag_jobs',
  'tag_dlq',
];

export async function getSchemaReadiness() {
  const tableRows = await query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = current_schema()
        AND tablename = ANY($1::text[])
      ORDER BY tablename`,
    [REQUIRED_TABLES],
  );

  const existing = new Set(tableRows.rows.map((r) => r.tablename));
  const missingTables = REQUIRED_TABLES.filter((name) => !existing.has(name));

  return {
    ok: missingTables.length === 0,
    missingTables,
    requiredTables: [...REQUIRED_TABLES],
  };
}

export async function assertSchemaReady(component = 'memsense') {
  const readiness = await getSchemaReadiness();
  if (readiness.ok) return readiness;

  const hint = [
    'Database schema is not up to date.',
    `Missing tables: ${readiness.missingTables.join(', ')}`,
    'Run the migration with environment loaded, for example:',
    '  MEMSENSE_DATABASE_URL=$(grep \'^MEMSENSE_DATABASE_URL=\' .env | cut -d= -f2-) npm run db:migrate',
  ].join('\n');

  const err = new Error(`[${component}] ${hint}`);
  err.code = 'SCHEMA_NOT_READY';
  err.readiness = readiness;
  throw err;
}
