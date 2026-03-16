import fs from 'node:fs/promises';
import path from 'node:path';

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export async function loadDotEnv({ cwd = process.cwd(), file = '.env', override = false } = {}) {
  const envPath = path.join(cwd, file);
  let text;
  try {
    text = await fs.readFile(envPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { loaded: false, path: envPath };
    throw err;
  }

  let count = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!override && process.env[key] != null) continue;
    process.env[key] = stripQuotes(rawValue.trim());
    count += 1;
  }

  return { loaded: true, path: envPath, count };
}
