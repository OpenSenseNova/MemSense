import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAutoCaptureContent,
  hasOpenClawHeartbeatAssistant,
  isOpenClawHeartbeatAssistantText,
  isOpenClawHeartbeatText,
  prepareAutoCaptureUser,
  selectAutoCaptureAssistant,
} from '../src/capture/auto-capture.js';
import { TriggerPipeline } from '../src/trigger/trigger-pipeline.js';

test('auto capture skips OpenClaw heartbeat poll', () => {
  const r = prepareAutoCaptureUser('[OpenClaw heartbeat poll]', new TriggerPipeline());
  assert.equal(r.shouldCapture, false);
  assert.equal(r.reason, 'system_heartbeat');
});

test('OpenClaw heartbeat matcher handles optional brackets', () => {
  assert.equal(isOpenClawHeartbeatText('[OpenClaw heartbeat poll]'), true);
  assert.equal(isOpenClawHeartbeatText('OpenClaw heartbeat poll'), true);
  assert.equal(isOpenClawHeartbeatText('OpenClaw normal user request'), false);
});

test('auto capture skips normal prompt with no trigger', () => {
  const r = prepareAutoCaptureUser('今天天气不错', new TriggerPipeline());
  assert.equal(r.shouldCapture, false);
  assert.equal(r.reason, 'no_trigger');
});

test('auto capture accepts explicit save trigger', () => {
  const r = prepareAutoCaptureUser('记住这个：我喜欢短回答', new TriggerPipeline());
  assert.equal(r.shouldCapture, true);
  assert.deepEqual(r.decision.tags, ['explicit_save']);
});

test('auto capture assistant selector drops heartbeat sentinel', () => {
  const assistant = selectAutoCaptureAssistant({ lastAssistant: { content: 'HEARTBEAT_OK' } });
  assert.equal(assistant, '');
});

test('OpenClaw heartbeat assistant matcher handles sentinel output', () => {
  assert.equal(isOpenClawHeartbeatAssistantText('HEARTBEAT_OK'), true);
  assert.equal(hasOpenClawHeartbeatAssistant({ lastAssistant: { content: 'HEARTBEAT_OK' } }), true);
  assert.equal(hasOpenClawHeartbeatAssistant({ assistantTexts: ['HEARTBEAT_OK'] }), true);
  assert.equal(hasOpenClawHeartbeatAssistant({ assistantTexts: ['final answer', 'HEARTBEAT_OK'] }), false);
  assert.equal(hasOpenClawHeartbeatAssistant({ lastAssistant: { content: 'normal answer' } }), false);
});

test('auto capture content refuses empty canonical assistant', () => {
  const content = buildAutoCaptureContent({ user: '[OpenClaw heartbeat poll]', assistant: 'HEARTBEAT_OK' });
  assert.equal(content, '');
});
