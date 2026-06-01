const EXPLICIT_PATTERNS = [
  /(请记住|帮我记住|记一下|记住这个|记住[：:]|把这条存下来|以后按这个来)/i,
  /(remember this|save this|store this)/i,
];

export function detectExplicitSave(text) {
  const t = String(text || '');
  const matched = EXPLICIT_PATTERNS.some((re) => re.test(t));
  return { matched, reason: matched ? 'explicit_save' : null };
}
