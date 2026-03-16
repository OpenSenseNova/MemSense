# Memsense 已实现功能清单（真实实现版）

> 目标：确认“当前已有功能都可用”，并给出实现细节与测试覆盖。

## 1. 系统架构（已实现）

- OpenClaw 插件网关：`index.ts`
- 后端 API：`src/server/app.js`
- 领域服务：`src/server/service.js`
- 向量与 Embedding 适配：`src/server/embedding/client.js`
- 数据库：PostgreSQL + pgvector（`src/server/db/schema.sql`）
- 异步 Worker：`src/worker/index.js` + `src/worker/queue.js`
- Dashboard：`/dashboard`（静态页 + API）

## 2. 功能对照（可用性确认）

### 2.1 Memory 写入（save）✅

实现：
- 插件工具：`memory_save` / `memory_os_write`
- 后端接口：`POST /v1/memory/save`
- DB：写入 `memory_chunks`，并入队 `embedding_jobs`

关键实现细节：
- 支持字段：tenant/scope/session/user/content/tags/task_tag/score/confidence/timestamp
- 写入后异步向量化（由 worker 消费队列）

测试覆盖：
- `test/memory-service.test.mjs`
- `test/validation.test.mjs`
- `test/dedup.test.mjs`

---

### 2.2 Memory 检索（search）✅

实现：
- 插件工具：`memory_search` / `memory_os_retrieve`
- 后端接口：`POST /v1/memory/search`
- 检索策略：向量召回 + lexical 信号 + hybrid rerank

关键实现细节：
- 向量相似度来自 `pgvector`
- 返回字段包含：`final_score` + `explain`（解释各分量贡献）

测试覆盖：
- `test/rerank.test.mjs`
- `test/embedding-client.test.mjs`

---

### 2.3 最近记忆（fetch_recent）✅

实现：
- 插件工具：`memory_fetch_recent` / `memory_os_list_recent`
- 后端接口：`POST /v1/memory/fetch_recent`

关键实现细节：
- 支持 `tenant/scope/session/user` 过滤
- 按 `timestamp_ms DESC` 返回

测试覆盖：
- `test/storage.test.mjs`

---

### 2.4 触发机制（rule + 用户显式）✅

实现：
- `src/trigger/rule-trigger.js`
- `src/trigger/explicit-trigger.js`
- `src/trigger/trigger-pipeline.js`
- `src/capture/chunk-builder.js`
- `MemoryService.captureTurn(...)`

关键实现细节：
- 优先级：显式触发 > 规则触发
- 触发后构建 QA chunk 进行保存

测试覆盖：
- `test/trigger.test.mjs`
- `test/chunk-builder.test.mjs`
- `test/memory-capture.test.mjs`

---

### 2.5 Dashboard（session-first）✅

实现：
- 页面：`/dashboard`（`src/server/public/dashboard.html`）
- 接口：
  - `POST /v1/dashboard/overview`
  - `POST /v1/dashboard/set_status`

关键实现细节：
- 支持筛选：tenant/scope/session/user
- 支持状态操作：archive/restore

---

### 2.6 权限控制（RBAC）✅

实现：
- `src/server/auth.js`
- 角色：viewer/operator/admin
- token 角色映射：`MEMSENSE_DASHBOARD_TOKENS_JSON`

关键实现细节：
- `/dashboard` 与 `/v1/dashboard/overview` 需要 viewer
- `/v1/dashboard/set_status` 需要 operator

测试覆盖：
- `test/auth.test.mjs`

---

### 2.7 异步 Worker + Retry + DLQ ✅

实现：
- Worker 主循环：`src/worker/index.js`
- 队列控制：`src/worker/queue.js`
- DB：`embedding_jobs` / `embedding_dlq`

关键实现细节：
- `FOR UPDATE SKIP LOCKED` 抢占任务
- 指数退避重试
- 达到 max attempts 转入 DLQ

测试覆盖：
- `test/worker-queue.test.mjs`

---

## 3. 自动化验证状态

- 本地单测：`npm test`，当前全绿
- GitHub Actions：CI 近期提交连续通过（main push）

建议验收命令：

```bash
npm test
npm run db:migrate
npm run server
npm run worker
```

或一键本地联调：

```bash
docker compose up
```

## 4. 当前不在本轮范围（已确认）

- SSO/OAuth 登录
- DLQ Replay 可视化操作台
- SLA/告警体系
- 每日整理策略全量自动化

以上项本轮不做，先确保现有功能稳定可用。
