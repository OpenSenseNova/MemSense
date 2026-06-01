const DEFAULT_RULES = [
  { id: 'pref_like', pattern: /(我喜欢|i like)/i, tag: 'preference' },
  { id: 'pref_dislike', pattern: /(我不喜欢|i dislike|don't like)/i, tag: 'preference' },
  { id: 'long_term', pattern: /(请记住|帮我记住|记一下|记住这个|记住[：:]|以后按这个|remember this|from now on)/i, tag: 'long_term' },
  { id: 'identity', pattern: /(我是|i am|my role is)/i, tag: 'profile' },
];

export class RuleTrigger {
  constructor(rules = DEFAULT_RULES) {
    this.rules = rules;
  }

  match(text) {
    const t = String(text || '');
    const hits = this.rules.filter((r) => r.pattern.test(t));
    return {
      matched: hits.length > 0,
      ruleIds: hits.map((x) => x.id),
      tags: [...new Set(hits.map((x) => x.tag))],
    };
  }
}

export { DEFAULT_RULES };
