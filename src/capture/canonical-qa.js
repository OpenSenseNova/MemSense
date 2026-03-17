import { normalizeNaturalText, pickFinalAssistantText } from './message-normalize.js';

const ASSISTANT_FILLER_PATTERNS = [
  /^我先(?:看一下|查一下|确认一下|处理一下|过一遍)/,
  /^我直接(?:看|查|处理|开始|去)/,
  /^先(?:看一下|查一下|确认一下|处理一下)/,
  /^(?:稍等|等一下|我来看看)/,
];

const ASSISTANT_SILENT_PATTERNS = [
  /^NO_REPLY$/i,
  /^HEARTBEAT_OK$/i,
];

export function canonicalizeUserText(raw) {
  return normalizeNaturalText(String(raw || ''));
}

export function isAssistantFillerText(text) {
  const t = normalizeNaturalText(String(text || ''));
  if (!t) return true;
  return ASSISTANT_FILLER_PATTERNS.some((p) => p.test(t));
}

export function canonicalizeAssistantText(raw) {
  const t = normalizeNaturalText(String(raw || ''));
  if (!t) return '';
  if (ASSISTANT_SILENT_PATTERNS.some((p) => p.test(t))) return '';
  return t;
}

export function selectFinalAssistantText(texts) {
  const normalized = Array.isArray(texts)
    ? texts.map((x) => canonicalizeAssistantText(x)).filter(Boolean)
    : [];
  if (!normalized.length) return '';
  const nonFiller = normalized.filter((t) => !isAssistantFillerText(t));
  return pickFinalAssistantText(nonFiller.length ? nonFiller : normalized);
}

export function buildCanonicalQa({ user, assistant }) {
  return {
    user: canonicalizeUserText(user),
    assistant: canonicalizeAssistantText(assistant),
  };
}

export function buildCanonicalQaJson(input) {
  return JSON.stringify(buildCanonicalQa(input));
}
