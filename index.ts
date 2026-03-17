import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { TriggerPipeline } from "./src/trigger/trigger-pipeline.js";
import { normalizeNaturalText, buildQaFromHistory } from "./src/capture/message-normalize.js";
import { buildCanonicalQaJson, canonicalizeUserText, selectFinalAssistantText } from "./src/capture/canonical-qa.js";
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

const sessionQaCache = new Map<string, Array<{ user: string; assistant: string; timestamp: number }>>();
const sessionPendingAutoSave = new Map<string, { user: string; tags: string[]; taskTag?: string | null; source: string }>();
const sessionInjected = new Set<string>();
const triggerPipeline = new TriggerPipeline();

function isMeaningfulQuery(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length < 4) return false;
  if (/^(hi|hello|hey|你好|在吗|在？|在吗？|谢谢|thanks|ok|好的|嗯嗯)$/i.test(t)) return false;
  if (/^[?？!！。.，,\s]+$/.test(t)) return false;
  return true;
}

function formatMemoryInjection(chunks: any[]): string {
  if (!chunks || chunks.length === 0) return "";
  const formatted = chunks.map((c: any) => c?.text || "").filter(Boolean).join("\n\n");
  if (!formatted) return "";
  return `<relevant_context>\n${formatted}\n</relevant_context>`;
}



const WriteSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    k: { type: "integer", minimum: 1, maximum: 20 },
  },
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
    api.on("llm_input", async (event: any, ctx: any) => {
      const sid = ctx?.sessionId || event?.sessionId;
      if (!sid) return;
      const qa = buildQaFromHistory(Array.isArray(event?.historyMessages) ? event.historyMessages : []);
      sessionQaCache.set(String(sid), qa.slice(-40));

      const prompt = canonicalizeUserText(String(event?.prompt || ""));
      const decision = triggerPipeline.decide(prompt);
      if (decision.shouldSave) {
        sessionPendingAutoSave.set(String(sid), {
          user: prompt,
          tags: decision.tags || [],
          taskTag: decision.tags?.[0] || null,
          source: decision.source || 'rule',
        });
      }
    });

    api.on("llm_output", async (event: any, ctx: any) => {
      const sid = ctx?.sessionId || event?.sessionId;
      if (!sid) return;
      const pending = sessionPendingAutoSave.get(String(sid));
      if (!pending) return;
      try {
        const assistant = selectFinalAssistantText(Array.isArray(event?.assistantTexts) ? event.assistantTexts : []);
        await callApi("/v1/memory/save", {
          tenant_id: "default",
          scope: "user",
          session_id: String(sid),
          content: buildCanonicalQaJson({ user: pending.user, assistant }),
          task_tag: pending.taskTag,
          tags: pending.tags,
          type_hint: "qa_chunk",
          source: pending.source || "rule",
          timestamp: Date.now(),
          score: 0.5,
          confidence: 0.7,
        });
      } catch {}
      sessionPendingAutoSave.delete(String(sid));
    });

    api.on("before_prompt_build", async (event: any, ctx: any) => {
      const sid = ctx?.sessionId;
      if (!sid || sessionInjected.has(String(sid))) return;
      const prompt = normalizeNaturalText(String(event?.prompt || ""));
      if (!isMeaningfulQuery(prompt)) return;
      try {
        const result = await callApi("/v1/memory/search", {
          tenant_id: "default",
          scope: "user",
          query: prompt,
          top_k: 5,
        });
        const injection = formatMemoryInjection(result?.chunks || []);
        sessionInjected.add(String(sid));
        if (!injection) return;
        return { prependContext: injection };
      } catch {
        sessionInjected.add(String(sid));
        return;
      }
    });

    // v1 aliases aligned with PRD naming: save/search/fetch_recent
    api.registerTool((toolCtx) => ({
      name: "memory_save",
      label: "Memory Save",
      description: "Save last k conversation chunks from current session history (QA-only)",
      parameters: WriteSchema,
      async execute(_toolCallId, params: any) {
        const traceId = withTrace("save");
        try {
          const sid = toolCtx?.sessionId;
          if (!sid) return fail("SAVE_FAILED", "sessionId not available", traceId);
          const k = Number(params?.k ?? 5);
          const qa = sessionQaCache.get(String(sid)) || [];
          const selected = qa.slice(-k);
          if (!selected.length) {
            return ok({ accepted: false, reason: "no_session_history" }, traceId);
          }

          const chunks = [];
          for (const item of selected) {
            const content = JSON.parse(buildCanonicalQaJson({ user: item.user, assistant: item.assistant || "" }));
            if (!content.assistant) continue;
            const saved = await callApi("/v1/memory/save", {
              tenant_id: "default",
              scope: "user",
              session_id: String(sid),
              content: JSON.stringify(content),
              type_hint: "qa_chunk",
              source: "session",
              timestamp: item.timestamp || Date.now(),
              score: 0.5,
              confidence: 0.7,
            });
            chunks.push(saved);
          }
          return ok({ accepted: true, k, saved_count: chunks.length, chunks }, traceId);
        } catch (e: any) {
          return fail("SAVE_FAILED", e?.message || "save failed", traceId);
        }
      },
    }), { name: "memory_save" });

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
