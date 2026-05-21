import fs from 'node:fs/promises';
import path from 'node:path';
import { pool, query } from './client.js';

export const REQUIRED_TABLES = [
  'memory_chunks',
  'memory_chunk_embeddings',
  'embedding_jobs',
  'embedding_dlq',
  'tag_jobs',
  'tag_dlq',
];

export const REQUIRED_COLUMNS = {
  memory_chunks: [
    'agent_id',
    'memory_kind',
    'facet_personal_info',
    'facet_preferences',
    'facet_events',
    'next_user_text',
  ],
  memory_chunk_embeddings: [
    'embedding_user',
    'embedding_assistant',
    'embedding_facet_personal_info',
    'embedding_facet_preferences',
    'embedding_facet_events',
    'embedding_next_user',
  ],
};

const MIGRATION_LOCK_KEYS = [205750, 20260521];

async function readSchemaSql() {
  const candidates = [
    new URL('./schema.sql', import.meta.url),
    path.join(process.cwd(), 'src/server/db/schema.sql'),
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function applySchemaMigration() {
  const sql = await readSchemaSql();
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', MIGRATION_LOCK_KEYS);
    try {
      await client.query(sql);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', MIGRATION_LOCK_KEYS);
    }
  } finally {
    client.release();
  }
}

export function evaluateSchemaReadiness({ tables = [], columns = [] } = {}) {
  const existingTables = new Set(tables.map((r) => (typeof r === 'string' ? r : r.tablename || r.table_name)));
  const missingTables = REQUIRED_TABLES.filter((name) => !existingTables.has(name));

  const existingColumns = new Set(columns.map((r) => `${r.table_name}.${r.column_name}`));
  const missingColumns = [];
  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    if (!existingTables.has(tableName)) continue;
    for (const columnName of requiredColumns) {
      if (!existingColumns.has(`${tableName}.${columnName}`)) {
        missingColumns.push({ table: tableName, column: columnName });
      }
    }
  }

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
    requiredTables: [...REQUIRED_TABLES],
    requiredColumns: REQUIRED_COLUMNS,
  };
}

export async function getSchemaReadiness() {
  const tableRows = await query(
    `SELECT tablename
       FROM pg_tables
      WHERE schemaname = current_schema()
        AND tablename = ANY($1::text[])
      ORDER BY tablename`,
    [REQUIRED_TABLES],
  );

  const columnRows = await query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
      ORDER BY table_name, column_name`,
    [Object.keys(REQUIRED_COLUMNS)],
  );

  return evaluateSchemaReadiness({ tables: tableRows.rows, columns: columnRows.rows });
}

export async function assertSchemaReady(component = 'memsense') {
  let readiness = await getSchemaReadiness();
  if (!readiness.ok) {
    await applySchemaMigration();
    readiness = await getSchemaReadiness();
  }
  if (readiness.ok) return readiness;

  const missingColumns = readiness.missingColumns
    .map((item) => `${item.table}.${item.column}`)
    .join(', ');
  const hint = [
    'Database schema is not up to date.',
    `Missing tables: ${readiness.missingTables.join(', ')}`,
    `Missing columns: ${missingColumns}`,
    'Run the migration with environment loaded, for example:',
    '  npm run db:migrate',
  ].join('\n');

  const err = new Error(`[${component}] ${hint}`);
  err.code = 'SCHEMA_NOT_READY';
  err.readiness = readiness;
  throw err;
}
