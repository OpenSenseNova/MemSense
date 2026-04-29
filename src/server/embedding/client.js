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

function extractEmbedding(json) {
  return json?.data?.[0]?.embedding || json?.data?.embedding || json?.embedding || (Array.isArray(json) ? json[0] : null);
}

function buildOpenAiEmbeddingRequest(baseUrl, model, input) {
  const trimmedBaseUrl = baseUrl.replace(/\/$/, '');
  const isDoubaoMultimodal = trimmedBaseUrl.includes('volces.com') && trimmedBaseUrl.includes('multimodal');
  if (isDoubaoMultimodal) {
    return {
      url: trimmedBaseUrl,
      body: { model, input: [{ type: 'text', text: input }] },
    };
  }
  return {
    url: `${trimmedBaseUrl}/embeddings`,
    body: { model, input },
  };
}

export async function embedText(text) {
  const cfg = getConfig();
  const provider = cfg.embedding.provider;
  const input = String(text || '').slice(0, cfg.embedding.maxChars);
  if (!input) return [];

  if (provider === 'bge_http') {
    const url = cfg.embedding.bgeEndpoint;
    const json = await postJson(url, { input, model: cfg.embedding.bgeModel, inputs: [input] });
    const vec = extractEmbedding(json);
    if (!Array.isArray(vec)) throw new Error('bge_http invalid embedding response');
    return vec;
  }

  // openai-compatible endpoint: supports OpenAI or qwen embedding api with compatible format
  const baseUrl = cfg.embedding.openaiBaseUrl;
  const apiKey = cfg.embedding.openaiApiKey;
  const model = cfg.embedding.model;
  if (!apiKey) throw new Error('MEMSENSE_OPENAI_API_KEY is required for openai provider');

  const { url, body } = buildOpenAiEmbeddingRequest(baseUrl, model, input);
  const json = await postJson(url, body, { authorization: `Bearer ${apiKey}` });
  const vec = extractEmbedding(json);
  if (!Array.isArray(vec)) throw new Error('openai-compatible invalid embedding response');
  return vec;
}

export function toPgVectorLiteral(vec) {
  return `[${vec.map((x) => Number(x).toFixed(8)).join(',')}]`;
}
