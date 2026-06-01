# 更新指南

> Docs → [MemSense 文档](../README.md)
> 相关文档：[无 Docker 安装文档](no-docker-quickstart.zh-CN.md) · [API Smoke Test](api-smoke-test.md)

## 更新 MemSense

MemSense 运行在你的本地/私有环境中。远程仓库更新后，不会自动推送到你的机器。更新时需要你先自行拉取最新代码，然后运行更新脚本来重建本地运行环境、应用数据库迁移，并刷新 OpenClaw 插件。

更新脚本的策略：

- 不重写 `.env`
- 不执行 `docker compose down -v`
- 不删除 Docker volume 或本地 PostgreSQL 数据
- Docker 更新时，`server` 容器启动会自动执行数据库迁移
- 只有检测到 `openclaw` CLI 时才会尝试重装插件；可用 `--skip-plugin` / `-SkipPlugin` 跳过

---

## Docker 更新

脚本会从 `.env` 自动判断当前 embedding 模式。你也可以显式传入 `local` 或 `openai`。

macOS / Linux / WSL2：

```bash
bash scripts/update.sh
# 或：
bash scripts/update.sh local
bash scripts/update.sh openai
```

Windows PowerShell：

```powershell
.\scripts\update.ps1
# 或：
.\scripts\update.ps1 local
.\scripts\update.ps1 openai
```

它会执行：

1. 按当前 embedding 模式重建并重启 Docker Compose 服务
2. 由 `server` 容器在启动时执行 `npm run db:migrate`
3. 如果能找到 `openclaw` CLI，则重装并配置 OpenClaw 插件

如果只想更新服务，不想动 OpenClaw 插件：

```bash
bash scripts/update.sh --skip-plugin
```

```powershell
.\scripts\update.ps1 -SkipPlugin
```

---

## 无 Docker 更新

无 Docker 更新仅适用于 macOS / Linux。Windows 无 Docker 安装还在测试中。

```bash
bash scripts/update.sh --runtime nodocker
```

你自行拉取最新代码后，等价的手动步骤是：

```bash
npm ci
npm run build
bash scripts/stop-bash.sh
npm run db:migrate
bash scripts/start-bash.sh
bash scripts/install-openclaw-plugin.sh --force
```

如果你的本地 BGE Python 环境还没有初始化，请先执行无 Docker 安装：

```bash
bash scripts/bootstrap-nodocker.sh local
bash scripts/start-bash.sh
```

---

## 更新后验证

Docker：

```bash
docker compose ps
```

Dashboard：

```text
http://127.0.0.1:8787/dashboard?token=demo
```

如果你使用了自定义 `MEMSENSE_HOST_PORT`，请把 `8787` 换成对应端口。

API smoke test：

```bash
MEMSENSE_SMOKE_BASE_URL=http://127.0.0.1:8787 \
MEMSENSE_SMOKE_TOKEN=demo \
npm run smoke:api
```

---

## 数据安全

更新代码和重建服务不会删除记忆数据。

- Docker 数据保存在 `memsense-pg`、`memsense-hf` 等 Docker volumes 中
- 无 Docker 数据保存在你的本地 PostgreSQL 数据库和本地模型/缓存目录中

除非你明确想删除 Docker volumes 并重置本地数据，否则不要执行 `docker compose down -v`。
