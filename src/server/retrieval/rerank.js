export function clamp01(v, fb = 0) {
  const n = Number(v);
  if (Number.isNaN(n)) return fb;
  return Math.max(0, Math.min(1, n));
}

function normalizeKind(kind) {
  const k = String(kind || '').trim().toLowerCase();
  if (['stable', 'preference', 'episodic', 'ephemeral'].includes(k)) return k;
  return 'episodic';
}

function kindDecayDays(kind) {
  switch (normalizeKind(kind)) {
    case 'stable': return 180;
    case 'preference': return 21;
    case 'ephemeral': return 3;
    case 'episodic':
    default: return 14;
  }
}

function temporalScore(timestampMs, memoryKind, nowMs = Date.now()) {
  const ts = Number(timestampMs || nowMs);
  const ageMs = Math.max(0, nowMs - ts);
  const tauDays = kindDecayDays(memoryKind);
  const score = Math.exp(-ageMs / (tauDays * 24 * 60 * 60 * 1000));
  return Number(score.toFixed(6));
}

function parseEmbedding(raw) {
  if (Array.isArray(raw)) return raw.map(Number).filter((x) => Number.isFinite(x));
  const text = String(raw || '').trim();
  if (!text) return [];
  const inner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text;
  return inner.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
}

function cosineSim(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return clamp01(dot / (Math.sqrt(na) * Math.sqrt(nb)), 0);
}

function toTagSet(tags) {
  return new Set((Array.isArray(tags) ? tags : []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean));
}

function jaccard(tagsA, tagsB) {
  const a = toTagSet(tagsA);
  const b = toTagSet(tagsB);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const x of a) if (b.has(x)) overlap += 1;
  const union = new Set([...a, ...b]).size;
  return union ? overlap / union : 0;
}

function redundancySimilarity(candidate, selected) {
  const emb = cosineSim(candidate.embedding, selected.embedding);
  const tags = jaccard(candidate.tags, selected.tags);
  return Math.max(emb, 0.35 * tags);
}

export function normalizeRows(rows = [], nowMs = Date.now()) {
  return rows.map((r) => {
    const memory_kind = normalizeKind(r.memory_kind);
    return {
      ...r,
      memory_kind,
      vector_score: clamp01(r.vector_score, 0),
      lexical_score: clamp01(r.lexical_score, 0),
      score: clamp01(r.score, 0.5),
      confidence: clamp01(r.confidence, 0.7),
      temporal_score: temporalScore(r.timestamp_ms, memory_kind, nowMs),
      embedding: parseEmbedding(r.embedding),
    };
  });
}

function baseRankedRows(rows = [], weights = { vector: 0.35, lexical: 0.2, memory: 0.15, confidence: 0.1, temporal: 0.2 }) {
  return rows.map((r) => {
    const final_score = Number((
      weights.vector * r.vector_score +
      weights.lexical * r.lexical_score +
      weights.memory * r.score +
      weights.confidence * r.confidence +
      weights.temporal * r.temporal_score
    ).toFixed(6));
    return {
      ...r,
      final_score,
      explain: {
        vector_score: r.vector_score,
        lexical_score: r.lexical_score,
        memory_score: r.score,
        confidence: r.confidence,
        temporal_score: r.temporal_score,
        memory_kind: r.memory_kind,
        weights,
      },
    };
  }).sort((a, b) => b.final_score - a.final_score);
}

function diversifiedSelect(rows = [], topK = 8, lambda = 0.78, duplicateThreshold = 0.94) {
  const ranked = [...rows];
  const selected = [];
  while (ranked.length && selected.length < Number(topK)) {
    if (!selected.length) {
      selected.push(ranked.shift());
      continue;
    }
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < ranked.length; i += 1) {
      const row = ranked[i];
      const maxRedundancy = selected.reduce((m, s) => Math.max(m, redundancySimilarity(row, s)), 0);
      if (maxRedundancy >= duplicateThreshold) continue;
      const mmrScore = lambda * row.final_score - (1 - lambda) * maxRedundancy;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }
    if (bestScore === -Infinity) {
      selected.push(ranked.shift());
      continue;
    }
    const [picked] = ranked.splice(bestIdx, 1);
    selected.push({
      ...picked,
      explain: {
        ...picked.explain,
        diversity: {
          lambda,
          duplicate_threshold: duplicateThreshold,
          selected_rank: selected.length,
        },
      },
    });
  }
  return selected;
}

export function hybridRerank(rows = [], topK = 8, options = {}) {
  const nowMs = Number(options.nowMs || Date.now());
  const weights = options.weights || { vector: 0.35, lexical: 0.2, memory: 0.15, confidence: 0.1, temporal: 0.2 };
  const lambda = Number(options.lambda ?? 0.78);
  const duplicateThreshold = Number(options.duplicateThreshold ?? 0.94);
  const normalized = normalizeRows(rows, nowMs);
  const ranked = baseRankedRows(normalized, weights);
  return diversifiedSelect(ranked, Number(topK), lambda, duplicateThreshold).slice(0, Number(topK));
}
