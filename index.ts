import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { TriggerPipeline } from "./src/trigger/trigger-pipeline.js";
import { normalizeNaturalText, buildQaFromHistory } from "./src/capture/message-normalize.js";
import { buildAutoCaptureContent, hasOpenClawHeartbeatAssistant, isOpenClawHeartbeatText, prepareAutoCaptureUser, selectAutoCaptureAssistant } from "./src/capture/auto-capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// When loaded from dist/index.js, __dirname is <project>/dist — go up to project root
const rootDir = __dirname.endsWith("/dist") ? dirname(__dirname) : __dirname;

function stripEnvQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadDotEnvSync() {
  const envPath = join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] != null) continue;
    process.env[key] = stripEnvQuotes(rawValue.trim());
  }
}

loadDotEnvSync();

function normalizeBaseUrl(url: string): string {
  return String(url || "").replace(/\/+$/, "");
}

function resolveMemsenseApiUrl(): string {
  if (process.env.MEMSENSE_API_URL) return normalizeBaseUrl(process.env.MEMSENSE_API_URL);
  const hostPort = process.env.MEMSENSE_HOST_PORT || process.env.MEMSENSE_PORT || "8787";
  return `http://127.0.0.1:${hostPort}`;
}

let MEMSENSE_API_URL = resolveMemsenseApiUrl();

function directFetch(url: string, options: { method?: string; body?: string } = {}): Promise<{ ok: boolean; status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || "GET",
        headers: options.body
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(options.body) }
          : {},
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk; });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => {
              try { return Promise.resolve(JSON.parse(raw)); }
              catch (e) { return Promise.reject(e); }
            },
          });
        });
      }
    );
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function isMemsenseApiHealthy() {
  try {
    const res = await directFetch(`${MEMSENSE_API_URL}/healthz`);
    if (!res.ok) return false;
    const json = await res.json();
    return json?.ok === true;
  } catch {
    return false;
  }
}

function isDockerBootstrapEnv() {
  const bgeEndpoint = String(process.env.MEMSENSE_BGE_ENDPOINT || "");
  return Boolean(process.env.MEMSENSE_HOST_PORT) || /^https?:\/\/bge(?::|\/)/.test(bgeEndpoint);
}

async function shouldStartLocalService(ctx: any, pluginServiceMode?: string) {
  const mode = String(process.env.MEMSENSE_SERVICE_MODE || pluginServiceMode || "auto").toLowerCase();
  if (["external", "none", "off", "false", "0"].includes(mode)) {
    ctx.logger.info(`memsense service autostart disabled; using ${MEMSENSE_API_URL}`);
    return false;
  }
  if (await isMemsenseApiHealthy()) {
    ctx.logger.info(`memsense API already healthy at ${MEMSENSE_API_URL}; local service start skipped`);
    return false;
  }
  if (mode === "local" || mode === "managed") return true;
  if (isDockerBootstrapEnv()) {
    ctx.logger.warn(`memsense Docker-mode env detected but ${MEMSENSE_API_URL}/healthz is not healthy; run scripts/bootstrap.sh instead of starting local processes`);
    return false;
  }
  return true;
}

