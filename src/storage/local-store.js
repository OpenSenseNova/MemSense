import { nowTs } from "../core/scoring.js";
import { rankCandidates } from "../retrieval/ranking.js";

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
