export function stripMessageEnvelope(text) {
  let t = String(text || '').trim();
  t = t.replace(/^System:\s*\[[^\]]*GMT[+-]\d+\]\s*[^\n]*\n\n/i, '');
  t = t.replace(/^System:\s*\[[^\]]*GMT[+-]\d+\]\s*[^\n]*$/i, '');
  t = t.replace(/^Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/i, '');
  t = t.replace(/^```json\s*[\s\S]*?```\s*/i, '');
  t = t.replace(/^\[[^\]]*GMT[+-]\d+\]\s*/im, '');
  t = t.replace(/^(Sender|Quoted message|Forwarded|metadata)\s*:\s*[\s\S]*?\n(?=\S)/i, '');
  return t.trim();
}

export function stripStructuredNoise(text) {
  let t = stripMessageEnvelope(String(text || ''));
  t = t.replace(/^\[\[\s*reply_to:[^\]]+\]\]\s*/i, '');
  t = t.replace(/^\[\[\s*reply_to_current\s*\]\]\s*/i, '');
  t = t.replace(/```(?:json)?[\s\S]*?```/gi, ' ');
  t = t.replace(/\{\s*"(?:role|type|agent|session|tool|content)"[\s\S]*?\}/gi, ' ');
  t = t.replace(/(^|\n)\s*(agent|session|tool|role|run_id|session_id|agent_id)\s*:\s.*$/gim, ' ');
  t = t.replace(/\b(session_id|agent_id|run_id|tool_name)\b\s*=\s*[^\s]+/gi, ' ');
  t = t.replace(/<\/?[a-z][^>]*>/gi, ' ');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

export function normalizeNaturalText(text) {
  const t = stripStructuredNoise(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(type|role|agent|session|tool)\s*[:=]/i.test(line))
    .join('\n');
  return t.trim();
}

export function contentToText(content) {
  if (typeof content === 'string') return normalizeNaturalText(content);
  if (Array.isArray(content)) {
    return content
      .map((x) => {
        if (!x) return '';
        if (typeof x === 'string') return normalizeNaturalText(x);
        if (typeof x === 'object' && (!x.type || x.type === 'text') && typeof x.text === 'string') {
          return normalizeNaturalText(x.text);
        }
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof content?.text === 'string') return normalizeNaturalText(content.text);
  return '';
}

export function pickFinalAssistantText(texts) {
  if (!Array.isArray(texts)) return '';
  const normalized = texts.map((x) => normalizeNaturalText(String(x || ''))).filter(Boolean);
  return normalized.length ? normalized[normalized.length - 1] : '';
}

export function buildQaFromHistory(messages) {
  const out = [];
  let pendingUser = null;
  let assistantTexts = [];

  const flush = () => {
    if (!pendingUser) return;
    out.push({
      user: pendingUser.text,
      assistant: assistantTexts.length ? assistantTexts[assistantTexts.length - 1] : '',
      timestamp: pendingUser.ts,
    });
    pendingUser = null;
    assistantTexts = [];
  };

  for (const m of messages || []) {
    const role = String(m?.role || '');
    const text = contentToText(m?.content || m?.text || '');
    const ts = Number(m?.timestamp || Date.now());
    if (!text) continue;
    if (role === 'user') {
      flush();
      pendingUser = { text, ts };
      continue;
    }
    if (role === 'assistant' && pendingUser) {
      assistantTexts.push(text);
    }
  }
  flush();
  return out;
}
