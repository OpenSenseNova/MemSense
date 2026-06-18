<div align="center">

<h1 style="font-size: 4rem;">MemSense</h1>

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md"><strong>中文</strong></a>
</p>

</div>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-22c55e" />
  <img alt="self-hosted" src="https://img.shields.io/badge/self--hosted-f59e0b" />
  <img alt="no external API" src="https://img.shields.io/badge/external%20API-not%20required-111827" />
  <a href="docs/features/main.pdf"><img alt="paper" src="https://img.shields.io/badge/paper-PDF-8b5cf6" /></a>
</p>

> 给 OpenClaw 一个真正可用的长期记忆。

MemSense 是一个为 OpenClaw 打造的开源记忆插件，让长期 memory 从不稳定、不可控，变成可靠且可管理的基础能力。
它完整保留 QA，并用清晰规则管理 memory，减少信息丢失、冲突和越用越乱的问题。
默认推荐 Docker 路径，几条命令先跑起来；无 Docker 高级路径放在文档里。[**快速开始**](#快速开始)

<p align="center">
  <img alt="MemSense demo：OpenClaw 记住用户喜欢的像素游戏" src="docs/assets/Image_zh.png" width="100%" />
</p>

---

## 概览

如果你用过 OpenClaw 的 memory，大概率遇到过这些情况：

- ❌ 记忆越用越多，但越来越混乱。
- ❌ 模型一换，memory 的表现就变得不稳定。
- ❌ 有些关键对话没有被存进去，后面也就想不起来。
- ❌ 想看 memory 为什么被用到，很难查清楚。

MemSense 的目标很简单：让 OpenClaw 的记忆真正**可靠、可控、可长期使用**。

### ✨ Why MemSense

- **即插即用，接入成本低** 无需 API Key，不依赖任何外部服务，直接接入 OpenClaw 即可运行，完全本地、免费使用，几分钟内完成部署。
- **全开源，全透明。** 所有 memory 的生成、存储与管理逻辑完全公开，没有隐藏策略，方便调试、二次开发和深度定制。
- **稳定可靠。** 每一条用户 QA 都会被记录，避免原生系统中“偶尔存不进去”的不确定性，让记忆真正可依赖。
- **Model-free。** 不依赖模型的 memory 能力或 prompt 策略，切换模型（甚至不同 tokenizer / 推理方式）也无需做任何适配。


### Core Capabilities

- **无信息损失的记忆机制** 不做语义压缩或摘要，完整保留原始 QA，上下文信息不会被削弱或丢失，保证后续检索的准确性。
- **Memory Dashboard。** 所有 memory 可查看、可管理、可调试，不再是黑盒；可以清晰知道“存了什么、为什么被召回”。
- **自动化长期记忆管理。** 基于规则对 memory 进行整理与约束，避免信息冲突、冗余堆积和时效性失效，长期运行依然保持清晰结构。
- **强一致存储保障。** memory 写入过程稳定可控，不依赖模型输出或中间状态，确保数据不会丢失或遗漏。

### MemSense 如何接入 OpenClaw

<p align="center">
  <img alt="MemSense and OpenClaw integration flow" src="docs/assets/openclaw-integration-flow.jpg" width="100%" />
</p>

---

## 快速开始

MemSense 安装分三步：启动本地服务，接入 OpenClaw，最后打开 dashboard 验证。

安装概览：

- Docker / Docker Desktop：[Docker 路径（推荐）](#docker-路径)
- macOS / Linux 无 Docker：[无 Docker 安装文档](docs/features/no-docker-quickstart.zh-CN.md)，Windows 无 Docker 安装还在测试中
- MemSense 服务已经启动：[接入 OpenClaw](#2-接入-openclaw)
- 已经完成安装：[验证](#3-验证)

### 1. 启动 MemSense 服务

选择 embedding 模式：

| 模式 | 适合场景 | 需要 | 路径 |
|---|---|---|---|
| `local` | 自托管，不希望走外部 embedding API | 第一次会下载 BGE 模型，约 1 GB | [Docker 路径](#docker-路径) / [无 Docker 安装文档](docs/features/no-docker-quickstart.zh-CN.md) |
| `openai` | 想最快启动 | 在 `.env` 里配置 `MEMSENSE_OPENAI_API_KEY` | [Docker 路径](#docker-路径) / [无 Docker 安装文档](docs/features/no-docker-quickstart.zh-CN.md) |

启动脚本会在需要时从 `.env.example` 创建 `.env`。如果选择 `openai`，请先在 `.env` 里设置 `MEMSENSE_OPENAI_API_KEY`，再使用记忆捕获或检索。

### Docker 路径

根据你选择的 embedding 模式，**只运行其中一个**启动命令。

<table width="100%">
<tr>
<td width="50%" valign="top">

**本地 embedding**

```bash
# macOS / Linux / WSL2
bash scripts/bootstrap.sh local

# Windows PowerShell
.\scripts\bootstrap.ps1 local
```

</td>
<td width="50%" valign="top">

**OpenAI-compatible embedding**

```bash
# macOS / Linux / WSL2
bash scripts/bootstrap.sh openai

# Windows PowerShell
.\scripts\bootstrap.ps1 openai
```

</td>
</tr>
</table>

本地 embedding 第一次会下载 BGE 模型，已有缓存则跳过。OpenAI-compatible embedding 需要先在 `.env` 设置 `MEMSENSE_OPENAI_API_KEY`。

tagger 不需要单独配置模型。脚本默认使用 `MEMSENSE_TAGGER_PROVIDER=auto`：如果宿主机能访问 OpenClaw，就复用 OpenClaw 当前模型打 tag，并默认启动 3 个宿主机 tag worker；如果访问不到，就跳过 tag 增强，但 capture / embedding / retrieval 仍然正常工作。

查看服务状态：

```bash
docker compose ps
```

> `local` 模式第一次运行会下载 BGE 模型并构建服务镜像，通常需要几分钟。之后启动会快很多。

然后继续执行第 2 步。

<details>
<summary>端口冲突？自定义 host port</summary>

```bash
MEMSENSE_HOST_PORT=18787 bash scripts/bootstrap.sh local
```

`bootstrap.sh` 会同时把 `MEMSENSE_API_URL=http://127.0.0.1:<host-port>` 写入 `.env`，所以 OpenClaw 插件也会访问同一个端口。后续 URL 也要跟着改，例如 `http://127.0.0.1:18787/dashboard`。

</details>

### 无 Docker 运行方式（macOS / Linux）

只有在你走 [无 Docker 安装文档](docs/features/no-docker-quickstart.zh-CN.md) 这条路径时才需要执行这些命令。它们管理的是本地 bash 启动的后台进程，不是 Docker Compose 容器。

```bash
# 第一次无 Docker 安装，或者重置依赖 / 数据库配置后执行
bash scripts/bootstrap-nodocker.sh local
# 或
bash scripts/bootstrap-nodocker.sh openai

# 启动本地 API server、embedding worker、tag worker；
# local embedding 模式下也会启动 BGE 服务
bash scripts/start-bash.sh

# 不再使用本地服务、修改 .env 里的端口 / provider、
# 或切回 Docker 路径前，停止这些本地后台进程
bash scripts/stop-bash.sh
```

首次无 Docker 初始化完成后，日常启动只需要执行 `bash scripts/start-bash.sh`。如果要替换已经在运行的 bash 后台进程，执行 `bash scripts/start-bash.sh --restart`。

### 2. 接入 OpenClaw

> [!TIP]
> **一键完成**：按你的 shell 运行对应脚本，安装并配置 OpenClaw 插件。
>
> macOS / Linux / WSL2 / Windows Git Bash：
> ```bash
> bash scripts/install-openclaw-plugin.sh --force
> ```
> WSL2 需要在 WSL2 内安装 Node.js 和 OpenClaw；Git Bash 需要能在 Git Bash 的 `PATH` 中找到 Windows 侧的 `npm` 和 `openclaw` 命令。
>
> Windows PowerShell：
> ```powershell
> .\scripts\install-openclaw-plugin.ps1 -Force
> ```

如果已经运行上面的一键脚本，可以直接跳到第 3 步验证。下面内容仅用于手动安装或排查问题。

<details>
<summary>手动安装 / 排查问题</summary>

#### 安装到 OpenClaw

**为什么需要 `--dangerously-force-unsafe-install`？** OpenClaw 2026.4+ 会将使用 `child_process` 或读取环境变量的插件标记为"不安全"。MemSense 两者都用到，用于管理后台服务进程——安装前建议先阅读 [`index.ts`](index.ts) 和 [`scripts/`](scripts/) 目录的内容。该参数是必须的，缺少它安装会被拒绝。

```bash
# 先构建插件（OpenClaw >= 2026.4 需要）
npm ci
npm run build

openclaw plugins install -l --dangerously-force-unsafe-install <path-to-MemSense>
openclaw plugins enable memsense
openclaw gateway restart
```

> `-l` 表示从本地路径做 linked install，适合开发和调试插件时使用。
> 如果 gateway service 还没有安装，请先启动或配置 gateway（例如 `openclaw gateway install`；本地 smoke 可用 `openclaw gateway --allow-unconfigured`）。如果之前安装过旧版 `MemSense`，请先卸载旧安装，或者使用干净 profile 安装当前分支。

#### 允许对话访问

OpenClaw 2026.4+ 要求非内置插件必须显式声明才能接收对话内容（`llm_input` / `llm_output` 事件）：

```bash
openclaw config set plugins.entries.memsense.hooks.allowConversationAccess true
openclaw gateway restart
```

> **这一步的作用是什么？** 如果跳过，插件虽然会加载成功，但 OpenClaw 会静默跳过所有对话事件的分发——即使插件显示为已启用，也不会捕获任何记忆。

#### 绑定 memory slot

OpenClaw 使用 *slot* 机制将能力路由到对应插件。设置 `plugins.slots.memory = "memsense"` 告诉 OpenClaw 使用 MemSense 作为 memory 提供者。**仅安装或启用插件是不够的**——没有这个绑定，`memory_search` 和 `memory_fetch_recent` 工具不会被路由到 MemSense，记忆也不会注入到 prompt。

**方式一 — CLI（推荐）：**

```bash
openclaw config set plugins.entries.memsense.enabled true
openclaw config set plugins.slots.memory memsense
openclaw gateway restart
```

**方式二 — JSON：** 将以下内容合并到 OpenClaw 配置文件中（用 `openclaw config path` 查看路径，通常是 `~/.openclaw/config.json`）：

```json
{
  "plugins": {
    "entries": { "memsense": { "enabled": true } },
    "slots":   { "memory": "memsense" }
  }
}
```

然后重启 gateway，让 slot binding 生效：

```bash
openclaw gateway restart
```

> **注意：** 如果跳过这一步，`memory_search` / `memory_fetch_recent` 工具不会被路由到 MemSense，记忆检索将无法正常工作。

</details>

### 3. 验证

```text
http://127.0.0.1:8787/dashboard?token=demo
```

> `demo` 是默认开发 token。如果要把服务暴露到 localhost 之外，请先修改 `MEMSENSE_DASHBOARD_TOKENS_JSON`。

跑一次 smoke test：

```bash
MEMSENSE_SMOKE_BASE_URL=http://127.0.0.1:8787 \
MEMSENSE_SMOKE_TOKEN=demo \
npm run smoke:api
```

> 成功时会打印 health / setup / pipeline / memory 检查，最后以 `[smoke] all api smoke checks passed` 结束。

### 更新 MemSense

先自行拉取最新代码，然后按你的 shell 运行更新脚本：

<table width="100%">
<tr>
<td width="60%" valign="top"><strong>macOS/Linux/WSL2/Windows Git Bash</strong></td>
<td width="40%" valign="top"><strong>Windows PowerShell</strong></td>
</tr>
<tr>
<td width="60%" valign="top">

```bash
bash scripts/update.sh
```

</td>
<td width="40%" valign="top">

```powershell
.\scripts\update.ps1
```

</td>
</tr>
</table>

更新脚本会重建本地服务、应用数据库迁移，并在检测到 OpenClaw CLI 时刷新 OpenClaw 插件。它不会拉取代码、不会重写 `.env`、不会删除 Docker volumes，也不会执行 `docker compose down -v`。完整说明见 [更新指南](docs/features/update-guide.zh-CN.md)。

默认情况下，`scripts/update.sh` 会更新 Docker 路径。已有 macOS / Linux 无 Docker 安装时，请运行 `bash scripts/update.sh --runtime nodocker`。`scripts/update.ps1` 用于 Windows Docker 路径；Windows 无 Docker 更新还在测试中。

---

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| **Node.js** | >= 20 | 安装 OpenClaw 插件、无 Docker 模式和本地开发需要 |
| **PostgreSQL** | >= 16，带 `pgvector` | 无 Docker 模式需要 |
| **Python** | >= 3.11 | 仅本地 BGE 无 Docker 模式和 `evaluation/` 需要 |
| **OS** | macOS / Linux | Windows 可通过 Docker Desktop / WSL2 使用 |
| **磁盘** | 约 1 GB 可用空间 | local 模式第一次会下载 `BAAI/bge-large-zh-v1.5` |
| **OpenClaw** | >= 2026.4 | 已在 [`package.json`](package.json) 的 `peerDependencies` 中声明 |

Docker 不是必须的，但它是推荐的快速开始路径，因为它会一起启动 Postgres、API server、embedding worker 和 BGE。tag worker 会由 bootstrap/update 脚本自动放到合适位置：宿主机能访问 OpenClaw 时跑在宿主机，否则跑在 Docker 内，`auto` 模式下只跳过 tag 增强。macOS / Linux 如果不能使用 Docker，请看 [无 Docker 安装文档](docs/features/no-docker-quickstart.zh-CN.md)。

> 选择 embedding 模式：如果你手边有 Qwen / OpenAI-compatible API key，`openai` 模式可以跳过 BGE 下载，几秒内启动。如果你在离线环境或对数据外发很敏感，选 `local`；提前缓存 Docker 镜像和 `BAAI/bge-large-zh-v1.5` 模型后，MemSense 可以不走外部 embedding API。

> 切换 embedding 模型后：同一个数据库尽量只使用一套 embedding provider / model。如果你在已有数据库上切换 `MEMSENSE_EMBEDDING_PROVIDER`、`MEMSENSE_EMBEDDING_MODEL` 或 `MEMSENSE_BGE_MODEL`，维度不兼容的旧 embedding 会被向量搜索跳过。旧记忆仍然保留，但向量召回可能搜不到，直到使用干净数据库或重新生成 embedding。

---

## 核心概念

下面这些是 MemSense 和普通“向量库 + RAG 记忆插件”的主要区别。这里会进入技术细节；前面的概览只讲它解决什么问题。

### 1. 通过 OpenClaw hook 自动捕获，而不是让 agent 主动保存

很多记忆插件要求 agent 在合适的时候调用 `memory.save(...)`。这很脆弱：agent 可能忘记调用，也可能保存错内容，或者把噪声写进记忆。

MemSense 监听 OpenClaw 的生命周期事件：

- `llm_input`：标准化用户输入，运行触发规则，暂存这次用户请求。
- `llm_output`：拿到对应的 assistant 输出，构造成 canonical QA JSON，POST 到 `/v1/memory/save`。

10 分钟窗口内，相同用户请求会在 chunk 层去重，所以重试不会污染记忆。**你不需要写捕获代码。**

代码位置：[`index.ts`](index.ts) 的事件处理，和 [`src/capture/`](src/capture) 下的 `message-normalize.js`、`canonical-qa.js`、`chunk-builder.js`。

### 2. 八路召回，不让 LLM 在背后决定记忆

只对“整段对话”做一次向量检索太粗了。它容易把用户问题和 assistant 答案混在一起，也容易错过 ticket ID 这类词面命中。

MemSense 会并行跑 **8 条召回路线**，再用确定性的方式融合结果：

| # | 路线 | 匹配对象 |
|---|---|---|
| 1 | `vec_full` | 完整 QA embedding，也作为 MMR 去重基线 |
| 2 | `vec_user` | 用户视角 embedding |
| 3 | `vec_asst` | assistant 视角 embedding |
| 4 | `vec_next_user` | 后续问题，在 chunk N+1 到来时回填 |
| 5 | `lexical` | Postgres full-text search，覆盖 `task_tag` 和 `content` |
| 6 | `facet_personal_info` | 提取出的 personal-info facet |
| 7 | `facet_preferences` | 提取出的 preferences facet |
| 8 | `facet_events` | 提取出的 events facet |

融合使用 Reciprocal Rank Fusion，`k = 15`，然后计算 `final_score = rrf_score + 0.1 · memory_score`。第二轮会用 MMR 做多样性选择，当前参数是 `λ = 0.78`，重复阈值为 `0.94`。召回结果不是由 LLM 临时决定的，所以换模型后行为也更稳定。

代码位置：[`src/server/service.js`](src/server/service.js) 里的 SQL RRF，和 [`src/server/retrieval/rerank.js`](src/server/retrieval/rerank.js) 里的 MMR。

深入说明：[`docs/features/retrieval-algorithm.md`](docs/features/retrieval-algorithm.md)

### 3. 记忆有类型，也有分数

每个 chunk 都带 `memory_kind` 和 `[0, 1]` 范围内的 `memory_score`：

| `memory_kind` | 适合存什么 |
|---|---|
| `stable` | 长期事实和身份信息，例如“prod DB 在 `db-prod-2`” |
| `preference` | 用户偏好，例如“总结用 bullet points，不要长段落” |
| `episodic` | 重要经历和决策，例如“第 1 天 CSV 解析因为 quoted comma 出错，后来改用 csv-parse” |
| `ephemeral` | 短期状态，衰减最快 |

`memory_score` 存在 `memory_chunks.score`。当前 runtime 会把新 chunk 初始设为 `0.5`；`promote_demote` 会按 `±0.15` 调整分数，`feedback` 会把结果标签记录到 `memory_events`，方便审计和后续评分工作。`forget` 会把 chunk 状态设为 `deleted`，让它不再参与 active retrieval。

代码位置：[`src/worker/tag-worker.js`](src/worker/tag-worker.js) 负责 kind assignment；[`src/server/db/schema.sql`](src/server/db/schema.sql) 里定义了 `memory_events` 表。

### 4. 异步增强，带重试和 DLQ

捕获发生在热路径上，增强不应该阻塞 agent。MemSense 用两张 queue 表把它们拆开：

- `embedding_jobs`：计算 full / user / assistant / next-user / facet payloads 的 embeddings。
- `tag_jobs`：可选调用 tagger LLM，生成 tags、`memory_kind`、summary、facets。

两类 worker 都使用 `FOR UPDATE SKIP LOCKED` 抢占任务，失败后指数退避重试，重试耗尽后进入 dead-letter queue，也就是 `embedding_dlq` / `tag_dlq`。`/v1/dashboard/pipeline_status` 会暴露 pending / running / failed 计数；如果需要看失败 payload 和错误详情，可以直接查 DLQ 表。

代码位置：[`src/worker/index.js`](src/worker/index.js) 和 [`src/worker/tag-worker.js`](src/worker/tag-worker.js)。

深入说明：[`docs/features/worker-retry-dlq.md`](docs/features/worker-retry-dlq.md)

### 5. 可验证的自托管

`bash scripts/bootstrap.sh local` 会一次性启动 Postgres、API server、embedding worker、tag worker 和 BGE embedding 服务。脚本会自动选择 tag worker 的运行位置，以便在可用时复用 OpenClaw。local 模式没有托管控制面，也不需要外部 embedding API。第一次启动会从 Hugging Face 拉取 BGE 模型，并缓存到 Docker volume `MemSense-hf`；之后可以直接从缓存运行，也可以用 `tcpdump` 检查运行期流量。

如果你希望把 embedding 交给外部服务，可以设置 `MEMSENSE_EMBEDDING_PROVIDER=openai`，并指向任何 OpenAI-compatible endpoint，例如 Qwen / DashScope / OpenAI 等。local 和 cloud 模式可以原地切换，系统其他部分不需要变化。

代码位置：[`Dockerfile.bge`](Dockerfile.bge) 和 [`docker-compose.yml`](docker-compose.yml)。

深入说明：[`docs/features/local-bge-oneclick.md`](docs/features/local-bge-oneclick.md)

---

## 架构

### 分层

| 层 | 作用 |
|---|---|
| **Capture** | 把 agent history 标准化成 QA chunks，并在 10 分钟窗口内去重。 |
| **Enrichment** | 异步 worker 计算 full/user/assistant/next-user/facet embeddings，并补充 tags、memory kind、facets。 |
| **Retrieval** | 8-route search，包含 4 条 vector、1 条 lexical、3 条 facet，再做 RRF rank fusion。 |
| **Selection** | 默认使用 chunk-level RRF + MMR diversity，`λ=0.78`；session-first hybrid scoring 只在用 `--mode hybrid` 导入的 evaluation 数据上启用。 |

### 关键数据表

表结构定义在 [`src/server/db/schema.sql`](src/server/db/schema.sql)，通过 `npm run db:migrate` 自动应用。

| 表 | 用途 |
|---|---|
| `memory_chunks` | canonical chunks：content、kind、tags、facets、score、status |
| `memory_chunk_embeddings` | 每个 chunk 的向量：full、user、assistant、next-user 和 3 个 facet columns |
| `memory_events` | capture 和 feedback 的 append-only audit log |
| `embedding_jobs` / `embedding_dlq` | 异步 embedding queue 和 dead-letter |
| `tag_jobs` / `tag_dlq` | 异步 tagging queue 和 dead-letter |

完整系统图：[`docs/assets/system-flowchart.png`](docs/assets/system-flowchart.png)

架构说明：[`docs/features/architecture-overview.md`](docs/features/architecture-overview.md)

<details>
<summary><b>示例：从一次 agent 出错，到变成下一次可用的经验</b></summary>

第 1 天，data-ops agent 收到任务：`parse report_q1.csv`。

```diff
  USER    parse report_q1.csv and summarise revenue by client.
  AGENT   reads file → naive split(",") → breaks on quoted commas.
- USER    ✗ numbers are off — "Client, Inc" got split into two columns.
+ AGENT   switches to csv-parse library → re-runs → correct result.
```

MemSense 会把这段过程整理成一条记忆。第 12 天，另一个任务来了：`clean up customers_export.csv`。在 prompt 构建前，hook 会注入类似这样的上下文：

```xml
<relevant_context source="MemSense" matched_routes="vec_user,lex,facet_ev">
  <memory kind="episodic" score="0.70" rrf="0.31">
    <task_tag>CSV with quoted commas — don't use naive split; use csv-parse</task_tag>
  </memory>
</relevant_context>
```

agent 会直接使用上次验证过的 `csv-parse`，不用再踩同一个坑。当前 runtime 里，复用结果可以通过 `feedback` 记录；`promote_demote` API 可以把这条记忆的分数提高或降低 `0.15`。

```text
day 1   USER corrects agent          → memory captured     memory_score 0.50
day 12  recalled → reused → success  → feedback recorded  memory_score 0.50
day 18  recalled again → success     → feedback recorded  memory_score 0.50
day 23  human clicks promote         → score adjusted     memory_score 0.65
```

</details>

### 可视化 Dashboard

<p align="center">
  <img alt="MemSense Dashboard" src="docs/assets/dashboard-screenshot.png" width="100%" />
</p>

- **Prompt Injection Preview**：输入 query，查看实时 search response，以及 dashboard 预览出的 prompt fragment。OpenClaw 插件最终会在 [`index.ts`](index.ts) 里完成生产格式化。
- **memory_search**：发起语义搜索，检查每条结果的 `rrf_score`、matched routes 和 `final_score`。
- **memory_fetch_recent**：拉取最近捕获的 chunks，确认刚刚发生的内容是否被记住。

---

## 评测

我们在 [LoCoMo](https://github.com/snap-stanford/locomo) long-range dialogue benchmark 上测试了 MemSense，共 1,540 个 case，模型为 `doubao-seed-2.0-pro-260215`。评测脚本在 [`evaluation/`](evaluation/)。

> [!IMPORTANT]
> **LoCoMo task completion 73.77%**，比 OpenViking 高 21.7pp，比 OpenClaw memory-core 高 38.1pp。

| 配置 | Task Completion | Input Tokens | Completion / 1M tokens |
|---|:---:|---:|:---:|
| OpenClaw (memory-core) | 35.65% | 24,611,530 | 1.45 |
| OpenClaw + LanceDB (-memory-core) | 44.55% | 51,574,530 | 0.86 |
| OpenClaw + OpenViking Plugin (-memory-core) | 52.08% |  4,264,396 | 12.21 |
| OpenClaw + OpenViking Plugin (+memory-core) | 51.23% |  2,099,622 | 24.40 |
| **OpenClaw + MemSense** | **73.77%** | **3,506,310** | **21.04** |

结论：

- 相比 OpenClaw memory-core：**task completion +38.1pp**，input-token 成本约为 **1/7**。
- 相比 OpenViking (-memory-core)：**task completion +21.7pp**，同时使用更少 tokens。

### 复现评测结果

```bash
# 1. 把 LoCoMo conversations 导入 MemSense，写入 session + turn chunks
uv run python evaluation/ingest.py ./evaluation/locomo10.json \
    --task MemSense_eval \
    --user MemSense_eval \
    --dashboard-token demo \
    --mode hybrid \
    --generate-tags

# 2. 通过 OpenClaw gateway 在导入的 sessions 上跑 QA
uv run python evaluation/qa.py ./evaluation/locomo10.json \
    --base-url http://127.0.0.1:8899 \
    --task MemSense_eval \
    --user MemSense_eval \
    --token YOUR_OPENCLAW_GATEWAY_TOKEN \
    --overwrite \
    --parallel 4

# 3. 用 LLM judge 评估回答
uv run python evaluation/judge.py output/qa.MemSense_eval.jsonl \
    --base-url https://ark.cn-beijing.volces.com/api/v3 \
    --token YOUR_LLM_TOKEN \
    --model doubao-seed-2-0-mini-260215 \
    --concurrency 5 \
    --output output/grades.json
```

推荐使用 `--mode hybrid`，它会启用 session-first scoring。`--mode session` 是 full-session baseline；`--mode turn` 只用于 ablation。`ingest.py` 默认访问 MemSense API：`http://127.0.0.1:8787`；`qa.py` 默认访问 OpenClaw Responses-compatible gateway：`http://127.0.0.1:8899`。完整说明见 [`evaluation/README.md`](evaluation/README.md)。

---

## 配置参考

所有设置都放在 `.env`。Docker 会通过 `docker-compose.yml` 读取它；无 Docker 脚本会直接 source 它。仓库里的 [`.env.example`](.env.example) 已经可以直接用于 local 模式。

**local 模式最小配置：** `MEMSENSE_DATABASE_URL`、`MEMSENSE_EMBEDDING_PROVIDER=bge_http`、`MEMSENSE_BGE_ENDPOINT`、`MEMSENSE_DASHBOARD_TOKENS_JSON`

**cloud 模式最小配置：** `MEMSENSE_DATABASE_URL`、`MEMSENSE_EMBEDDING_PROVIDER=openai`、`MEMSENSE_OPENAI_BASE_URL`、`MEMSENSE_OPENAI_API_KEY`、`MEMSENSE_EMBEDDING_MODEL`、`MEMSENSE_DASHBOARD_TOKENS_JSON`

### 核心配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MEMSENSE_DATABASE_URL` | `postgresql://127.0.0.1:5432/MemSense` | Postgres + pgvector 连接串 |
| `MEMSENSE_PORT` | `8787` | HTTP server 端口，container 内 |
| `MEMSENSE_HOST_PORT` | `8787` | Docker host-port mapping，server 用 |
| `MEMSENSE_POSTGRES_PORT` | `54329` | Docker host-port mapping，Postgres 用 |
| `MEMSENSE_TENANT_ID` | `default` | OpenClaw 插件自动保存和 memory tools 使用的 tenant |
| `MEMSENSE_SCOPE` | `user` | OpenClaw 插件自动保存和 memory tools 使用的 scope |
| `MEMSENSE_DASHBOARD_TOKENS_JSON` | `{"demo":"admin"}` | RBAC token map：`token → role`，支持 viewer / operator / admin |
| `MEMSENSE_DB_POOL_MAX` | `20` | 每个进程的 Postgres 最大连接数 |

### Embedding 选择

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MEMSENSE_EMBEDDING_PROVIDER` | `.env.example` 中为 `bge_http` | `bge_http` 表示本地 BGE，`openai` 表示云端 |
| `MEMSENSE_EMBEDDING_MAX_CHARS` | `6000` | embedding 前的文本截断长度 |

### 本地 BGE embedding，`provider=bge_http`

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MEMSENSE_BGE_ENDPOINT` | `http://127.0.0.1:8080/embed` | embedding worker POST payload 的地址 |
| `MEMSENSE_BGE_MODEL` | `BAAI/bge-large-zh-v1.5` | Hugging Face model id，第一次运行会自动下载 |
| `MEMSENSE_BGE_PORT` | `8080` | BGE container 内端口 |
| `MEMSENSE_BGE_HOST_PORT` | `8088` | BGE container 的 Docker host-port mapping |
| `MEMSENSE_BGE_HOST` | `0.0.0.0` | BGE bind address |
| `MEMSENSE_BGE_SAVE_DIR` | `/data` | container 内模型缓存目录 |

### OpenAI-compatible embedding，`provider=openai`

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MEMSENSE_OPENAI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 任意 OpenAI-compatible endpoint |
| `MEMSENSE_OPENAI_API_KEY` | 空 | Bearer token；`provider=openai` 时必填 |
| `MEMSENSE_EMBEDDING_MODEL` | `text-embedding-v4` | embedding model id |

### Worker 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MEMSENSE_WORKER_MAX_ATTEMPTS` | `5` | embedding job 进入 DLQ 前的最大重试次数 |
| `MEMSENSE_WORKER_IDLE_MS` | `800` | embedding queue 轮询间隔，毫秒 |
| `MEMSENSE_TAG_WORKER_CONCURRENCY` | `3` | 宿主机 tag worker 进程数；`start-bash.sh`、Docker bootstrap、Docker update 在宿主机有 OpenClaw 时会按这个数量启动 |
| `MEMSENSE_TAG_WORKER_MAX_ATTEMPTS` | `4` | tag job 进入 DLQ 前的最大重试次数 |
| `MEMSENSE_TAG_WORKER_IDLE_MS` | `1200` | tag queue 轮询间隔，毫秒 |
| `MEMSENSE_TAG_RETRY` | `3` | tagger client 内部单次调用重试预算 |

### Tagger 模型（高级）

大多数安装不需要改这里。默认 `auto` 会保持一键安装体验：无 Docker 时直接使用宿主机 OpenClaw 模型；Docker bootstrap/update 会在宿主机有 OpenClaw 时自动使用宿主机 tag worker。若访问不到 OpenClaw，则跳过 tag 增强，但 capture、embedding、retrieval 仍然正常工作。

只有在需要强制 provider、关闭打 tag，或希望完全在 Docker 内使用 OpenAI-compatible tagger 时，才需要修改下面这些变量。

| 变量 | 默认值 | 作用 |
|---|---|---|
| `MEMSENSE_TAGGER_PROVIDER` | `auto` | `auto`、`openclaw_cli`、`openai`，或 `off` 跳过打 tag |
| `MEMSENSE_TAGGER_MODEL` | `auto` | 使用 OpenClaw 默认模型，或填显式 tagger model id |
| `MEMSENSE_OPENCLAW_CLI` | `openclaw` | `auto` / `openclaw_cli` 模式下使用的 OpenClaw CLI 命令 |
| `MEMSENSE_OPENCLAW_TAGGER_TIMEOUT_MS` | `90000` | 每次 OpenClaw CLI tagger 调用的超时时间 |
| `MEMSENSE_TAGGER_BASE_URL` | 空 | tagger model 的 OpenAI-compatible endpoint |
| `MEMSENSE_TAGGER_API_KEY` | 空 | tagger 的 Bearer token |

---

## API 参考

成功时，所有接口返回 `{ "ok": true, "data": ... }`。失败时返回 `{ "ok": false, "error": "..." }`，HTTP 状态码为 500。

**鉴权。** Dashboard endpoints 需要 `x-memsense-token: <token>` header，或者 `?token=<token>` query string。token 到 role 的映射来自 `MEMSENSE_DASHBOARD_TOKENS_JSON`。当前版本里，Memory endpoints `/v1/memory/*` 没有 token gate；如果要暴露到 localhost 之外，请在 gateway 层加保护。

路由定义在 [`src/server/app.js`](src/server/app.js)。

### Memory operations

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/v1/memory/save` | 捕获 canonical QA chunk，10 分钟内自动去重 |
| `POST` | `/v1/memory/search` | 8-route RRF + MMR retrieval，返回 top-k chunks，以及 `rrf_score`、`final_score`、matched routes |
| `POST` | `/v1/memory/fetch_recent` | 按 `(tenant, scope, user/agent/session)` 拉取最近 chunks |
| `POST` | `/v1/memory/search_by_time` | 按时间范围过滤列表 |
| `POST` | `/v1/memory/feedback` | 在 audit log 中记录 outcome label |
| `POST` | `/v1/memory/promote_demote` | 按 delta 调整 `memory_score` |
| `POST` | `/v1/memory/forget` | soft-delete 一个 chunk，状态变为 `deleted` |
| `POST` | `/v1/memory/audit` | 读取 `memory_events` audit log |

### Dashboard operations

| Method | Path | Role | 作用 |
|---|---|---|---|
| `GET`  | `/v1/dashboard/contract` | viewer | UI schema，包含 filters、columns、actions |
| `POST` | `/v1/dashboard/overview` | viewer | dashboard list view 的 stats 和 recent chunks |
| `POST` | `/v1/dashboard/set_status` | operator | archive / restore 一个 chunk |
| `GET`  | `/v1/dashboard/pipeline_status` | viewer | job queue 健康状态：pending / running / failed counts |
| `GET`  | `/dashboard` | - | 静态 HTML test console |

### System

| Method | Path | 作用 |
|---|---|---|
| `GET`  | `/healthz` | Liveness probe，也接入了 Docker healthcheck |
| `GET`  | `/v1/system/setup-status` | embedding-provider 配置检查，并给出可执行的下一步 |

---

## OpenClaw 插件集成

### Plugin manifest

[`openclaw.plugin.json`](openclaw.plugin.json) 把 MemSense 声明为 `memory` 类型插件：

```json
{
  "id": "memsense",
  "kind": "memory",
  "contracts": {
    "tools": ["memory_search", "memory_fetch_recent"]
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "enabled":     { "type": "boolean", "default": true },
      "serviceMode": { "type": "string", "enum": ["auto", "external", "local"], "default": "auto" },
      "localMode":   { "type": "boolean" },
      "serviceUrl":  { "type": "string" },
      "tenantId":    { "type": "string", "default": "default" },
      "scope":       { "type": "string", "enum": ["user", "team", "org", "task"], "default": "user" },
      "timeoutMs":   { "type": "integer", "minimum": 50, "default": 180 },
      "maxTopK":     { "type": "integer", "minimum": 1, "maximum": 20, "default": 8 }
    }
  }
}
```

- `serviceMode`：`auto` 会优先连接已经运行的 API；`external` 从不启动本地进程；`local` 会通过 `scripts/start-bash.sh` 启动 no-Docker 本地服务。
- `localMode`：兼容旧配置，已不推荐；新配置请使用 `serviceMode`。
- `serviceUrl`：覆盖 API URL；不设置时读取 `MEMSENSE_API_URL`，再回退到 `MEMSENSE_HOST_PORT` / `MEMSENSE_PORT`。
- `tenantId` / `scope`：auto-capture 和 memory tools 内部使用的 tenant/scope；agent 不需要传这些字段。
- `timeoutMs`：`before_prompt_build` search 的软超时预算；超时后 LLM 调用会继续，只是不注入记忆。
- `maxTopK`：暴露给 agent 的 `top_k` 上限。

### Lifecycle hooks

[`index.ts`](index.ts) 注册了三个 hook：

| Hook | 时机 | 做什么 |
|---|---|---|
| `llm_input` | 用户 turn 到达 | 去掉旧的 `<relevant_context>` block，标准化输入，运行 trigger heuristic，并按 `session_id` 暂存一次 pending auto-save |
| `llm_output` | assistant turn 到达 | 和 pending user turn 配对，构建 canonical QA JSON，POST `/v1/memory/save` |
| `before_prompt_build` | 下一次 LLM 调用前 | 用标准化 prompt POST `/v1/memory/search`；如果有结果，返回 `{ prependContext: "<relevant_context>...</relevant_context>" }` |

### 注册的 tools 和 CLI

| 类型 | 名称 | 说明 |
|---|---|---|
| Tool | `memory_search` | Top-k memory search；模型侧只暴露召回参数（`query`、`top_k` / `maxResults`），tenant/scope 由插件配置或环境变量补齐 |
| Tool | `memory_fetch_recent` | 最近 chunks；模型侧只暴露 `limit`，tenant/scope 由插件配置或环境变量补齐 |
| Service | `memsense-server` | 后台 lifecycle；Docker 模式下连接已运行 API，no-Docker local 模式下可用 `scripts/start-bash.sh` / `scripts/stop-bash.sh` 启停 |
| CLI | `memsense-ping` | 检查插件是否已加载 |

[快速开始：绑定 memory slot](#绑定-memory-slot) 的 slot binding 会告诉 OpenClaw：把 agent 的 `memory` slot 路由到 `memsense`。

---

## Roadmap：从记忆到持续学习

<p align="center">
  <img alt="MemSense roadmap：从记忆到持续学习" src="docs/assets/roadmap.png" width="100%" />
</p>

MemSense 会用结构化 metadata 捕获每条 trajectory，包括 kind、tags、facets、outcome score、events。这为下一步打基础：**把整理后的 trajectory 作为信号，回流到模型训练中**，也就是 Capture → Refine Signal → Learn Model。这个 section 之前的能力是现在已经可运行的；Roadmap 是后续方向。

注：MemSense 不会把你的 trajectory 或记忆数据上传、经过或存储到我们的服务器；整个系统运行在你的私有环境中，数据也完全留在本地。

---

## 文档

- [Architecture overview](docs/features/architecture-overview.md)
- [Retrieval algorithm：RRF + MMR](docs/features/retrieval-algorithm.md)
- [Embedding & search internals](docs/features/embedding-search.md)
- [Dashboard & RBAC](docs/features/dashboard-rbac.md)
- [Worker retry / DLQ](docs/features/worker-retry-dlq.md)
- [Local BGE one-click setup](docs/features/local-bge-oneclick.md)
- [更新指南](docs/features/update-guide.zh-CN.md)
- [API smoke test](docs/features/api-smoke-test.md)
- [无 Docker 安装文档](docs/features/no-docker-quickstart.zh-CN.md)
- [Evaluation README](evaluation/README.md)

---

## 社区与贡献

MemSense 还在早期阶段。最有帮助的参与方式：

- Star 和 watch 这个 repo，方便我们判断优先级。
- 提 issue 时请尽量带上复现步骤。具体的 bug report 比泛泛的 feature wish 更有用。
- 在你的 stack 上跑一遍 eval，把结果分享出来。和预期不一样的结果尤其有价值。

### 参与开发

```bash
npm ci                # 安装 no-Docker 开发和测试需要的本地依赖
npm test              # Node native test runner；test/ 下有 22 个 test files
npm run smoke:api     # 对运行中的 server 做端到端 smoke test
npm run db:migrate    # 把 src/server/db/schema.sql 应用到 MEMSENSE_DATABASE_URL
npm run server        # 只启动 HTTP server
npm run worker        # 只启动 embedding worker
npm run tag-worker    # 只启动 tag worker
```

做非小改动前，建议先读：

1. [`docs/features/architecture-overview.md`](docs/features/architecture-overview.md)：4-layer pipeline。
2. [`docs/features/retrieval-algorithm.md`](docs/features/retrieval-algorithm.md)：RRF、MMR 和 `final_score` 公式。
3. [`src/server/service.js`](src/server/service.js) 和 [`src/server/retrieval/rerank.js`](src/server/retrieval/rerank.js)：retrieval 真正发生的地方。

欢迎 PR。涉及行为变化时，请在 `test/*.test.mjs` 下加测试，并在 push 前运行 `npm test`。

---

## 许可证

[MIT](LICENSE).
