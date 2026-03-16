import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDotEnv } from '../src/env/load-env.js';

test('loadDotEnv loads .env values into process.env', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memsense-env-'));
  await fs.writeFile(path.join(dir, '.env'), 'MEMSENSE_DATABASE_URL=postgresql://127.0.0.1:5432/memsense\nMEMSENSE_PORT=8787\n', 'utf8');

  delete process.env.MEMSENSE_DATABASE_URL;
  delete process.env.MEMSENSE_PORT;

  const out = await loadDotEnv({ cwd: dir });
  assert.equal(out.loaded, true);
  assert.equal(process.env.MEMSENSE_DATABASE_URL, 'postgresql://127.0.0.1:5432/memsense');
  assert.equal(process.env.MEMSENSE_PORT, '8787');
});
