import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ALLOWED_KINDS = new Set(['stable', 'preference', 'episodic', 'ephemeral']);
const EMPTY_TAGGER_OUTPUT = { tags: [], memory_kind: 'episodic', summary: null, facets: {} };
let warnedOpenClawAutoUnavailable = false;

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function sanitizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 12);
}

function sanitizeMemoryKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  return ALLOWED_KINDS.has(k) ? k : 'episodic';
}

const ALLOWED_FACET_TYPES = new Set(['personal_info', 'preferences', 'events']);

// 将 LLM 输出的 facets 对象净化：只保留允许的类型，截断超长文本
export function sanitizeFacets(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_FACET_TYPES.has(k)) continue;
    const text = String(v || '').trim().slice(0, 500);
    if (text) out[k] = text;
  }
  return out;
}

export function tryExtractTaggerOutput(text) {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return { tags: v, memory_kind: 'episodic', summary: null, facets: {} };
    if (Array.isArray(v?.tags) || typeof v?.memory_kind === 'string') {
      return { tags: v.tags || [], memory_kind: v.memory_kind, summary: v.summary || null, facets: sanitizeFacets(v.facets) };
    }
    if (typeof v?.content === 'string') {
      const m = v.content.match(/\{[\s\S]*\}/);
      if (m) return tryExtractTaggerOutput(m[0]);
    }
  } catch {}
  const obj = String(text || '').match(/\{[\s\S]*\}/);
  if (obj) {
    try { return tryExtractTaggerOutput(obj[0]); } catch {}
  }
  const arr = String(text || '').match(/\[[\s\S]*\]/);
  if (arr) {
    try { return { tags: JSON.parse(arr[0]), memory_kind: 'episodic', summary: null, facets: {} }; } catch {}
  }
  return { tags: [], memory_kind: 'episodic', summary: null, facets: {} };
}

function getTagRetryLimit() {
  return parsePositiveInt(process.env.MEMSENSE_TAG_RETRY || 3, 3);
}

function buildTaggerPrompt(content) {
  return [
    'You are a background memory tagger. Return JSON only.',
    'Task: generate up to 8 concise tags, one memory_kind, a brief summary, and optional facets for this content.',
    'memory_kind must be exactly one of: stable, preference, episodic, ephemeral.',
    'Choose stable for long-lived facts or durable identity/preferences; preference for user preferences that can evolve over time; episodic for notable events/decisions/context; ephemeral for very short-lived instructions or temporary state.',
    'Tags rules: lowercase, short noun/verb phrases, no punctuation noise, no duplicate synonyms.',
    'Summary: one or two concise sentences (max 200 chars) capturing core topic and intent. Adapt to content: for events, include key 5W elements (who, what, when, where, why) as relevant; for documents or scientific information, distill the main finding or thesis like an abstract. Keep it factual and clear.',
    'Facets (optional): extract only the facet types that are explicitly present in the content.',
    '  - personal_info: concrete facts about the user (name, location, job, age, relationships, etc.)',
    '  - preferences: user likes/dislikes, habits, preferred tools, communication style, etc.',
    '  - events: specific dated or time-bound occurrences, actions taken, or decisions made.',
    'Omit a facet key entirely if no relevant content exists. Keep each facet value concise (max 200 chars).',
    'Output format: {"memory_kind": "preference", "tags": ["tag1", "tag2"], "summary": "brief summary", "facets": {"personal_info": "...", "preferences": "...", "events": "..."}}',
    `Input:\n${content}`,
  ].join('\n\n');
}

function loadTaggerConfig() {
  const provider = String(process.env.MEMSENSE_TAGGER_PROVIDER || 'auto').trim().toLowerCase();
  if (['none', 'off', 'false', '0'].includes(provider)) {
    return null;
  }

  if (provider === 'auto') {
    const baseUrl = process.env.MEMSENSE_TAGGER_BASE_URL;
    const apiKey = process.env.MEMSENSE_TAGGER_API_KEY;
    const model = process.env.MEMSENSE_TAGGER_MODEL;
    if (baseUrl && apiKey && model && model !== 'auto') {
      return { provider: 'openai', baseUrl, apiKey, model };
    }
    return {
      provider: 'openclaw_cli',
      autoDetect: true,
      cli: process.env.MEMSENSE_OPENCLAW_CLI || (process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw'),
      model: process.env.MEMSENSE_OPENCLAW_TAGGER_MODEL || process.env.MEMSENSE_TAGGER_MODEL || 'auto',
      timeoutMs: parsePositiveInt(process.env.MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS || 90000, 90000),
    };
  }

  if (provider === 'openclaw' || provider === 'openclaw_cli') {
    return {
      provider: 'openclaw_cli',
      autoDetect: false,
      cli: process.env.MEMSENSE_OPENCLAW_CLI || (process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw'),
      model: process.env.MEMSENSE_OPENCLAW_TAGGER_MODEL || process.env.MEMSENSE_TAGGER_MODEL || 'auto',
      timeoutMs: parsePositiveInt(process.env.MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS || 90000, 90000),
    };
  }

  const baseUrl = process.env.MEMSENSE_TAGGER_BASE_URL;
  const apiKey = process.env.MEMSENSE_TAGGER_API_KEY;
  const model = process.env.MEMSENSE_TAGGER_MODEL;
  if (provider && provider !== 'openai' && provider !== 'openai_compatible') {
    throw new Error(`unsupported MEMSENSE_TAGGER_PROVIDER: ${provider}`);
  }
  if (!baseUrl || !apiKey || !model) {
    if (provider === 'openai' || provider === 'openai_compatible') {
      throw new Error('MEMSENSE_TAGGER_PROVIDER=openai requires MEMSENSE_TAGGER_BASE_URL, MEMSENSE_TAGGER_API_KEY, and MEMSENSE_TAGGER_MODEL');
    }
    return null;
  }
  return { provider: 'openai', baseUrl, apiKey, model };
}

function getCompletionText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      return '';
    }).join('');
  }
  return '';
}

