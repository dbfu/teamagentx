# TeamAgentX

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

English | [中文](README.md)

TeamAgentX is a multi-agent collaboration platform with a Feishu/Lark-style UI. Users can mention different AI assistants with `@agent-name` in chatrooms, allowing multiple agents to collaborate, hand off tasks, run shell/ACP tools, maintain room memory, create todos, and execute scheduled room tasks.

The project uses a monorepo structure, containing a React web app, an Electron desktop shell, a Flutter mobile app, and a Fastify backend.

## Features

- Multi-agent chatrooms: Mention specific assistants with `@` in the same room.
- Agent execution queue: Process tasks sequentially per chatroom-agent context, with support for interruption and resume.
- ACP / SDK integration: Supports Claude, Codex and other ACP tools, plus built-in LangChain executor.
- Room memory: Long-term summarized memory per chatroom-agent pair.
- Real-time messaging: Socket.io-based push for messages, streaming output, tool calls, task status, and unread counts.
- Scheduled tasks: Configure cron tasks for chatrooms and track execution history.
- Multi-platform: Web, Electron desktop, and Flutter mobile.
- Local-first: Defaults to SQLite/libsql, suitable for local development and desktop packaging.

## Tech Stack

| Module | Technologies |
| --- | --- |
| Web | React 19, TypeScript, Vite 6, Tailwind CSS 4, shadcn/ui, Zustand, Socket.io-client |
| Desktop | Electron 41, Vite, electron-builder, Electron `utilityProcess` |
| Mobile | Flutter/Dart, Provider, go_router, Dio, socket_io_client, WebView, QR scanner |
| Server | Fastify 5, TypeScript, Socket.io, Prisma 7, SQLite/libsql, LangChain/LangGraph, ACP SDK, OpenAI Codex SDK |

## Directory Structure

```text
.
├── apps/
│   ├── web/       # React frontend
│   ├── desktop/   # Electron desktop
│   └── mobile/    # Flutter mobile
├── server/        # Fastify backend, Prisma, agent execution system
├── packages/      # Shared packages (reserved)
├── docs/          # Project documentation
├── start.sh       # Local startup script
├── build-dmg.sh   # macOS desktop build script
└── build-win.sh   # Windows desktop build script
```

## Requirements

- Node.js 20+
- pnpm
- Flutter 3.x / Dart 3.11+ (only for mobile)
- SQLite CLI (optional, for local database inspection)

## Quick Start

Install dependencies:

```bash
pnpm install
```

Start Web development mode:

```bash
./start.sh
# or
./start.sh web
```

Defaults to:
- Backend: `http://localhost:3001`
- Web frontend: `http://localhost:5173`

Start Electron development mode:

```bash
./start.sh electron
```

In Electron mode, the desktop app starts an embedded backend listening on port `11053` by default.

## Docker Deployment

Package the backend as a **single container**: Fastify serves the frontend SPA + API + Socket together, so clients access it via `http://<server-ip>:3001` in a browser (same-origin, zero config). The SQLite database, uploads, and account are persisted in the `/data` volume.

> Full guide (HTTPS reverse proxy, cross-arch build & image push, security notes): see [`docs/docker-deploy.md`](docs/docker-deploy.md).

The container starts its entrypoint as root, automatically hands the data volume over to the `node` user, then drops privileges to run (the Claude Code CLI refuses to run as root). So any of the methods below works out of the box.

### Option 1: docker compose (recommended)

```bash
# 1. Prepare environment variables
cp .env.docker.example .env
# Edit .env: AUTH_PASSWORD is required; JWT_SECRET is recommended (openssl rand -hex 32)

# 2. Build and start (builds the image on first run)
docker compose up -d --build

# 3. Open http://<server-ip>:3001 in a browser
#    Log in with AUTH_USERNAME / AUTH_PASSWORD from .env

# Operations
docker compose logs -f          # view logs
docker compose up -d --build    # upgrade (rebuild image + auto-migrate)
docker compose down             # stop (data volume preserved)
```

### Option 2: docker command

```bash
# 1. Build the image
docker build -t teamagentx-server .

# 2. Start (data persisted to the named volume teamagentx-data)
docker run -d --name teamagentx-server \
  -p 3001:3001 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=change-me \
  -v teamagentx-data:/data \
  teamagentx-server

# Logs / stop
docker logs -f teamagentx-server
docker rm -f teamagentx-server      # remove container (named volume teamagentx-data preserved)
```

### Option 3: use the published remote image (fastest, no build)

The image is published to a **public** registry — **no `docker login`, no local build** required, just pull and run:

```text
registry.cn-hangzhou.aliyuncs.com/teamagentx/teamagentx-server:latest
```

docker command:

```bash
docker run -d --name teamagentx-server \
  -p 3001:3001 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e AUTH_USERNAME=admin \
  -e AUTH_PASSWORD=change-me \
  -v teamagentx-data:/data \
  registry.cn-hangzhou.aliyuncs.com/teamagentx/teamagentx-server:latest
```

Or with compose (the repo ships `deploy/prod/docker-compose.prod.yml`, which pulls the remote image instead of building):

