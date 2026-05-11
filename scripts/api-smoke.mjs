const BASE = process.env.MEMSENSE_SMOKE_BASE_URL || 'http://127.0.0.1:8787';
const TOKEN = process.env.MEMSENSE_SMOKE_TOKEN || 'demo';
const headers = { 'content-type': 'application/json', 'x-memsense-token': TOKEN };

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) throw new Error(`GET ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) throw new Error(`POST ${path} failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('[smoke] base=', BASE);

  const health = await get('/healthz');
  assert(health.ok === true, 'healthz should return ok=true');
  console.log('[smoke] healthz ok');

  const setup = await get('/v1/system/setup-status');
  assert(setup.ok === true, 'setup-status should return ok=true');
  console.log('[smoke] setup-status ok');

  const pipeline = await get('/v1/dashboard/pipeline_status');
  assert(pipeline.ok === true, 'pipeline_status should return ok=true');
  const hasChunksSection = pipeline.data?.sections?.some((s) => s?.key === 'chunks');
  assert(hasChunksSection, 'pipeline_status should include chunks section');
  console.log('[smoke] pipeline_status ok');

  const recent = await post('/v1/memory/fetch_recent', { tenant_id: 'default', scope: 'user', limit: 5 });
  assert(recent.ok === true, 'fetch_recent should return ok=true');
  assert(Array.isArray(recent.data?.chunks), 'fetch_recent should return chunks array');
  console.log('[smoke] fetch_recent ok');

  const search = await post('/v1/memory/search', { tenant_id: 'default', scope: 'user', query: 'test', top_k: 5 });
  assert(search.ok === true, 'search should return ok=true');
  assert(Array.isArray(search.data?.chunks), 'search should return chunks array');
  console.log('[smoke] search ok');

  const overview = await post('/v1/dashboard/overview', { limit: 10 });
  assert(overview.ok === true, 'overview should return ok=true');
  assert(overview.data?.counts, 'overview should return counts');
  console.log('[smoke] dashboard overview ok');

  console.log('\n[smoke] all api smoke checks passed');
}

main().catch((err) => {
  console.error('\n[smoke] FAILED');
  console.error(err?.stack || String(err));
  process.exit(1);
});
