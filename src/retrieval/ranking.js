import { nowTs, normalizeText } from "../core/scoring.js";

export function rankCandidates({ query, items, topK = 8 }) {
  const q = normalizeText(query);
  const scored = items.map((m) => {
    const content = normalizeText(m.content);
    const contains = q && content.includes(q) ? 0.35 : 0;
    const recencyBase = m.timestamp ?? m.createdAt;
    const recency = Math.max(0, 1 - (nowTs() - recencyBase) / (1000 * 60 * 60 * 24 * 7));
    const baseScore = m.score ?? 0.5;
    const score = contains + 0.3 * (m.confidence ?? 0.7) + 0.2 * recency + 0.15 * (m.importance ?? 0.5) + 0.2 * baseScore;
    return { ...m, score: Number(score.toFixed(4)), reason: contains ? "lexical+recent" : "semantic_stub" };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

export function chooseConflictWinner(a, b) {
  const rank = (x) => (x.explicit ? 3 : 0) + (x.trust || 0) + (x.updatedAt || 0) / 1e13;
  return rank(a) >= rank(b) ? a : b;
}
