import test from 'node:test';
import assert from 'node:assert/strict';
import { stripMessageEnvelope, normalizeNaturalText, pickFinalAssistantText, buildQaFromHistory } from '../src/capture/message-normalize.js';
import { canonicalizeUserText, canonicalizeAssistantText, selectFinalAssistantText } from '../src/capture/canonical-qa.js';

test('stripMessageEnvelope removes sender metadata wrapper and timestamp header', () => {
  const raw = `Sender (untrusted metadata):\n\`\`\`json\n{\n  "label": "openclaw-tui (gateway-client)",\n  "id": "gateway-client"\n}\n\`\`\`\n\n[Mon 2026-03-16 21:44 GMT+8] 你要用tool来记录`;
  const out = stripMessageEnvelope(raw);
  assert.equal(out, '你要用tool来记录');
});

test('normalizeNaturalText strips reply tag', () => {
  assert.equal(normalizeNaturalText('[[reply_to_current]] 最终答复'), '最终答复');
});

test('pickFinalAssistantText prefers last non-empty assistant text', () => {
  const out = pickFinalAssistantText(['我先查一下', '', '最终结论在这里']);
  assert.equal(out, '最终结论在这里');
});

test('buildQaFromHistory uses final assistant message for a user turn', () => {
  const rows = buildQaFromHistory([
    { role: 'user', content: '记一下这个结论' },
    { role: 'assistant', content: '我先看一下' },
    { role: 'assistant', content: '[[reply_to_current]] 最终结论：应该走 contract-driven dashboard' },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user, '记一下这个结论');
  assert.equal(rows[0].assistant, '最终结论：应该走 contract-driven dashboard');
});

test('canonicalizeUserText removes sender envelope and timestamp', () => {
  const raw = `Sender (untrusted metadata):\n\`\`\`json\n{"id":"gateway-client"}\n\`\`\`\n\n[Tue 2026-03-17 14:53 GMT+8] 继续做`;
  assert.equal(canonicalizeUserText(raw), '继续做');
});

test('selectFinalAssistantText skips filler progress text', () => {
  const out = selectFinalAssistantText(['我先看一下', '我直接查一下', '[[reply_to_current]] 最终结论：已经修好']);
  assert.equal(out, '最终结论：已经修好');
});

test('canonicalizeAssistantText drops NO_REPLY sentinel', () => {
  assert.equal(canonicalizeAssistantText('NO_REPLY'), '');
});
