import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.MEMSENSE_DATABASE_URL,
  max: Number(process.env.MEMSENSE_DB_POOL_MAX || 20),
});

export async function query(text, params = []) {
  return pool.query(text, params);
}
