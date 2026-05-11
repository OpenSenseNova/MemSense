export function clamp01(v, fb = 0) {
  const n = Number(v);
  if (Number.isNaN(n)) return fb;
  return Math.max(0, Math.min(1, n));
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

// SQL 已完成 RRF 融合，这里只做最终 final_score 计算：
//   final_score = rrf_score + α * memory_score
// memory_score (chunk.score) 是 chunk 自身质量分，作为全局先验保留；
// confidence 和 temporal_score 已从评分链路移除（前者几乎恒为常数，后者依赖主观衰减窗口）。
export function normalizeRows(rows = []) {
  return rows.map((r) => ({
    ...r,
    score: clamp01(r.score, 0.5),
    rrf_score: Number(r.rrf_score) || 0,
    embedding: parseEmbedding(r.embedding),
  }));
}

function rrfRankedRows(rows = [], alpha = 0.1) {
  return rows.map((r) => {
    const final_score = Number((r.rrf_score + alpha * r.score).toFixed(6));
    return {
      ...r,
      final_score,
      explain: {
        rrf_score: r.rrf_score,
        memory_score: r.score,
        alpha,
        routes: r.routes,
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
  const alpha = Number(options.alpha ?? 0.1);
  const lambda = Number(options.lambda ?? 0.78);
  const duplicateThreshold = Number(options.duplicateThreshold ?? 0.94);
  const normalized = normalizeRows(rows);
  const ranked = rrfRankedRows(normalized, alpha);
  return diversifiedSelect(ranked, Number(topK), lambda, duplicateThreshold).slice(0, Number(topK));
}
