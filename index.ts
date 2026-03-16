import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
const MEMSENSE_API_URL = process.env.MEMSENSE_API_URL || "http://127.0.0.1:8787";

async function callApi(path: string, body: unknown) {
  const res = await fetch(`${MEMSENSE_API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    throw new Error(json?.error || `api failed: ${res.status}`);
  }
  return json.data;
}

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

function withEmbeddingSetupHint(message: string) {
  const m = String(message || "");
  const looksLikeEmbeddingConfigError =
    /MEMSENSE_OPENAI_API_KEY|embedding|bge_http|openai provider|required/i.test(m);
  if (!looksLikeEmbeddingConfigError) return m;

  return `${m}\n\n[MEMSENSE_SETUP_REQUIRED]\nPlease ask user to choose embedding strategy:\n1) openai-compatible (Qwen/OpenAI API)\n2) local-bge (one-click local model deployment)\n\nQuick start:\n- Interactive: bash scripts/bootstrap.sh\n- OpenAI mode: bash scripts/bootstrap.sh openai\n- Local mode:  bash scripts/bootstrap.sh local`;
}

function fail(errorCode: string, message: string, traceId: string, degraded = false) {
  const payload = { ok: false, degraded, trace_id: traceId, error_code: errorCode, message: withEmbeddingSetupHint(message) };
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
  id: "memsense",
  name: "Memsense",
  description: "Memsense memory plugin for OpenClaw",
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
          const saved = await callApi("/v1/memory/save", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            session_id: params.session_id,
            user_id: params.user_id,
            content: params.content,
            type_hint: params.type_hint,
            source: params.source,
            task_tag: params.task_tag,
            tags: params.tags,
            timestamp: params.timestamp,
            score: params.score,
            mode: params.mode,
            confidence: params.confidence,
          });
          return ok({ ...saved, version: 1 }, traceId);
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
          const candidates = await callApi("/v1/memory/search", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            session_id: params.session_id,
            user_id: params.user_id,
            query: params.query,
            top_k: params.top_k ?? 8,
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
          const saved = await callApi("/v1/memory/save", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            session_id: params.session_id,
            user_id: params.user_id,
            content: params.content,
            type_hint: params.type_hint,
            source: params.source,
            task_tag: params.task_tag,
            tags: params.tags,
            timestamp: params.timestamp,
            score: params.score,
            mode: params.mode,
            confidence: params.confidence,
          });
          return ok(saved, traceId);
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
          const chunks = await callApi("/v1/memory/search", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            session_id: params.session_id,
            user_id: params.user_id,
            query: params.query,
            top_k: params.top_k ?? 8,
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
          const chunksResp = await callApi("/v1/memory/fetch_recent", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            session_id: params.session_id,
            user_id: params.user_id,
            limit: params.limit ?? 10,
          });
          return ok(chunksResp, traceId);
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
          const itemsResp = await callApi("/v1/memory/fetch_recent", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            session_id: params.session_id,
            user_id: params.user_id,
            limit: params.limit ?? 10,
          });
          return ok({ items: itemsResp.chunks, total: itemsResp.total }, traceId);
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
          const itemsResp = await callApi("/v1/memory/search_by_time", {
            tenant_id: params.tenant_id,
            scope: params.scope,
            from_ts: params.from_ts,
            to_ts: params.to_ts,
            field: params.field ?? "updated_at",
            limit: params.limit ?? 20,
          });
          return ok(itemsResp, traceId);
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
          const result = await callApi("/v1/memory/feedback", { memory_id: params.memory_id, label: params.label });
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
          const result = await callApi("/v1/memory/promote_demote", { memory_id: params.memory_id, action: params.action });
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
          const result = await callApi("/v1/memory/forget", { memory_id: params.memory_id });
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
          const data = await callApi("/v1/memory/audit", { memory_id: params.memory_id });
          return ok(data, traceId);
        } catch (e: any) {
          return fail("AUDIT_FAILED", e?.message || "audit failed", traceId, true);
        }
      },
    });

    api.registerCli(
      ({ program }) => {
        program
          .command("memsense:ping")
          .description("Ping memsense plugin")
          .action(() => {
            console.log("memsense: ok");
          });
      },
      { commands: ["memsense:ping"] },
    );
  },
};
