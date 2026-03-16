import test from 'node:test';
import assert from 'node:assert/strict';
import { detectExplicitSave } from '../src/trigger/explicit-trigger.js';
import { RuleTrigger } from '../src/trigger/rule-trigger.js';
import { TriggerPipeline } from '../src/trigger/trigger-pipeline.js';

test('explicit trigger detects direct save intent', () => {
  const r = detectExplicitSave('记住这个，之后都这样做');
  assert.equal(r.matched, true);
});

test('rule trigger matches preference text', () => {
  const rt = new RuleTrigger();
  const r = rt.match('我喜欢简洁的输出');
  assert.equal(r.matched, true);
  assert.ok(r.tags.includes('preference'));
});

test('pipeline gives explicit higher priority than rule', () => {
  const p = new TriggerPipeline();
  const r = p.decide('记住这个，我喜欢热美式');
  assert.equal(r.shouldSave, true);
  assert.equal(r.source, 'explicit');
});
