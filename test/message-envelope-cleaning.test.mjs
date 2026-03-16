import test from 'node:test';
import assert from 'node:assert/strict';

function stripMessageEnvelope(text) {
  let t = String(text || '').trim();
  t = t.replace(/^Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/i, '');
  t = t.replace(/^```json\s*[\s\S]*?```\s*/i, '');
  t = t.replace(/^\[[^\]]*GMT[+-]\d+\]\s*/im, '');
  t = t.replace(/^(Sender|Quoted message|Forwarded|metadata)\s*:\s*[\s\S]*?\n(?=\S)/i, '');
  return t.trim();
}

test('stripMessageEnvelope removes sender metadata wrapper and timestamp header', () => {
  const raw = `Sender (untrusted metadata):\n\`\`\`json\n{\n  "label": "openclaw-tui (gateway-client)",\n  "id": "gateway-client"\n}\n\`\`\`\n\n[Mon 2026-03-16 21:44 GMT+8] 你要用tool来记录`;
  const out = stripMessageEnvelope(raw);
  assert.equal(out, '你要用tool来记录');
});

test('stripMessageEnvelope leaves plain text untouched', () => {
  const raw = '帮我总结一下当前memory设计';
  const out = stripMessageEnvelope(raw);
  assert.equal(out, raw);
});
