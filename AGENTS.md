# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

TeamAgentX is a multi-agent collaboration platform with a Feishu/Lark-like UI. Users interact with multiple AI agents by mentioning them with `@agent-name` in chatrooms. Agents can collaborate, hand off tasks, run shell/ACP tools, maintain room memory, create todos, and execute scheduled room tasks.

The product currently includes a React web app, an Electron desktop shell, a Flutter mobile app, and a Fastify backend.

## Architecture

**Monorepo Structure**:
- `apps/web/` - React frontend (Feishu-style UI)
- `apps/desktop/` - Electron desktop shell that packages the web UI and backend
- `apps/mobile/` - Flutter mobile app
- `server/` - Fastify backend with Socket.io, Prisma, agent execution, cron tasks, uploads, and desktop entry
- `docs/` - Project documentation

**Tech Stack**:
- Web: React 19, TypeScript, Vite 6, Tailwind CSS 4, shadcn/ui (new-york style), Socket.io-client, Zustand, react-mentions, react-markdown
- Desktop: Electron 41, Vite, electron-builder, Electron `utilityProcess` for the embedded backend
- Mobile: Flutter/Dart, Provider, go_router, Dio, socket_io_client, WebView, QR scanner
- Backend: Fastify 5, TypeScript, Socket.io, Prisma 7 (SQLite/libsql adapter), LangChain/LangGraph, ACP SDKs, OpenAI Codex SDK, JWT auth

## Common Commands

```bash
# Start web mode from project root (server 3001 + Vite 5173)
./start.sh
./start.sh web

# Start Electron dev mode from project root (embedded server 11053)
./start.sh electron

# Server (from server/)
pnpm dev                  # Development with watch mode
pnpm start                # Run src/index.ts with tsx
pnpm build                # TypeScript build
pnpm db:migrate           # Run Prisma migrations
pnpm db:generate          # Generate Prisma client
pnpm db:seed              # Seed database
pnpm db:studio            # Open Prisma Studio
pnpm test                 # Run node:test with coverage
pnpm test:watch           # Run tests in watch mode

# Web (from apps/web/)
pnpm dev                  # Start Vite dev server
pnpm build                # Production build (tsc -b + vite build)
pnpm lint                 # Run ESLint
pnpm preview              # Preview production build

# Desktop (from apps/desktop/)
pnpm dev                  # Electron dev mode
pnpm typecheck            # Type-check Electron main/preload code
pnpm build                # Build packaged desktop app
pnpm electron:build       # Alias for desktop build

# Mobile (from apps/mobile/)
flutter pub get
flutter run
flutter analyze
flutter test
```

## Desktop DMG Debugging

- 打包后的 macOS 桌面版（DMG / `.app`）启动日志会写入：
  `/Users/fudebao/Library/Application Support/@teamagentx/desktop/electron-debug.log`
- 排查 DMG / Electron 打包问题时，先查看这个日志，再看接口报错和数据库状态。
- Electron 内置后端固定监听 `11053`，移动端 Web 入口服务监听 `11054`。
- 常用命令：

```bash
tail -n 200 "/Users/fudebao/Library/Application Support/@teamagentx/desktop/electron-debug.log"
tail -f "/Users/fudebao/Library/Application Support/@teamagentx/desktop/electron-debug.log"
```

- 桌面版 SQLite 数据库默认路径：
  `/Users/fudebao/Library/Application Support/@teamagentx/desktop/teamagentx.db`
- 桌面版上传目录在 userData 下：
  `/Users/fudebao/Library/Application Support/@teamagentx/desktop/uploads/images`
- 例如检查 `ChatRoom` 表结构：

```bash
sqlite3 "/Users/fudebao/Library/Application Support/@teamagentx/desktop/teamagentx.db" 'PRAGMA table_info("ChatRoom");'
```

## Key Architecture Patterns

### Agent Execution System
- **Factory Pattern**: `server/src/core/agent/executor.factory.ts` creates `LangChainAgentExecutor`, `ClaudeAgentSdkExecutor`, `CodexSdkExecutor`, or generic `AcpExecutor`.
- **Agent Types**: Prisma `Agent.type` is `builtin` or `acp`; ACP agents use `acpTool` such as `claude` or `codex`. The visible ACP tools in the UI are currently Claude and Codex.
- **Interface**: `IAgentExecutor` defines the shared executor contract.
- **Queue Processing**: Agent tasks are queued in `TaskQueue` and processed sequentially per chatroom-agent context.
- **Caching**: Executor instances are cached per chatRoom-agent combination for memory/session isolation. Clear the room cache when room execution settings such as `workDir` change.
- **Work Directory Rules**: Runtime workdir priority is quick-chat/session directory, then `ChatRoom.workDir`, then the default directory. Group assistants no longer have per-room custom work directories. `Agent.workDir` remains the assistant-level config and skills base; `ChatRoomAgent.customWorkDir` is legacy data and should not be used for new runtime behavior.
- **Memory**: `AgentRoomMemory` stores long-term per-room/per-agent summaries; recent messages and compact thresholds are controlled by config env vars.
- **Event-Driven**: `EventEmitter` emits `receivedMessage` events that trigger agent handling.

### Real-Time Communication
- Socket.io with JWT authentication.
- Main room events include `message`, `agent:typing`, `agent:stream`, `agent:thinking`, `agent:tool_call`, `agent:done`, `agent:status`, `agent:task-queue`, `agent:task-cancelled`, `agent:task-resumed`, and `unread:update`.
- Rooms are scoped by `chatRoomId`; user-specific pushes use `user:<userId>` rooms.