async function getSetupStatusHint() {
  try {
    const res = await directFetch(`${MEMSENSE_API_URL}/v1/system/setup-status`);
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
  const bodyStr = JSON.stringify(body || {});
  const res = await directFetch(`${MEMSENSE_API_URL}${path}`, { method: "POST", body: bodyStr });
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
  const sessionKey = String(ctx?.sessionKey || '');
  if (!sid) return true;
  if (sid === 'memsense-tagger') return true;
  if (sid.startsWith('memsense-internal:')) return true;
  if (agentId === 'memsense-tagger') return true;
  if (sessionKey.includes(':memsense_test_') ) return true;
  return false;
}

function isMeaningfulQuery(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (t.length < 4) return false;
  if (isOpenClawHeartbeatText(t)) return false;
  if (/^(hi|hello|hey|你好|在吗|在？|在吗？|谢谢|thanks|ok|好的|嗯嗯)$/i.test(t)) return false;
  if (/^[?？!！。.，,\s]+$/.test(t)) return false;
  return true;
}

function renderMemoryContent(content: unknown): string {
  const raw = String(content || "").trim();
  if (!raw) return "";

  try {
    const qa = JSON.parse(raw);
    const userText = String(qa?.user || "").trim();
    const assistantText = String(qa?.assistant || "").trim();
    if (userText && assistantText && assistantText !== userText) {
      return `User:\n${userText}\n\nAssistant:\n${assistantText}`;
    }
    return userText || assistantText || raw;
  } catch {
    return raw;
  }
}

function formatMemoryInjection(chunks: any[]): string {
  if (!chunks || chunks.length === 0) return "";
  console.log("[memsense] formatting", chunks.length, "chunks");

  const parts: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const content = c?.content || c?.text || "";
    if (!content) continue;

    const contentLen = content.length;
    const taskTagLen = (c?.task_tag || "").length;
    console.log(`[memsense] chunk[${i}]: content=${contentLen} chars, task_tag=${taskTagLen} chars`);

    const meta: string[] = [];
    if (c?.task_tag) meta.push(`Summary: ${c.task_tag}`);
    if (c?.timestamp_ms) {
      const dt = new Date(Number(c.timestamp_ms));
      if (!isNaN(dt.getTime())) meta.push(`Date: ${dt.toISOString().split("T")[0]}`);
    }
    if (c?.memory_kind) meta.push(`Kind: ${c.memory_kind}`);

    let block = "";
    if (meta.length) block += `[${meta.join(" | ")}]\n`;

    const displayContent = renderMemoryContent(content);
    if (!displayContent) continue;
    const contentKey = displayContent.replace(/\s+/g, " ").slice(0, 1000);
    seen.add(contentKey);
    block += displayContent;

    const neighbors = c?.source !== "eval_ingest_session" && Array.isArray(c?.neighbors)
      ? [...c.neighbors].sort((a, b) => Number(a?.neighbor_distance || 0) - Number(b?.neighbor_distance || 0))
      : [];
    for (const n of neighbors) {
      const neighborContent = renderMemoryContent(n?.content || "");
      if (!neighborContent) continue;
      const neighborKey = neighborContent.replace(/\s+/g, " ").slice(0, 1000);
      if (seen.has(neighborKey)) continue;
      seen.add(neighborKey);
      const distance = Number(n?.neighbor_distance || 0);
      const label = distance < 0 ? "Previous turn" : "Next turn";
      block += `\n\n[${label}]\n${neighborContent}`;
    }

    parts.push(block);
  }

  if (!parts.length) return "";
  return `<relevant_context>\n${parts.join("\n\n---\n\n")}\n</relevant_context>`;
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
    const pluginConfig = ((api as any).pluginConfig && typeof (api as any).pluginConfig === "object")
      ? (api as any).pluginConfig as Record<string, unknown>
      : {};
    const serviceUrl = typeof pluginConfig.serviceUrl === "string" ? pluginConfig.serviceUrl.trim() : "";
    if (serviceUrl) MEMSENSE_API_URL = normalizeBaseUrl(serviceUrl);
    const pluginServiceMode = typeof pluginConfig.serviceMode === "string"
      ? pluginConfig.serviceMode
      : pluginConfig.localMode === false
        ? "external"
        : undefined;
    let localServiceStarted = false;

    api.registerService({
      id: "memsense-server",
      async start(ctx) {
        if (!(await shouldStartLocalService(ctx, pluginServiceMode))) return;
        const scriptPath = join(rootDir, "scripts", "start-bash.sh");
        const child = spawn("bash", [scriptPath], { cwd: __dirname, stdio: "inherit", detached: true });
        child.unref();
        localServiceStarted = true;
        ctx.logger.info(`memsense local service start requested; API URL ${MEMSENSE_API_URL}`);
      },
      async stop(ctx) {
        if (!localServiceStarted) {
          ctx.logger.info("memsense local service stop skipped; this plugin instance did not start local services");
          return;
        }
        const scriptPath = join(rootDir, "scripts", "stop-bash.sh");
        spawn("bash", [scriptPath], { cwd: __dirname, stdio: "inherit" });
        ctx.logger.info("memsense server stopped");
      },
    });

    function resolveUserId(ctx: any, event: any): string | null {
      const direct = ctx?.userId || event?.userId || null;
      if (direct) return direct;
      const sk = String(ctx?.sessionKey || event?.sessionKey || '');
      const m = sk.match(/openresponses-user:([^:\s]+)/);
      return m ? m[1] : null;
    }

    api.on("llm_input", async (event: any, ctx: any) => {
      const sid = ctx?.sessionId || event?.sessionId;
      if (shouldSkipAutoCapture(sid, ctx, event)) return;

      const prepared = prepareAutoCaptureUser(event?.prompt || "", triggerPipeline);
      if (!prepared.shouldCapture || !prepared.decision) {
        sessionPendingAutoSave.delete(String(sid));
        return;
      }
      const resolvedUserId = resolveUserId(ctx, event);
      sessionPendingAutoSave.set(String(sid), {
        user: prepared.user,
        tags: prepared.decision.tags || [],
        taskTag: prepared.decision.tags?.[0] || null,
        source: 'session_auto',
        agentId: String(ctx?.agentId || event?.agentId || api.id || 'memsense'),
        userId: resolvedUserId,
      });
    });

    api.on("llm_output", async (event: any, ctx: any) => {
      const sid = ctx?.sessionId || event?.sessionId;
      if (shouldSkipAutoCapture(sid, ctx, event)) return;
      if (hasOpenClawHeartbeatAssistant(event)) {
        sessionPendingAutoSave.delete(String(sid));
        return;
      }
      const pending = sessionPendingAutoSave.get(String(sid));
      if (!pending) return;
      try {
        const assistant = selectAutoCaptureAssistant(event);
        if (!assistant) {
          console.warn('[memsense] auto-save skipped: empty assistant output', { sessionId: String(sid) });
          return;
        }
        const content = buildAutoCaptureContent({ user: pending.user, assistant });
        if (!content) {
          console.warn('[memsense] auto-save skipped: empty canonical QA', { sessionId: String(sid) });
          return;
        }
        await callApi("/v1/memory/save", {
          tenant_id: "default",
          scope: "user",
          session_id: String(sid),
          agent_id: pending.agentId || String(ctx?.agentId || event?.agentId || api.id || 'memsense'),
          user_id: pending.userId || resolveUserId(ctx, event),
          content,
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
      const sessionKey = String(ctx?.sessionKey || '');
      const isTestSession = sessionKey.includes(':memsense_test_');
      if (!sid || (!isTestSession && sessionInjected.has(String(sid)))) {
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
        // For eval sessions with per-question user keys (e.g. memsense_test_eval-conv-26-q5),
        // strip the -qN suffix so memory search finds chunks under the base user_id.
        let searchUserId = resolveUserId(ctx, event);
        if (searchUserId && /^memsense_test_.*-q\d+$/.test(searchUserId)) {
          searchUserId = searchUserId.replace(/-q\d+$/, '');
          console.log("[memsense] eval mode: stripped -qN suffix, searchUserId=", searchUserId);
        }
        console.log("[memsense] calling search API...", { searchUserId });
        const result = await callApi("/v1/memory/search", {
          tenant_id: "default",
          scope: "user",
          user_id: searchUserId,
          query: prompt,
          top_k: 4,
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
            top_k: params.top_k ?? 4,
          });
          const rawChunks = chunks?.chunks || chunks || [];
          const cleanChunks = rawChunks.map(({ embedding, ...rest }: any) => rest);
          return ok({ chunks: cleanChunks }, traceId);
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
          .command("memsense-ping")
          .description("Ping memsense plugin")
          .action(() => {
            console.log("memsense: ok");
          });
      },
      {
        commands: ["memsense-ping"],
        descriptors: [{ name: "memsense-ping", description: "Ping memsense plugin", hasSubcommands: false }],
      },
    );
  },
};
