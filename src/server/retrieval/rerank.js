export function clamp01(v, fb = 0) {
  const n = Number(v);
  if (Number.isNaN(n)) return fb;
  return Math.max(0, Math.min(1, n));
}

export function normalizeRows(rows = []) {
  return rows.map((r) => ({
    ...r,
    vector_score: clamp01(r.vector_score, 0),
    lexical_score: clamp01(r.lexical_score, 0),
    score: clamp01(r.score, 0.5),
    confidence: clamp01(r.confidence, 0.7),
  }));
}

export function hybridRerank(rows = [], topK = 8, weights = { vector: 0.5, lexical: 0.2, memory: 0.2, confidence: 0.1 }) {
  const out = normalizeRows(rows).map((r) => {
    const final_score = Number((
      weights.vector * r.vector_score +
      weights.lexical * r.lexical_score +
      weights.memory * r.score +
      weights.confidence * r.confidence
    ).toFixed(6));
    return {
      ...r,
      final_score,
      explain: {
        vector_score: r.vector_score,
        lexical_score: r.lexical_score,
        memory_score: r.score,
        confidence: r.confidence,
        weights,
      },
    };
  });

  return out.sort((a, b) => b.final_score - a.final_score).slice(0, Number(topK));
}
