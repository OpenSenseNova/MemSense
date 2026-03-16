import test from 'node:test';
import assert from 'node:assert/strict';

function stripStructuredNoise(text) {
  let t = String(text || '');
  t = t.replace(/```(?:json)?[\s\S]*?```/gi, ' ');
  t = t.replace(/\{\s*"(?:role|type|agent|session|tool|content)"[\s\S]*?\}/gi, ' ');
  t = t.replace(/(^|\n)\s*(agent|session|tool|role|run_id|session_id|agent_id)\s*:\s.*$/gim, ' ');
  t = t.replace(/\b(session_id|agent_id|run_id|tool_name)\b\s*=\s*[^\s]+/gi, ' ');
  t = t.replace(/<\/?[a-z][^>]*>/gi, ' ');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

function normalizeNaturalText(text) {
  const t = stripStructuredNoise(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(type|role|agent|session|tool)\s*[:=]/i.test(line))
    .join('\n');
  return t.trim();
}

test('cleaning removes obvious session and agent metadata lines', () => {
  const raw = 'session: abc\nagent: helper\n用户真正的问题是什么？';
  const cleaned = normalizeNaturalText(raw);
  assert.equal(cleaned, '用户真正的问题是什么？');
});

test('cleaning removes json wrapper noise and keeps natural language', () => {
  const raw = '{"type":"text","text":"hello"}\nHow do I deploy memsense?';
  const cleaned = normalizeNaturalText(raw);
  assert.equal(cleaned, 'How do I deploy memsense?');
});
