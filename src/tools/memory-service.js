import { LocalMemoryStore } from "../storage/local-store.js";
import { DedupGate } from "../core/dedup.js";
import { validateWriteInput } from "../core/validation.js";
import { SyncQueue } from "../storage/sync-queue.js";
import { TriggerPipeline } from "../trigger/trigger-pipeline.js";
import { buildChunk } from "../capture/chunk-builder.js";

export class MemoryService {
  constructor() {
    this.store = new LocalMemoryStore();
    this.dedup = new DedupGate();
    this.syncQueue = new SyncQueue();
    this.triggers = new TriggerPipeline();
  }

  save(raw) {
    const p = validateWriteInput(raw);
    const gate = this.dedup.accept({
      tenantId: p.tenantId,
      scope: p.scope,
      sessionId: p.sessionId,
      userId: p.userId,
      content: p.content,
    });
    if (!gate.accepted) {
      return { accepted: false, deduped: true, reason: gate.reason };
    }

    const item = this.store.write(p);
    this.syncQueue.enqueue({
      kind: "raw_chunk_sync",
      memoryId: item.memoryId,
      tenantId: item.tenantId,
      scope: item.scope,
    });

    return {
      accepted: true,
      deduped: false,
      memory_id: item.memoryId,
      timestamp: item.timestamp,
      score: item.score,
    };
  }

  search(params) {
    return this.store.retrieve(params);
  }

  fetchRecent(params) {
    return this.store.listRecent(params);
  }

  captureTurn({ tenantId, scope = "user", sessionId, userId, userText, assistantText, taskTag }) {
    const decision = this.triggers.decide(userText);
    if (!decision.shouldSave) return { accepted: false, reason: "no_trigger" };

    const chunk = buildChunk({
      tenantId,
      scope,
      sessionId,
      userId,
      userText,
      assistantText,
      tags: decision.tags,
      taskTag,
      source: decision.source,
    });
    const saved = this.save(chunk);
    return { ...saved, trigger: decision };
  }

  stats() {
    return { sync: this.syncQueue.stats() };
  }
}
