import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
const MEMSENSE_API_URL = process.env.MEMSENSE_API_URL || "http://127.0.0.1:8787";

async function getSetupStatusHint() {
  try {
    const res = await fetch(`${MEMSENSE_API_URL}/v1/system/setup-status`);
    const json = await res.json();
    if (!res.ok || !json?.ok) return "";
    const d = json.data || {};
    if (d.ok) return "";
    const checks = (d.checks || []).map((c: any) => `- ${c.key}: ${c.message}`).join("\n");
    const steps = (d.next_steps || []).map((s: string) => `- ${s}`).join("\n");
    return `\n\n[MEMSENSE_SETUP_STATUS]\nprovider=${d.provider}\n${checks}\n${steps}`;
  } catch {
    return "";
  }
}

async function callApi(path: string, body: unknown) {
  const res = await fetch(`${MEMSENSE_API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!res.ok || !json?.ok) {
    const hint = await getSetupStatusHint();
    throw new Error((json?.error || `api failed: ${res.status}`) + hint);
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
