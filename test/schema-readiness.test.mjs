import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REQUIRED_COLUMNS,
  REQUIRED_TABLES,
  evaluateSchemaReadiness,
} from '../src/server/db/readiness.js';

function allRequiredColumnRows(exclude = new Set()) {
  const rows = [];
  for (const [tableName, columns] of Object.entries(REQUIRED_COLUMNS)) {
    for (const columnName of columns) {
      const key = `${tableName}.${columnName}`;
      if (!exclude.has(key)) {
        rows.push({ table_name: tableName, column_name: columnName });
      }
    }
  }
  return rows;
}

test('schema readiness fails when runtime-required columns are missing', () => {
  const readiness = evaluateSchemaReadiness({
    tables: REQUIRED_TABLES,
    columns: allRequiredColumnRows(new Set([
      'memory_chunks.next_user_text',
      'memory_chunk_embeddings.embedding_next_user',
    ])),
  });

  assert.equal(readiness.ok, false);
  assert.deepEqual(readiness.missingTables, []);
  assert.deepEqual(readiness.missingColumns, [
    { table: 'memory_chunks', column: 'next_user_text' },
    { table: 'memory_chunk_embeddings', column: 'embedding_next_user' },
  ]);
});

test('schema readiness passes when required tables and columns exist', () => {
  const readiness = evaluateSchemaReadiness({
    tables: REQUIRED_TABLES,
    columns: allRequiredColumnRows(),
  });

  assert.equal(readiness.ok, true);
  assert.deepEqual(readiness.missingTables, []);
  assert.deepEqual(readiness.missingColumns, []);
});
