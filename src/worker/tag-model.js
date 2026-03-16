import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
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

function tryExtractTaggerOutput(text) {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return { tags: v, memory_kind: 'episodic' };
    if (Array.isArray(v?.tags) || typeof v?.memory_kind === 'string') {
      return { tags: v.tags || [], memory_kind: v.memory_kind };
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
    try { return { tags: JSON.parse(arr[0]), memory_kind: 'episodic' }; } catch {}
  }
  return { tags: [], memory_kind: 'episodic' };
}

export async function generateTagsWithOpenClaw(content) {
  const prompt = [
    'You are a background memory tagger. Return JSON only.',
    'Task: generate up to 8 concise tags and one memory_kind for this QA chunk.',
    'memory_kind must be exactly one of: stable, preference, episodic, ephemeral.',
    'Choose stable for long-lived facts or durable identity/preferences; preference for user preferences that can evolve over time; episodic for notable events/decisions/context; ephemeral for very short-lived instructions or temporary state.',
    'Tags rules: lowercase, short noun/verb phrases, no punctuation noise, no duplicate synonyms.',
    'Output format: {"memory_kind": "preference", "tags": ["tag1", "tag2"]}',
    `Input:\n${content}`,
  ].join('\n\n');

  const { stdout } = await execFileAsync('openclaw', [
    'agent',
    '--session-id', 'memsense-tagger',
    '--message', prompt,
    '--json',
    '--timeout', '90',
  ], { maxBuffer: 1024 * 1024 });

  let out = { tags: [], memory_kind: 'episodic' };
  try {
    const j = JSON.parse(stdout);
    out = tryExtractTaggerOutput(j?.result || j?.output || j?.content || j?.message || stdout);
  } catch {
    out = tryExtractTaggerOutput(stdout);
  }
  return { tags: sanitizeTags(out.tags), memory_kind: sanitizeMemoryKind(out.memory_kind) };
}

export function mergeTags(existing, generated) {
  return [...new Set([...(existing || []), ...(generated || [])])].slice(0, 20);
}
