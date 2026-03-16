import pg from 'pg';
import { getConfig } from '../config.js';

const { Pool } = pg;
const config = getConfig();

export const pool = new Pool({
  connectionString: config.dbUrl,
  max: Number(process.env.MEMSENSE_DB_POOL_MAX || 20),
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
