export function clamp01(n, fallback = 0.5) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

export function sanitizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function validateWriteInput(params) {
  const content = String(params.content || "").trim();
  if (!content) throw new Error("content is required");
  if (content.length > 5000) throw new Error("content too long");
  return {
    ...params,
    content,
    score: clamp01(params.score, 0.5),
    confidence: clamp01(params.confidence, 0.7),
    tags: sanitizeTags(params.tags),
  };
}
