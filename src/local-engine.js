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

export class LocalMemoryStore {
  constructor() {
    this.memories = new Map();
    this.events = [];
  }

  _key(tenantId, scope) {
    return `${tenantId}::${scope}`;
  }

  write({
    tenantId,
    scope,
    content,
    typeHint,
    mode = "write_back",
    confidence = 0.7,
    sessionId,
    userId,
    tags = [],
    taskTag,
    source = "session",
    timestamp,
    score = 0.5,
  }) {
    const key = this._key(tenantId, scope);
    const arr = this.memories.get(key) || [];
    const ts = timestamp ?? nowTs();
    const item = {
      memoryId: `mem_${Math.random().toString(36).slice(2, 10)}`,
      tenantId,
      scope,
      sessionId: sessionId || null,
      userId: userId || null,
      content,
      type: typeHint || "semantic",
      tags,
      taskTag: taskTag || null,
      source,
      timestamp: ts,
      score,
      confidence,
      importance: 0.5,
      createdAt: ts,
      updatedAt: ts,
      mode,
      status: "active"
    };
    arr.push(item);
    this.memories.set(key, arr);
    this.events.push({ eventType: "capture", memoryId: item.memoryId, at: nowTs() });
    return item;
  }

  retrieve({ tenantId, scope, query, topK = 8, sessionId, userId }) {
    const arr = this.memories.get(this._key(tenantId, scope)) || [];
    const filtered = arr
      .filter((m) => (sessionId ? m.sessionId === sessionId : true))
      .filter((m) => (userId ? m.userId === userId : true));
    return rankCandidates({ query, items: filtered, topK });
  }

  feedback({ memoryId, label }) {
    this.events.push({ eventType: "feedback", memoryId, label, at: nowTs() });
    return { ok: true };
  }

  listRecent({ tenantId, scope, limit = 10, sessionId, userId }) {
    const arr = this.memories.get(this._key(tenantId, scope)) || [];
    return [...arr]
      .filter((m) => (sessionId ? m.sessionId === sessionId : true))
      .filter((m) => (userId ? m.userId === userId : true))
      .sort((a, b) => (b.timestamp || b.updatedAt || 0) - (a.timestamp || a.updatedAt || 0))
      .slice(0, limit);
  }

  searchByTime({ tenantId, scope, fromTs, toTs, field = "updated_at", limit = 20 }) {
    const arr = this.memories.get(this._key(tenantId, scope)) || [];
    const fieldKey = field === "created_at" ? "createdAt" : "updatedAt";
    return arr
      .filter((m) => {
        const t = m[fieldKey] || 0;
        return t >= fromTs && t <= toTs;
      })
      .sort((a, b) => (b[fieldKey] || 0) - (a[fieldKey] || 0))
      .slice(0, limit);
  }

  promoteDemote({ memoryId, action }) {
    for (const [k, arr] of this.memories.entries()) {
      const idx = arr.findIndex((m) => m.memoryId === memoryId);
      if (idx >= 0) {
        const item = arr[idx];
        const delta = action === "promote" ? 0.15 : -0.15;
        item.importance = Math.max(0, Math.min(1, Number(((item.importance ?? 0.5) + delta).toFixed(3))));
        item.updatedAt = nowTs();
        arr[idx] = item;
        this.memories.set(k, arr);
        this.events.push({ eventType: action, memoryId, at: nowTs() });
        return { ok: true, memory: item };
      }
    }
    return { ok: false, reason: "not_found" };
  }

  forget({ memoryId }) {
    for (const [k, arr] of this.memories.entries()) {
      const idx = arr.findIndex((m) => m.memoryId === memoryId);
      if (idx >= 0) {
        arr.splice(idx, 1);
        this.memories.set(k, arr);
        this.events.push({ eventType: "forget", memoryId, at: nowTs() });
        return { deleted: true };
      }
    }
    return { deleted: false };
  }

  audit(memoryId) {
    return this.events.filter((e) => e.memoryId === memoryId);
  }
}
