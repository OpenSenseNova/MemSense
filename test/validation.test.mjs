import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWriteInput, sanitizeTags, clamp01 } from '../src/core/validation.js';

test('clamp01 clamps values and fallback', () => {
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01('bad', 0.3), 0.3);
});

test('sanitizeTags keeps non-empty tags and max 20', () => {
  const tags = sanitizeTags(['  a ', '', null, 'b', ...Array.from({ length: 30 }, (_, i) => `t${i}`)]);
  assert.ok(tags.includes('a'));
  assert.ok(tags.includes('b'));
  assert.equal(tags.length, 20);
});

test('validateWriteInput trims content and normalizes fields', () => {
  const out = validateWriteInput({ content: '  hello  ', score: 9, confidence: -1, tags: [' x '] });
  assert.equal(out.content, 'hello');
  assert.equal(out.score, 1);
  assert.equal(out.confidence, 0);
  assert.deepEqual(out.tags, ['x']);
});

test('validateWriteInput rejects empty/oversized content', () => {
  assert.throws(() => validateWriteInput({ content: '   ' }), /content is required/);
  assert.throws(() => validateWriteInput({ content: 'x'.repeat(5001) }), /content too long/);
});
