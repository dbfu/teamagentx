# TeamAgentX

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README_EN.md) | 中文

TeamAgentX 是一个多智能体协作平台，界面风格接近飞书 / Lark。用户可以在聊天室中通过 `@agent-name` 提及不同 AI 助手，让多个 agent 在同一个上下文中协作、交接任务、调用工具、维护房间记忆，并执行定时任务。

项目采用 monorepo 结构，包含 React Web 应用、Electron 桌面壳、Flutter 移动端和 Fastify 后端。

## 功能概览

- 多 agent 聊天室：在同一房间中通过 `@` 提及指定助手。
- Agent 执行队列：按聊天室和 agent 上下文顺序处理任务，支持中断和恢复。
- ACP / SDK 集成：支持 Claude、Codex 等 ACP 工具和内置 LangChain 执行器。
- 房间记忆：按聊天室和 agent 保存长期摘要记忆。
- 实时消息：基于 Socket.io 推送消息、流式输出、工具调用、任务状态和未读数。
- 定时任务：为聊天室配置 cron 任务并记录执行历史。
- 多端访问：Web、Electron 桌面端和 Flutter 移动端。
- 本地优先：默认使用 SQLite / libsql，适合本地开发和桌面打包。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| Web | React 19, TypeScript, Vite 6, Tailwind CSS 4, shadcn/ui, Zustand, Socket.io-client |
| Desktop | Electron 41, Vite, electron-builder, Electron `utilityProcess` |
| Mobile | Flutter / Dart, Provider, go_router, Dio, socket_io_client, WebView, QR scanner |
| Server | Fastify 5, TypeScript, Socket.io, Prisma 7, SQLite / libsql, LangChain / LangGraph, ACP SDK, OpenAI Codex SDK |

## 目录结构

```text
.
├── apps/
│   ├── web/       # React 前端
│   ├── desktop/   # Electron 桌面端
│   └── mobile/    # Flutter 移动端
├── server/        # Fastify 后端、Prisma、agent 执行系统
├── packages/      # 共享包预留目录
├── docs/          # 项目文档
├── start.sh       # 本地启动脚本
├── build-dmg.sh   # macOS 桌面端打包脚本
└── build-win.sh   # Windows 桌面端打包脚本
```

## 环境要求

- Node.js 20+
- pnpm
- Flutter 3.x / Dart 3.11+（仅移动端需要）
- SQLite CLI（可选，用于排查本地数据库）

## 快速开始

安装依赖：

```bash
pnpm install
```

启动 Web 开发模式：

```bash
./start.sh
# 或
./start.sh web
```

默认会启动：

- 后端：`http://localhost:3001`
- Web 前端：`http://localhost:5173`

启动 Electron 开发模式：

```bash
./start.sh electron
```

Electron 模式下，桌面端会启动内置后端，默认监听 `11053`。

## Docker 部署

把服务端打包成**单容器**：Fastify 同时托管前端 SPA + API + Socket，客户端浏览器通过
`http://<服务器IP>:3001` 访问（同源，零配置）。SQLite 数据库、上传文件、账号等持久化在 `/data` 数据卷。

> 完整说明（HTTPS 反代、跨架构构建并推送镜像、安全建议）见 [`docs/docker-deploy.md`](docs/docker-deploy.md)。

容器以 root 启动 entrypoint，自动把数据卷属主交给 `node` 用户后降权运行（Claude Code CLI 拒绝在 root 下运行），因此下列任一启动方式都开箱即用。

### 方式一：docker compose（推荐）

```bash
# 1. 准备环境变量
cp .env.docker.example .env
# 编辑 .env：必须设置 AUTH_PASSWORD；建议设置 JWT_SECRET（openssl rand -hex 32）

# 2. 构建并启动（首次会构建镜像）
docker compose up -d --build

# 3. 浏览器访问 http://<服务器IP>:3001
#    用 .env 里的 AUTH_USERNAME / AUTH_PASSWORD 登录

# 常用运维
docker compose logs -f          # 查看日志
docker compose up -d --build    # 升级（重建镜像 + 自动迁移）
docker compose down             # 停止（数据卷保留）
```

