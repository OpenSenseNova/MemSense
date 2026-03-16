import { getConfig } from '../config.js';

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
  const cfg = getConfig();
  const provider = cfg.embedding.provider;
  const input = String(text || '').slice(0, cfg.embedding.maxChars);
  if (!input) return [];

  if (provider === 'bge_http') {
    const url = cfg.embedding.bgeEndpoint;
    const json = await postJson(url, { input, model: cfg.embedding.bgeModel, inputs: [input] });
    const vec = json?.embedding || json?.data?.[0]?.embedding || (Array.isArray(json) ? json[0] : null);
    if (!Array.isArray(vec)) throw new Error('bge_http invalid embedding response');
    return vec;
  }

  // openai-compatible endpoint: supports OpenAI or qwen embedding api with compatible format
  const baseUrl = cfg.embedding.openaiBaseUrl;
  const apiKey = cfg.embedding.openaiApiKey;
  const model = cfg.embedding.model;
  if (!apiKey) throw new Error('MEMSENSE_OPENAI_API_KEY is required for openai provider');
  const json = await postJson(`${baseUrl.replace(/\/$/, '')}/embeddings`, { model, input }, { authorization: `Bearer ${apiKey}` });
  const vec = json?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('openai-compatible invalid embedding response');
  return vec;
}

export function toPgVectorLiteral(vec) {
  return `[${vec.map((x) => Number(x).toFixed(8)).join(',')}]`;
}
