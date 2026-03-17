import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

import { TriggerPipeline } from "./src/trigger/trigger-pipeline.js";
import { normalizeNaturalText, buildQaFromHistory, contentToText } from "./src/capture/message-normalize.js";
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

const sessionPendingAutoSave = new Map<string, { user: string; tags: string[]; taskTag?: string | null; source: string; agentId?: string | null; userId?: string | null }>();
const sessionInjected = new Set<string>();
const triggerPipeline = new TriggerPipeline();

function shouldSkipAutoCapture(sessionId: unknown, ctx: any, event: any) {
  const sid = String(sessionId || '');
  const agentId = String(ctx?.agentId || event?.agentId || '').trim();
  if (!sid) return true;
  if (sid === 'memsense-tagger') return true;
  if (sid.startsWith('memsense-internal:')) return true;
  if (agentId === 'memsense-tagger') return true;
  return false;
}

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
  const formatted = chunks.map((c: any) => c?.content || c?.text || "").filter(Boolean).join("\n\n");
  if (!formatted) return "";
  return `<relevant_context>\n${formatted}\n</relevant_context>`;
}



const RetrieveSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tenant_id: { type: "string" },
    scope: { type: "string", enum: ["user", "team", "org", "task"] },
    session_id: { type: "string" },
    agent_id: { type: "string" },
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
      if (shouldSkipAutoCapture(sid, ctx, event)) return;

      const prompt = canonicalizeUserText(String(event?.prompt || ""));
      if (!prompt) return;
      const decision = triggerPipeline.decide(prompt);
      sessionPendingAutoSave.set(String(sid), {
        user: prompt,
        tags: decision.tags || [],
        taskTag: decision.tags?.[0] || null,
        source: 'session_auto',
        agentId: String(ctx?.agentId || event?.agentId || api.id || 'memsense'),
        userId: ctx?.userId || event?.userId || null,
      });
    });

    api.on("llm_output", async (event: any, ctx: any) => {
      const sid = ctx?.sessionId || event?.sessionId;
      if (shouldSkipAutoCapture(sid, ctx, event)) return;
      const pending = sessionPendingAutoSave.get(String(sid));
      if (!pending) return;
      try {
        const fromAssistantTexts = selectFinalAssistantText(Array.isArray(event?.assistantTexts) ? event.assistantTexts : []);
        const fromLastAssistant = contentToText(event?.lastAssistant?.content || event?.lastAssistant?.text || '');
        const assistant = fromAssistantTexts || fromLastAssistant;
        if (!assistant) {
          console.warn('[memsense] auto-save skipped: empty assistant output', { sessionId: String(sid) });
          return;
        }
        await callApi("/v1/memory/save", {
          tenant_id: "default",
          scope: "user",
          session_id: String(sid),
          agent_id: pending.agentId || String(ctx?.agentId || event?.agentId || api.id || 'memsense'),
          user_id: pending.userId || ctx?.userId || event?.userId || null,
          content: buildCanonicalQaJson({ user: pending.user, assistant }),
          task_tag: pending.taskTag,
          tags: pending.tags,
          type_hint: "qa_chunk",
          source: pending.source || "session_auto",
          timestamp: Date.now(),
          score: 0.5,
          confidence: 0.7,
        });
      } catch (e) {
        console.error('[memsense] auto-save failed', e);
      } finally {
        sessionPendingAutoSave.delete(String(sid));
      }
    });

    api.on("before_prompt_build", async (event: any, ctx: any) => {
      console.log("[memsense] before_prompt_build triggered");
      const sid = ctx?.sessionId;
      if (!sid || sessionInjected.has(String(sid))) {
        console.log("[memsense] skipping - no sid or already injected");
        return;
      }
      const prompt = normalizeNaturalText(String(event?.prompt || ""));
      console.log("[memsense] normalized prompt:", prompt.slice(0, 100));
      if (!isMeaningfulQuery(prompt)) {
        console.log("[memsense] query not meaningful, skipping");
        return;
      }
      try {
        console.log("[memsense] calling search API...");
        const result = await callApi("/v1/memory/search", {
          tenant_id: "default",
          scope: "user",
          user_id: ctx?.userId || event?.userId || null,
          query: prompt,
          top_k: 5,
        });
        console.log("[memsense] search returned", result?.chunks?.length || 0, "chunks");
        const injection = formatMemoryInjection(result?.chunks || []);
        sessionInjected.add(String(sid));
        if (!injection) {
          console.log("[memsense] no injection content");
          return;
        }
        console.log("[memsense] injecting", injection.length, "chars");
        return { prependContext: injection };
      } catch (e) {
        console.error("[memsense] search failed:", e);
        sessionInjected.add(String(sid));
        return;
      }
    });

    // v1 aliases aligned with PRD naming: search/fetch_recent
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
            agent_id: params.agent_id,
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
          agent_id: { type: "string" },
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
            agent_id: params.agent_id,
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