```bash
cd deploy/prod
cp ../../.env.docker.example .env    # edit .env: AUTH_PASSWORD required, JWT_SECRET recommended
docker compose -f docker-compose.prod.yml up -d   # public registry, no docker login needed

# upgrade to the latest image
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

Notes:

- The account is pre-provisioned from `AUTH_USERNAME` / `AUTH_PASSWORD` at container startup, **preventing others on the network from registering first**; changing the password and restarting takes effect immediately.
- `prisma migrate deploy` runs automatically at startup to create/upgrade the schema in the data volume.
- The Claude / Codex SDKs are bundled in the image — no runtime installation needed.

## Common Commands

### Backend

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

You can also use from project root:

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

## Environment Variables

Backend config is centralized in `server/src/config/index.ts`. Frontend build variables start with `VITE_`.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Backend port |
| `SERVER_HOST` | `0.0.0.0` | Backend listen address |
| `DATABASE_URL` | `file:./dev.db` | Prisma/libsql database path |
| `JWT_SECRET` | (random, persisted) | JWT signing key; if unset, a `.jwt-secret` is generated in the data dir |
| `AGENT_HISTORY_THRESHOLD` | `20` | Agent history message threshold |
| `AGENT_MEMORY_RECENT_MESSAGES` | `10` | Recent messages kept for memory summary |
| `AGENT_MEMORY_COMPACT_MESSAGES` | `40` | Message count triggering memory compression |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | `2000` | Target token count for memory summary |
| `VITE_SHOW_EXECUTION_CONTEXT` | `true` | Frontend build variable, set to `false` to hide context in execution details |
| `OPENCLAW_GATEWAY_TOKEN` | none | OpenClaw ACP gateway token, `start.sh` can auto-load from `~/.openclaw/openclaw.json` |

LLM credentials are primarily stored in the local `LlmProvider` table. ACP executors map providers to tool-specific env vars, e.g., Claude uses `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`, Codex uses `OPENAI_API_KEY`/`OPENAI_MODEL`.

## Database

Backend uses Prisma 7 with SQLite/libsql. Default development database:

```text
server/dev.db
```

Common inspection commands:

```bash
cd server
DATABASE_URL=file:./dev.db pnpm exec prisma migrate status
sqlite3 dev.db 'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;'
sqlite3 dev.db 'PRAGMA table_info("ChatRoom");'
```

After modifying `server/prisma/schema.prisma`, you need to add a Prisma migration and regenerate Prisma Client if needed:

```bash
cd server
pnpm db:migrate
pnpm db:generate
```

## Desktop Debugging

Log location for packaged macOS desktop app:

```text
~/Library/Application Support/@teamagentx/desktop/electron-debug.log
```

View logs:

```bash
tail -n 200 "~/Library/Application Support/@teamagentx/desktop/electron-debug.log"
tail -f "~/Library/Application Support/@teamagentx/desktop/electron-debug.log"
```

Desktop default paths:

```text
Database:
~/Library/Application Support/@teamagentx/desktop/teamagentx.db

Upload directory:
~/Library/Application Support/@teamagentx/desktop/uploads/images
```

Desktop ports:

- Embedded backend: `11053`
- Mobile web entry service: `11054`

## Development Conventions

- Use pnpm for all Node projects.
- TypeScript strict mode enabled.
- ES Modules for backend and frontend.
- Web path alias `@/*` maps to `apps/web/src/*`.
- Web state mainly in `apps/web/src/stores/`.
- Web API/Socket clients in `apps/web/src/lib/`.
- shadcn/ui components in `apps/web/src/components/ui/`.
- Electron preload API exposed via `apps/desktop/electron/preload.ts` to `window.electronAPI`.
- Mobile state in `apps/mobile/lib/stores/`, API/Socket services in `apps/mobile/lib/services/`.

## Agent Execution Architecture

Backend agent system core is in `server/src/core/agent/`:

- `executor.factory.ts` creates different executor types.
- `IAgentExecutor` defines unified executor interface.
- `TaskQueue` processes tasks by chatroom-agent context.
- Executor instances are cached per chatroom-agent pair for memory/session isolation.
- `AgentRoomMemory` stores long-term room memory.
- `EventEmitter` receives message events and triggers agent handling.

Runtime work directory priority:

1. Quick Chat/session directory
2. `ChatRoom.workDir`
3. Default directory

`Agent.workDir` is for assistant-level config and skills base. `ChatRoomAgent.customWorkDir` is a legacy field, not recommended for new runtime behavior.

## Real-time Events

Socket.io uses JWT authentication. Main events include:

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

Chatrooms join by `chatRoomId`. User-specific pushes use `user:<userId>` rooms.

## Build & Verification

Before committing, run at least relevant module checks:

```bash
cd server && pnpm test
cd apps/web && pnpm lint && pnpm build
cd apps/desktop && pnpm typecheck
```

For database schema changes, additionally confirm migration status:

```bash
cd server
DATABASE_URL=file:./dev.db pnpm exec prisma migrate status
```

## License

This project is open-sourced under the [MIT License](LICENSE). You may freely use, modify, distribute, and commercialize it, with only the requirement to preserve the copyright and license notice.
