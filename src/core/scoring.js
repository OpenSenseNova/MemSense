export function nowTs() {
  return Date.now();
}

export function normalizeText(s) {
  return String(s || "").trim().toLowerCase();
}

export function retainScore({ usage = 0, freshnessMs = 0, trust = 0.6, taskGain = 0, risk = 0 }) {
  const freshness = Math.max(0, 1 - freshnessMs / (1000 * 60 * 60 * 24 * 30));
  return 0.35 * usage + 0.25 * freshness + 0.2 * taskGain + 0.2 * trust - 0.3 * risk;
}