### 方式二：docker 命令

```bash
# 1. 构建镜像
docker build -t teamagentx-server .

# 2. 启动（数据持久化到命名卷 teamagentx-data）
docker run -d --name teamagentx-server \
  -p 3001:3001 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=改成你的口令 \
  -v teamagentx-data:/data \
  teamagentx-server

# 查看日志 / 停止
docker logs -f teamagentx-server
docker rm -f teamagentx-server      # 删除容器（命名卷 teamagentx-data 保留）
```

### 方式三：直接使用已发布的远程镜像（最快，无需构建）

镜像已发布到公开仓库，**无需 `docker login`、无需本地构建**，拉取即用：

```text
registry.cn-hangzhou.aliyuncs.com/teamagentx/teamagentx-server:latest
```

docker 命令：

```bash
docker run -d --name teamagentx-server \
  -p 3001:3001 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=改成你的口令 \
  -v teamagentx-data:/data \
  registry.cn-hangzhou.aliyuncs.com/teamagentx/teamagentx-server:latest
```

或用 compose（仓库已提供 `deploy/prod/docker-compose.prod.yml`，直接拉取远程镜像、不构建）：

```bash
cd deploy/prod
cp ../../.env.docker.example .env    # 编辑 .env：必填 AUTH_PASSWORD，建议设 JWT_SECRET
docker compose -f docker-compose.prod.yml up -d   # 公开仓库，无需先 docker login

# 升级到最新镜像
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

说明：

- 账号由 `AUTH_USERNAME` / `AUTH_PASSWORD` 在容器启动时预置，**避免服务起来后被同网络他人抢先注册**；改口令后重启即生效。
- `prisma migrate deploy` 在启动时自动执行，对数据卷里的库建表/升级。
- Claude / Codex SDK 已内置镜像，无需运行时安装。

## 常用命令

### 后端

```bash
cd server
pnpm dev
pnpm start
pnpm build
pnpm test
pnpm test:watch
pnpm db:migrate
pnpm db:generate
pnpm db:seed
pnpm db:studio
```

### Web

```bash
cd apps/web
pnpm dev
pnpm build
pnpm lint
pnpm preview
```

### Desktop

```bash
cd apps/desktop
pnpm dev
pnpm typecheck
pnpm build
pnpm electron:build
```

也可以在项目根目录使用：

```bash
./build-dmg.sh
./build-win.sh
```

### Mobile

```bash
cd apps/mobile
flutter pub get
flutter run
flutter analyze
flutter test
```

## 环境变量

后端配置集中在 `server/src/config/index.ts`，前端构建变量以 `VITE_` 开头。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 后端端口 |
| `SERVER_HOST` | `0.0.0.0` | 后端监听地址 |
| `DATABASE_URL` | `file:./dev.db` | Prisma / libsql 数据库地址 |
| `JWT_SECRET` | （随机生成持久化） | JWT 签名密钥；未设置时在数据目录生成 `.jwt-secret` |
| `AGENT_HISTORY_THRESHOLD` | `20` | agent 历史消息阈值 |
| `AGENT_MEMORY_RECENT_MESSAGES` | `10` | 记忆摘要保留的近期消息数 |
| `AGENT_MEMORY_COMPACT_MESSAGES` | `40` | 触发记忆压缩的消息数 |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | `2000` | 记忆摘要目标 token 数 |
| `AGENT_COORDINATOR_LLM_TIMEOUT_MS` | `120000` | 群调度助手单次 LLM 决策调用超时，设为 `0` 禁用 |
| `AGENT_COORDINATOR_LLM_RETRY_COUNT` | `1` | 群调度助手 LLM 超时后的重试次数 |
| `AGENT_COORDINATOR_LLM_RETRY_DELAY_MS` | `1000` | 群调度助手 LLM 超时重试间隔 |
| `VITE_SHOW_EXECUTION_CONTEXT` | `true` | 前端构建变量，设为 `false` 时隐藏执行详情里的上下文 |
| `OPENCLAW_GATEWAY_TOKEN` | 无 | OpenClaw ACP 网关 token，`start.sh` 可从 `~/.openclaw/openclaw.json` 自动读取 |

LLM 凭证主要保存在本地数据库的 `LlmProvider` 表中。ACP 执行器会按工具映射为环境变量，例如 Claude 使用 `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`，Codex 使用 `OPENAI_API_KEY` / `OPENAI_MODEL`。

## 数据库

后端使用 Prisma 7 和 SQLite / libsql。开发环境默认数据库为：

```text
server/dev.db
```

常用检查命令：

```bash
cd server
DATABASE_URL=file:./dev.db pnpm exec prisma migrate status
sqlite3 dev.db 'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;'
sqlite3 dev.db 'PRAGMA table_info("ChatRoom");'
```

修改 `server/prisma/schema.prisma` 后，需要同时新增 Prisma migration，并在需要时重新生成 Prisma Client：

```bash
cd server
pnpm db:migrate
pnpm db:generate
```

## 桌面端调试

打包后的 macOS 桌面版日志位置：

```text
~/Library/Application Support/@teamagentx/desktop/electron-debug.log
```

查看日志：

```bash
tail -n 200 "~/Library/Application Support/@teamagentx/desktop/electron-debug.log"
tail -f "~/Library/Application Support/@teamagentx/desktop/electron-debug.log"
```

桌面端默认路径：

```text
数据库：
~/Library/Application Support/@teamagentx/desktop/teamagentx.db

