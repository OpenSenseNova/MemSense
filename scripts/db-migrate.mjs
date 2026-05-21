import { loadDotEnv } from '../src/env/load-env.js';

await loadDotEnv();
const [{ applySchemaMigration, getSchemaReadiness }, { pool }] = await Promise.all([
  import('../src/server/db/readiness.js'),
  import('../src/server/db/client.js'),
]);

await applySchemaMigration();
const readiness = await getSchemaReadiness();
if (!readiness.ok) {
  throw new Error(`[memsense] migration finished but schema is not ready: ${JSON.stringify(readiness)}`);
}
console.log('[memsense] migration done');
await pool.end();