function hasTaggerSignal(out) {
  return Boolean(
    out?.tags?.length ||
    out?.summary ||
    Object.keys(out?.facets || {}).length
  );
}

function normalizeTaggerOutput(out) {
  return {
    tags: sanitizeTags(out.tags),
    memory_kind: sanitizeMemoryKind(out.memory_kind),
    summary: out.summary ? String(out.summary).slice(0, 200) : null,
    facets: out.facets || {},
  };
}

function isRetriableError(err) {
  const msg = String(err?.message || err || '');
  return /429|500|502|503|504|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|connection error|timeout/i.test(msg);
}

async function runOpenAiCompatibleTagger(prompt, cfg) {
  const { baseUrl, apiKey, model } = cfg;
  const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a background memory tagger. Return JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    }),
  });

  const rawBody = await response.text();
  if (!response.ok) {
    throw new Error(`tagger HTTP ${response.status}: ${rawBody.slice(0, 160)}`);
  }

  const body = JSON.parse(rawBody);
  return getCompletionText(body) || rawBody;
}

async function execOpenClaw(cli, args, timeoutMs) {
  try {
    const { stdout } = await execFileAsync(cli, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return String(stdout || '').trim();
  } catch (err) {
    const detail = String(err?.stderr || err?.stdout || err?.message || err || '').trim();
    throw new Error(`openclaw CLI failed: ${detail.slice(0, 240)}`);
  }
}

async function resolveOpenClawModel(cfg) {
  const configured = String(cfg.model || '').trim();
  if (configured && configured !== 'auto') return configured;
  try {
    const stdout = await execOpenClaw(cfg.cli, ['models', 'status', '--plain'], cfg.timeoutMs);
    const model = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    return model || null;
  } catch (err) {
    if (cfg.autoDetect) {
      if (!warnedOpenClawAutoUnavailable) {
        console.warn(`[tag-model] OpenClaw auto tagger unavailable; tagging skipped: ${err.message}`);
        warnedOpenClawAutoUnavailable = true;
      }
      return null;
    }
    console.warn(`[tag-model] openclaw default model lookup failed; falling back to CLI default: ${err.message}`);
    return null;
  }
}

function getOpenClawCliText(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return '';
  try {
    const body = JSON.parse(raw);
    const outputsText = Array.isArray(body?.outputs)
      ? body.outputs.map((item) => typeof item?.text === 'string' ? item.text : '').join('')
      : '';
    return getCompletionText(body) ||
      outputsText ||
      body?.content ||
      body?.text ||
      body?.output ||
      body?.message ||
      body?.response ||
      body?.result?.content ||
      body?.result?.text ||
      body?.data?.content ||
      body?.data?.text ||
      raw;
  } catch {
    return raw;
  }
}

async function runOpenClawCliTagger(prompt, cfg) {
  const model = await resolveOpenClawModel(cfg);
  if (!model && cfg.autoDetect) return null;
  const args = ['infer', 'model', 'run'];
  if (model) args.push('--model', model);
  args.push('--prompt', prompt, '--json');
  const stdout = await execOpenClaw(cfg.cli, args, cfg.timeoutMs);
  return getOpenClawCliText(stdout);
}

export async function generateTagsWithOpenClaw(content) {
  const prompt = buildTaggerPrompt(content);
  const cfg = loadTaggerConfig();
  if (!cfg) {
    return EMPTY_TAGGER_OUTPUT;
  }

  const retryLimit = getTagRetryLimit();
  let lastError = null;
  for (let attempt = 0; attempt < retryLimit; attempt++) {
    try {
      const text = cfg.provider === 'openclaw_cli'
        ? await runOpenClawCliTagger(prompt, cfg)
        : await runOpenAiCompatibleTagger(prompt, cfg);
      if (text == null && cfg.autoDetect) {
        return EMPTY_TAGGER_OUTPUT;
      }

      let out = { tags: [], memory_kind: 'episodic' };
      out = tryExtractTaggerOutput(text);

      if (hasTaggerSignal(out)) {
        return normalizeTaggerOutput(out);
      }

      lastError = `empty tags after parse (raw: ${String(text).slice(0, 120)}…)`;
      console.warn(`[tag-model] attempt ${attempt + 1}/${retryLimit}: ${lastError}`);
    } catch (err) {
      lastError = err.message || String(err);
      const retriable = isRetriableError(err);
      if (attempt === retryLimit - 1 || !retriable) {
        console.warn(`[tag-model] attempt ${attempt + 1}/${retryLimit} error: ${lastError}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000 + attempt * 2000));
    }
  }
  console.error(`[tag-model] all ${retryLimit} attempts exhausted – ${lastError}`);
  throw new Error(`tagger failed: ${lastError}`);
}

export function mergeTags(existing, generated) {
  return [...new Set([...(existing || []), ...(generated || [])])].slice(0, 20);
}