上传目录：
~/Library/Application Support/@teamagentx/desktop/uploads/images
```

桌面端端口：

- 内置后端：`11053`
- 移动端 Web 入口服务：`11054`

## 开发约定

- Node 项目统一使用 pnpm。
- TypeScript 使用 strict mode。
- 后端和前端均使用 ES Modules。
- Web 路径别名 `@/*` 指向 `apps/web/src/*`。
- Web 状态主要放在 `apps/web/src/stores/`。
- Web API / Socket 客户端位于 `apps/web/src/lib/`。
- shadcn/ui 组件位于 `apps/web/src/components/ui/`。
- Electron preload API 通过 `apps/desktop/electron/preload.ts` 暴露到 `window.electronAPI`。
- 移动端状态位于 `apps/mobile/lib/stores/`，API / Socket 服务位于 `apps/mobile/lib/services/`。

## Agent 执行架构

后端 agent 系统的核心位于 `server/src/core/agent/`：

- `executor.factory.ts` 负责创建不同类型的执行器。
- `IAgentExecutor` 定义统一执行器接口。
- `TaskQueue` 按聊天室和 agent 上下文处理任务。
- 执行器实例按聊天室和 agent 缓存，以隔离记忆和会话。
- `AgentRoomMemory` 保存长期房间记忆。
- `EventEmitter` 接收消息事件并触发 agent 处理。

运行时工作目录优先级：

1. Quick Chat / session 目录
2. `ChatRoom.workDir`
3. 默认目录

`Agent.workDir` 用于助手级配置和 skills 基础目录。`ChatRoomAgent.customWorkDir` 是历史字段，不建议用于新的运行时行为。

## 实时事件

Socket.io 使用 JWT 认证。主要事件包括：

- `message`
- `agent:typing`
- `agent:stream`
- `agent:thinking`
- `agent:tool_call`
- `agent:done`
- `agent:status`
- `agent:task-queue`
- `agent:task-cancelled`
- `agent:task-resumed`
- `unread:update`

聊天室按 `chatRoomId` 加入 room，用户专属推送使用 `user:<userId>` room。

## 构建与验证

建议在提交前至少运行相关模块的检查：

```bash
cd server && pnpm test
cd apps/web && pnpm lint && pnpm build
cd apps/desktop && pnpm typecheck
```

涉及数据库 schema 的变更需要额外确认 migration 状态：

```bash
cd server
DATABASE_URL=file:./dev.db pnpm exec prisma migrate status
```

## 许可证

本项目基于 [MIT 协议](LICENSE) 开源，可自由使用、修改、分发和商用，仅需保留版权与协议声明。
