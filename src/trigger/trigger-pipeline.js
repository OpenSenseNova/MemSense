import { RuleTrigger } from './rule-trigger.js';
import { detectExplicitSave } from './explicit-trigger.js';

export class TriggerPipeline {
  constructor({ ruleTrigger = new RuleTrigger() } = {}) {
    this.ruleTrigger = ruleTrigger;
  }

  decide(userText) {
    const explicit = detectExplicitSave(userText);
    if (explicit.matched) {
      return { shouldSave: true, source: 'explicit', tags: ['explicit_save'], ruleIds: [] };
    }

    const rule = this.ruleTrigger.match(userText);
    if (rule.matched) {
      return { shouldSave: true, source: 'rule', tags: rule.tags, ruleIds: rule.ruleIds };
    }

    return { shouldSave: false, source: 'none', tags: [], ruleIds: [] };
  }
}