### Database Models
- `Agent` - AI agents with prompt, `type` (`builtin`/`acp`), `acpTool`, `workDir`, category, LLM provider, level, and sort order
- `LlmProvider` - Local model/API configuration, currently `custom` providers with `anthropic` or `openai` protocol
- `AgentCategory` - Assistant categories and ordering
- `ChatRoom` - Chat rooms with owner, rules, group `workDir`, default agent, trigger mode, pinned state, quick-chat metadata
- `ChatRoomAgent` - Many-to-many relationship between rooms, agents, and users; keeps `injectGroupHistory`, read state, and legacy `customWorkDir`
- `Message` / `Attachment` - Chat messages, replies, execution linkage, token stats, and uploaded images/files
- `TaskQueue` - Async agent task queue with interruption/resume support
- `ExecutionRecord` - Agent execution audit log with events, context, status, duration, and token usage
- `AgentRoomMemory` - Long-term summarized memory per chatroom-agent
- `QuickChatSession` - Quick-chat session directories and lifecycle
- `CronTask` / `CronTaskExecution` - Room-level scheduled task definitions and execution records
- `BackgroundTask` - Long-running shell command tracking
- `Todo` - Legacy todo schema retained for existing data; runtime todo creation and socket events are currently removed
- `User` - User accounts, auth, room ownership, unread tracking

### Frontend Patterns
- Web path alias: `@/*` maps to `apps/web/src/*`.
- State is mainly in Zustand stores under `apps/web/src/stores/`.
- Socket and API clients live under `apps/web/src/lib/`.
- shadcn/ui components live in `apps/web/src/components/ui/`.
- Electron APIs are exposed through `window.electronAPI` from `apps/desktop/electron/preload.ts`.
- Mobile uses Provider stores under `apps/mobile/lib/stores/` and API/socket services under `apps/mobile/lib/services/`.

## Environment Variables

Server config is centralized in `server/src/config/index.ts`:
- `PORT` (default: `3001`)
- `SERVER_HOST` (default: `0.0.0.0`)
- `DATABASE_URL` (default: `file:./dev.db`; Electron sets this to the desktop userData database)
- `JWT_SECRET`, `JWT_EXPIRES_IN`
- `AGENT_HISTORY_THRESHOLD`
- `AGENT_MEMORY_RECENT_MESSAGES`
- `AGENT_MEMORY_COMPACT_MESSAGES`
- `AGENT_MEMORY_SUMMARY_TARGET_TOKENS`
- `OPENCLAW_GATEWAY_TOKEN` can be loaded by `start.sh` from `~/.openclaw/openclaw.json` for OpenClaw ACP usage.

LLM credentials are stored primarily in the local `LlmProvider` table. ACP executors map providers to tool-specific env vars such as `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` for Claude and `OPENAI_API_KEY`/`OPENAI_MODEL` for Codex.

## Database Migration Rules

- Prisma migrations are the source of truth for database schema. Any `server/prisma/schema.prisma` change must be paired with a migration under `server/prisma/migrations/` and followed by Prisma client generation when needed.
- Do not add startup schema reconciliation scripts such as `ensure-database-schema.ts` as the normal fix for missing columns. Fix schema drift through Prisma migrations and migration history.
- The local development database `server/dev.db` is expected to have `_prisma_migrations` baseline history. Before changing or repairing it, back it up first.
- If a non-empty SQLite database is missing `_prisma_migrations`, do not use random `db push` or ad-hoc `ALTER TABLE` as the long-term solution. Inspect schema drift, back up the database, then baseline existing migrations with `prisma migrate resolve --applied <migration_name>` so data is preserved and history becomes authoritative.
- Manual SQL changes are only acceptable as emergency local repair. If used, immediately add the matching Prisma migration and resolve/baseline migration history so future starts do not drift again.
- Desktop local databases should go through the Electron/Prisma migration flow. Do not assume desktop databases lack migration history; check the desktop log and SQLite file before touching data manually.
- Useful checks from `server/`:

```bash
DATABASE_URL=file:./dev.db pnpm exec prisma migrate status
sqlite3 dev.db 'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;'
sqlite3 dev.db 'PRAGMA table_info("ChatRoom");'
```

## Code Style

- TypeScript strict mode is enabled for server/web/desktop.
- ES modules are used (`type: "module"` in package files).
- Use pnpm for Node package management; use Flutter tooling only inside `apps/mobile/`.
- Chinese comments are acceptable and already used in source files.
- React component files should stay under 500 lines; split into sub-components or extract hooks/stores when needed.
- Prefer existing local helpers, services, stores, and UI components over introducing new patterns.

## UI Style Guidelines

- **主题色**: 蓝色 (`bg-blue-500` / `hover:bg-blue-600`)
- **按钮规范**:
  - 主要操作按钮使用主题色：`className="bg-blue-500 hover:bg-blue-600"`
  - 取消/次要按钮使用 `border border-gray-200 text-gray-600 hover:bg-gray-50`
  - 弹框确认按钮必须使用主题色，与项目风格保持一致
- **弹框结构**: 参考 `create-assistant-modal.tsx` 的自定义弹框样式（固定定位、圆角、阴影）
- **表单样式**:
  - 输入框：`rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none`
  - 标签：`mb-1.5 block text-sm font-medium text-gray-700`
  - 必填标记：`<span className="text-red-500">*</span>`
  - 开关：自定义 toggle button 样式（`h-5 w-10 rounded-full bg-blue-500/bg-gray-200`）
- **UI 组件库**: shadcn/ui (new-york style)，组件位于 `apps/web/src/components/ui/`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **teamagentx** (11683 symbols, 19298 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/teamagentx/context` | Codebase overview, check index freshness |
| `gitnexus://repo/teamagentx/clusters` | All functional areas |
| `gitnexus://repo/teamagentx/processes` | All execution flows |
| `gitnexus://repo/teamagentx/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
