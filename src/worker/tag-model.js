const ALLOWED_KINDS = new Set(['stable', 'preference', 'episodic', 'ephemeral']);

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

const TAG_RETRY_LIMIT = Number(process.env.MEMSENSE_TAG_RETRY || 3);

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
  const baseUrl = process.env.MEMSENSE_TAGGER_BASE_URL;
  const apiKey = process.env.MEMSENSE_TAGGER_API_KEY;
  const model = process.env.MEMSENSE_TAGGER_MODEL;
  if (!baseUrl || !apiKey || !model) {
    return null;
  }
  return { baseUrl, apiKey, model };
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

export async function generateTagsWithOpenClaw(content) {
  const prompt = buildTaggerPrompt(content);
  const cfg = loadTaggerConfig();
  if (!cfg) {
    return { tags: [], memory_kind: 'episodic', summary: null, facets: {} };
  }
  const { baseUrl, apiKey, model } = cfg;

  let lastError = null;
  for (let attempt = 0; attempt < TAG_RETRY_LIMIT; attempt++) {
    try {
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
      const text = getCompletionText(body) || rawBody;

      let out = { tags: [], memory_kind: 'episodic' };
      out = tryExtractTaggerOutput(text);

      if (out.tags && out.tags.length > 0) {
        return { tags: sanitizeTags(out.tags), memory_kind: sanitizeMemoryKind(out.memory_kind), summary: out.summary ? String(out.summary).slice(0, 200) : null, facets: out.facets || {} };
      }

      lastError = `empty tags after parse (raw: ${String(text).slice(0, 120)}…)`;
      console.warn(`[tag-model] attempt ${attempt + 1}/${TAG_RETRY_LIMIT}: ${lastError}`);
    } catch (err) {
      lastError = err.message || String(err);
      const retriable = err.message?.includes('429') || err.message?.includes('500') || err.message?.includes('502') || err.message?.includes('503') || err.message?.includes('ETIMEDOUT');
      if (attempt === TAG_RETRY_LIMIT - 1 || !retriable) {
        console.warn(`[tag-model] attempt ${attempt + 1}/${TAG_RETRY_LIMIT} error: ${lastError}`);
        if (!retriable) break;
      }
      await new Promise((r) => setTimeout(r, 1000 + attempt * 2000));
    }
  }
  console.error(`[tag-model] all ${TAG_RETRY_LIMIT} attempts exhausted – ${lastError}`);
  return { tags: [], memory_kind: 'episodic', summary: null, facets: {} };
}

export function mergeTags(existing, generated) {
  return [...new Set([...(existing || []), ...(generated || [])])].slice(0, 20);
}
