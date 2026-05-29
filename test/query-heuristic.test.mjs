import test from 'node:test';
import assert from 'node:assert/strict';

function isMeaningfulQuery(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.length < 4) return false;
  if (/^\[?OpenClaw heartbeat poll\]?$/i.test(t)) return false;
  if (/^(hi|hello|hey|你好|在吗|在？|在吗？|谢谢|thanks|ok|好的|嗯嗯)$/i.test(t)) return false;
  if (/^[?？!！。.，,\s]+$/.test(t)) return false;
  return true;
}

test('meaningful query heuristic rejects greetings and short fillers', () => {
  assert.equal(isMeaningfulQuery('你好'), false);
  assert.equal(isMeaningfulQuery('ok'), false);
  assert.equal(isMeaningfulQuery('???'), false);
  assert.equal(isMeaningfulQuery('[OpenClaw heartbeat poll]'), false);
});

test('meaningful query heuristic accepts substantive questions', () => {
  assert.equal(isMeaningfulQuery('帮我总结一下这个项目的架构'), true);
  assert.equal(isMeaningfulQuery('How should I deploy memsense without docker?'), true);
});
