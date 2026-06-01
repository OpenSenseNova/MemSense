# 无 Docker 安装文档

> Docs → [MemSense 文档](../README.md)
> 相关文档：[Local BGE One-Click Deployment](local-bge-oneclick.md) · [API Smoke Test](api-smoke-test.md)

## 这个页面适合谁

这个页面适用于不能使用 Docker 的 macOS / Linux 环境。主 README 默认推荐 Docker 路径，因为 Docker 会一起启动 Postgres、API server、workers 和本地 BGE 服务，安装链路更短。

Windows 无 Docker 安装还在测试中。Windows 用户建议使用 Docker Desktop，并按照主 README 里的 Windows 命令安装。

---

## 环境要求

- Node.js 20+ 和 npm
- PostgreSQL 16+，并安装 `pgvector`
- Python 3.11+，local BGE embedding 需要 venv 支持

macOS 下，启动脚本可以通过 Homebrew 安装 PostgreSQL 和 pgvector。Linux 下，请先用系统包管理器安装 PostgreSQL、pgvector、Python 和 venv 支持。

---

## 选择 embedding 模式

只选择下面其中一种路径执行。

### 本地 embedding

```bash
bash scripts/bootstrap-nodocker.sh local
bash scripts/start-bash.sh
```

这个路径会安装依赖、初始化数据库、准备本地 BGE Python 服务，并启动 server、embedding worker、tag worker 和 BGE 服务。

### OpenAI-compatible embedding

先在 `.env` 里设置 `MEMSENSE_OPENAI_API_KEY`，然后执行：

```bash
bash scripts/bootstrap-nodocker.sh openai
bash scripts/start-bash.sh
```

这个路径会安装依赖、初始化数据库，并启动 server、embedding worker 和 tag worker。

---

## 运行控制

```bash
bash scripts/start-bash.sh
bash scripts/stop-bash.sh
```

日志位置：

- `.runtime/server.log`
- `.runtime/worker.log`
- `.runtime/tag-worker.log`
- `.runtime/bge.log`，仅本地 BGE 模式会有

---

## 下一步

- 阅读 [Local BGE One-Click Deployment](local-bge-oneclick.md)，了解本地 embedding 细节。
- 阅读 [API Smoke Test](api-smoke-test.md)，验证服务是否正常运行。
