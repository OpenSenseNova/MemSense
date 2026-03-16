function getEnv(name, fallback = '') {
  return process.env[name] || fallback;
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || json?.error || `embedding api failed: ${res.status}`);
  return json;
}

export async function embedText(text) {
  const provider = getEnv('MEMSENSE_EMBEDDING_PROVIDER', 'openai');
  const input = String(text || '').slice(0, Number(getEnv('MEMSENSE_EMBEDDING_MAX_CHARS', '4000')));
  if (!input) return [];

  if (provider === 'bge_http') {
    const url = getEnv('MEMSENSE_BGE_ENDPOINT', 'http://127.0.0.1:8000/embed');
    const json = await postJson(url, { input, model: getEnv('MEMSENSE_BGE_MODEL', 'bge-large-zh-v1.5') });
    const vec = json?.embedding || json?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error('bge_http invalid embedding response');
    return vec;
  }

  // openai-compatible endpoint: supports OpenAI or qwen embedding api with compatible format
  const baseUrl = getEnv('MEMSENSE_OPENAI_BASE_URL', 'https://api.openai.com/v1');
  const apiKey = getEnv('MEMSENSE_OPENAI_API_KEY');
  const model = getEnv('MEMSENSE_EMBEDDING_MODEL', 'text-embedding-3-small');
  if (!apiKey) throw new Error('MEMSENSE_OPENAI_API_KEY is required for openai provider');
  const json = await postJson(`${baseUrl.replace(/\/$/, '')}/embeddings`, { model, input }, { authorization: `Bearer ${apiKey}` });
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('openai-compatible invalid embedding response');
  return vec;
}

export function toPgVectorLiteral(vec) {
  return `[${vec.map((x) => Number(x).toFixed(8)).join(',')}]`;
}
