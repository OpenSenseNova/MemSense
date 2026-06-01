import { buildCanonicalQaJson, canonicalizeAssistantText, canonicalizeUserText, selectFinalAssistantText } from './canonical-qa.js';
import { contentToText } from './message-normalize.js';

export function stripInjectedMemoryContext(text) {
  return String(text || '').replace(/<relevant_context>[\s\S]*?<\/relevant_context>\s*/g, '').trim();
}

export function isOpenClawHeartbeatText(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  return /^\[?OpenClaw heartbeat poll\]?$/i.test(t);
}

export function isOpenClawHeartbeatAssistantText(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  return /^HEARTBEAT_OK$/i.test(t);
}

export function hasOpenClawHeartbeatAssistant(event) {
  const assistantTexts = Array.isArray(event?.assistantTexts) ? event.assistantTexts : [];
  const texts = [
    ...assistantTexts.map((x) => contentToText(x)),
    contentToText(event?.lastAssistant?.content || event?.lastAssistant?.text || ''),
  ].filter(Boolean);
  return texts.length > 0 && texts.every((x) => isOpenClawHeartbeatAssistantText(x));
}

export function prepareAutoCaptureUser(rawPrompt, triggerPipeline) {
  const user = canonicalizeUserText(stripInjectedMemoryContext(rawPrompt));
  if (!user) {
    return { shouldCapture: false, reason: 'empty_user', user: '', decision: null };
  }
  if (isOpenClawHeartbeatText(user)) {
    return { shouldCapture: false, reason: 'system_heartbeat', user, decision: null };
  }

  const decision = triggerPipeline.decide(user);
  return {
    shouldCapture: true,
    reason: decision.shouldSave ? 'triggered' : 'auto_capture',
    user,
    decision: {
      ...decision,
      shouldSave: true,
      source: decision.shouldSave ? decision.source : 'auto_capture',
    },
  };
}

export function selectAutoCaptureAssistant(event) {
  const fromAssistantTexts = selectFinalAssistantText(Array.isArray(event?.assistantTexts) ? event.assistantTexts : []);
  if (fromAssistantTexts) return fromAssistantTexts;

  return canonicalizeAssistantText(contentToText(event?.lastAssistant?.content || event?.lastAssistant?.text || ''));
}

export function buildAutoCaptureContent({ user, assistant }) {
  const normalizedAssistant = canonicalizeAssistantText(assistant);
  if (!canonicalizeUserText(user) || !normalizedAssistant) return '';
  return buildCanonicalQaJson({ user, assistant: normalizedAssistant });
}
