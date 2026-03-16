import { normalizeText, nowTs } from "./scoring.js";

const DEDUP_WINDOW_MS = 1000 * 60 * 10;

export class DedupGate {
  constructor() {
    this.seen = new Map();
  }

  keyOf({ tenantId, scope, sessionId, userId, content }) {
    return [tenantId, scope, sessionId || "-", userId || "-", normalizeText(content)].join("::");
  }

  accept(input) {
    const key = this.keyOf(input);
    const prev = this.seen.get(key);
    const now = nowTs();
    if (prev && now - prev < DEDUP_WINDOW_MS) {
      return { accepted: false, reason: "duplicate_in_window" };
    }
    this.seen.set(key, now);
    return { accepted: true };
  }
}
