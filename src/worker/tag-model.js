import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sanitizeTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((x) => String(x || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

function tryExtractJsonArray(text) {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.tags)) return v.tags;
    if (typeof v?.content === 'string') {
      const m = v.content.match(/\[[\s\S]*\]/);
      if (m) return JSON.parse(m[0]);
    }
  } catch {}
  const m = String(text || '').match(/\[[\s\S]*\]/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return [];
}

export async function generateTagsWithOpenClaw(content) {
  const prompt = [
    'You are a background tagger. Return JSON only.',
    'Task: generate up to 8 concise tags for this QA chunk.',
    'Rules: lowercase, short noun/verb phrases, no punctuation noise.',
    'Output format: {"tags": ["tag1", "tag2"]}',
    `Input:\n${content}`,
  ].join('\n\n');

  const { stdout } = await execFileAsync('openclaw', [
    'agent',
    '--session-id', 'memsense-tagger',
    '--message', prompt,
    '--json',
    '--timeout', '90',
  ], { maxBuffer: 1024 * 1024 });

  let tags = [];
  try {
    const j = JSON.parse(stdout);
    tags = tryExtractJsonArray(j?.result || j?.output || j?.content || j?.message || stdout);
  } catch {
    tags = tryExtractJsonArray(stdout);
  }
  return sanitizeTags(tags);
}

export function mergeTags(existing, generated) {
  return [...new Set([...(existing || []), ...(generated || [])])].slice(0, 20);
}
