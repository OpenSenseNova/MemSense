import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { LocalMemoryStore } from "./src/local-engine.js";

const store = new LocalMemoryStore();

function withTrace(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function ok(data: unknown, traceId: string, degraded = false) {
  const payload = { ok: true, degraded, trace_id: traceId, data };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function fail(errorCode: string, message: string, traceId: string, degraded = false) {
  const payload = { ok: false, degraded, trace_id: traceId, error_code: errorCode, message };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

const WriteSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenant_id: { type: "string" },
    scope: { type: "string", enum: ["user", "team", "org", "task"] },
    session_id: { type: "string" },
    user_id: { type: "string" },
    content: { type: "string" },
    type_hint: { type: "string" },
    source: { type: "string" },
    task_tag: { type: "string" },
    tags: { type: "array", items: { type: "string" }, maxItems: 20 },
    timestamp: { type: "integer", minimum: 0 },
    score: { type: "number", minimum: 0, maximum: 1 },
    mode: { type: "string", enum: ["write_through", "write_back"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["tenant_id", "scope", "content"],
};

const RetrieveSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenant_id: { type: "string" },
    scope: { type: "string", enum: ["user", "team", "org", "task"] },
    session_id: { type: "string" },
    user_id: { type: "string" },
    query: { type: "string" },
    top_k: { type: "integer", minimum: 1, maximum: 20 },
  },
  required: ["tenant_id", "scope", "query"],
};

export default {
  id: "memory-os-fast",
  name: "Memory OS (Fast)",
  description: "Fast-lane memory tools for OpenClaw plugin mode",
  kind: "memory",
  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "memory_os_write",
      label: "Memory OS Write",
      description: "Write memory into Memory OS (local mode for now)",
      parameters: WriteSchema,
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("write");
        try {
          const item = store.write({
            tenantId: params.tenant_id,
            scope: params.scope,
            sessionId: params.session_id,
            userId: params.user_id,
            content: params.content,
            typeHint: params.type_hint,
            source: params.source,
            taskTag: params.task_tag,
            tags: params.tags,
            timestamp: params.timestamp,
            score: params.score,
            mode: params.mode,
            confidence: params.confidence,
          });
          return ok({ accepted: true, memory_id: item.memoryId, mode: item.mode, version: 1 }, traceId);
        } catch (e: any) {
          return fail("WRITE_FAILED", e?.message || "write failed", traceId);
        }
      },
    });

    api.registerTool({
      name: "memory_os_retrieve",
      label: "Memory OS Retrieve",
      description: "Retrieve memory candidates (fast lane)",
      parameters: RetrieveSchema,
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("retrieve");
        try {
          const candidates = store.retrieve({
            tenantId: params.tenant_id,
            scope: params.scope,
            sessionId: params.session_id,
            userId: params.user_id,
            query: params.query,
            topK: params.top_k ?? 8,
          });
          return ok({ candidates }, traceId, false);
        } catch (e: any) {
          return fail("RETRIEVE_FAILED", e?.message || "retrieve failed", traceId, true);
        }
      },
    });

    // v1 aliases aligned with PRD naming: save/search/fetch_recent
    api.registerTool({
      name: "memory_save",
      label: "Memory Save",
      description: "Save one memory chunk",
      parameters: WriteSchema,
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("save");
        try {
          const item = store.write({
            tenantId: params.tenant_id,
            scope: params.scope,
            sessionId: params.session_id,
            userId: params.user_id,
            content: params.content,
            typeHint: params.type_hint,
            source: params.source,
            taskTag: params.task_tag,
            tags: params.tags,
            timestamp: params.timestamp,
            score: params.score,
            mode: params.mode,
            confidence: params.confidence,
          });
          return ok({ accepted: true, memory_id: item.memoryId, timestamp: item.timestamp, score: item.score }, traceId);
        } catch (e: any) {
          return fail("SAVE_FAILED", e?.message || "save failed", traceId);
        }
      },
    });

    api.registerTool({
      name: "memory_search",
      label: "Memory Search",
      description: "Search memories and return top-k raw chunks",
      parameters: RetrieveSchema,
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("search");
        try {
          const chunks = store.retrieve({
            tenantId: params.tenant_id,
            scope: params.scope,
            sessionId: params.session_id,
            userId: params.user_id,
            query: params.query,
            topK: params.top_k ?? 8,
          });
          return ok({ chunks }, traceId);
        } catch (e: any) {
          return fail("SEARCH_FAILED", e?.message || "search failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_fetch_recent",
      label: "Memory Fetch Recent",
      description: "Fetch recent memory chunks",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          tenant_id: { type: "string" },
          scope: { type: "string", enum: ["user", "team", "org", "task"] },
          session_id: { type: "string" },
          user_id: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["tenant_id", "scope"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("fetch_recent");
        try {
          const chunks = store.listRecent({
            tenantId: params.tenant_id,
            scope: params.scope,
            sessionId: params.session_id,
            userId: params.user_id,
            limit: params.limit ?? 10,
          });
          return ok({ chunks, total: chunks.length }, traceId);
        } catch (e: any) {
          return fail("FETCH_RECENT_FAILED", e?.message || "fetch recent failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_os_list_recent",
      label: "Memory OS List Recent",
      description: "List recent memories by updated time",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          tenant_id: { type: "string" },
          scope: { type: "string", enum: ["user", "team", "org", "task"] },
          session_id: { type: "string" },
          user_id: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["tenant_id", "scope"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("list_recent");
        try {
          const items = store.listRecent({
            tenantId: params.tenant_id,
            scope: params.scope,
            sessionId: params.session_id,
            userId: params.user_id,
            limit: params.limit ?? 10,
          });
          return ok({ items, total: items.length }, traceId);
        } catch (e: any) {
          return fail("LIST_RECENT_FAILED", e?.message || "list recent failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_os_search_by_time",
      label: "Memory OS Search By Time",
      description: "Search memories by time range",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          tenant_id: { type: "string" },
          scope: { type: "string", enum: ["user", "team", "org", "task"] },
          from_ts: { type: "integer", minimum: 0 },
          to_ts: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          field: { type: "string", enum: ["updated_at", "created_at"] },
        },
        required: ["tenant_id", "scope", "from_ts", "to_ts"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("search_by_time");
        try {
          const items = store.searchByTime({
            tenantId: params.tenant_id,
            scope: params.scope,
            fromTs: params.from_ts,
            toTs: params.to_ts,
            field: params.field ?? "updated_at",
            limit: params.limit ?? 20,
          });
          return ok({ items, total: items.length }, traceId);
        } catch (e: any) {
          return fail("SEARCH_BY_TIME_FAILED", e?.message || "search by time failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_os_feedback",
      label: "Memory OS Feedback",
      description: "Feedback memory retrieval quality",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          memory_id: { type: "string" },
          label: { type: "string", enum: ["accepted", "wrong", "stale"] },
        },
        required: ["memory_id", "label"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("feedback");
        try {
          const result = store.feedback({ memoryId: params.memory_id, label: params.label });
          return ok(result, traceId);
        } catch (e: any) {
          return fail("FEEDBACK_FAILED", e?.message || "feedback failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_os_promote_demote",
      label: "Memory OS Promote/Demote",
      description: "Promote or demote memory importance/lifecycle",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          memory_id: { type: "string" },
          action: { type: "string", enum: ["promote", "demote"] },
        },
        required: ["memory_id", "action"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("promote_demote");
        try {
          const result = store.promoteDemote({ memoryId: params.memory_id, action: params.action });
          if (!result.ok) return fail("NOT_FOUND", "memory not found", traceId, false);
          return ok(result, traceId);
        } catch (e: any) {
          return fail("PROMOTE_DEMOTE_FAILED", e?.message || "promote/demote failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_os_forget",
      label: "Memory OS Forget",
      description: "Delete one memory by id",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { memory_id: { type: "string" } },
        required: ["memory_id"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("forget");
        try {
          const result = store.forget({ memoryId: params.memory_id });
          return ok(result, traceId);
        } catch (e: any) {
          return fail("FORGET_FAILED", e?.message || "forget failed", traceId, true);
        }
      },
    });

    api.registerTool({
      name: "memory_os_audit",
      label: "Memory OS Audit",
      description: "Get lifecycle events for one memory",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { memory_id: { type: "string" } },
        required: ["memory_id"],
      },
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("audit");
        try {
          return ok({ events: store.audit(params.memory_id) }, traceId);
        } catch (e: any) {
          return fail("AUDIT_FAILED", e?.message || "audit failed", traceId, true);
        }
      },
    });

    api.registerCli(
      ({ program }) => {
        program
          .command("memory-os:ping")
          .description("Ping memory-os-fast plugin")
          .action(() => {
            console.log("memory-os-fast: ok");
          });
      },
      { commands: ["memory-os:ping"] },
    );
  },
};
