import fs from 'node:fs/promises';
import { pool } from '../src/server/db/client.js';

const sql = await fs.readFile(new URL('../src/server/db/schema.sql', import.meta.url), 'utf8');
await pool.query(sql);
console.log('[memsense] migration done');
await pool.end();
