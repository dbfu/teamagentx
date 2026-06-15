# 09 · REST API Reference

[English](09-api-reference_EN.md) | [中文](09-api-reference.md)

> All APIs use `http://localhost:3001` as the base URL (`http://localhost:11053` when packaged in Electron).
> In development mode, you can access Swagger UI at: `http://localhost:3001/docs`

---

## Auth

| Method | Path | Description |
|-----|------|------|
| GET | `/auth/check-first-use` | Check if first-time use (no registration needed if no users exist) |
| POST | `/auth/register` | Register (`username`, `password`) |
| POST | `/auth/login` | Login, returns `token` |
| GET | `/auth/me` | Get current user info (requires Bearer token) |
| PUT | `/auth/profile` | Update username/avatar |

---

## Setup / App Settings / Health

| Method | Path | Description |
|-----|------|------|
| GET | `/health` | Health check |
| GET | `/network-info` | LAN access address information |
| GET | `/openapi.json` | OpenAPI JSON (Swagger enabled by default outside Electron) |
| GET | `/setup/status` | First-run status and ACP tool installation state (public, desktop) |
| POST | `/setup/complete` | Complete first-run setup (register + default Agent/model) |
| POST | `/setup/install-tool` | Stream-install an ACP tool (Claude / Codex, desktop) |
| GET / PUT | `/settings/:key` | Read / update allowlisted app settings (currently `diaryEnabled`) |

---

## Agents

| Method | Path | Description |
|-----|------|------|
| GET | `/agents` | List all agents |
| GET | `/agents/active` | List all active agents |
| GET | `/agents/grouped` | List agents grouped by category |
| GET | `/acp-tools` | List supported local Agent tools and installation status (Claude / Codex) |
| GET | `/agents/:id` | Get single agent details |
| POST | `/agents` | Create agent |
| PUT | `/agents/:id` | Update agent |
| DELETE | `/agents/:id` | Delete agent |
| PATCH | `/agents/:id/status` | Activate/deactivate (`isActive: boolean`) |
| POST | `/agents/:id/clear-context` | Clear agent's global context |
| PUT | `/agents/sort-order` | Batch update sort order (`items: [{id, sortOrder}]`) |
| POST | `/agents/optimize-prompt` | Optimize prompt (sync) |
| POST | `/agents/optimize-prompt-stream` | Optimize prompt (streaming SSE) |

### Quick Chat

| Method | Path | Description |
|-----|------|------|
| POST | `/agents/quick-chat` | Create a quick chat temporary room (`agentId`, `userId`, `workDir?`) |
| GET | `/agents/:agentId/quick-chat-rooms` | Get quick chat room list for an agent |
| GET | `/agents/:agentId/quick-chat-count` | Get quick chat count for an agent |
| GET | `/chatrooms/:chatRoomId/quick-chat-session/claude-local-sessions` | List local Claude history sessions |
| POST | `/chatrooms/:chatRoomId/quick-chat-session/claude-local-session` | Bind/switch a local Claude session |
| GET | `/chatrooms/:chatRoomId/quick-chat-session/codex-local-sessions` | List local Codex history sessions |
| POST | `/chatrooms/:chatRoomId/quick-chat-session/codex-local-session` | Bind/switch a local Codex session |

### Agent Diary / Memory

| Method | Path | Description |
|-----|------|------|
| GET | `/agents/:agentId/memory` | Agent long-term memory summary |
| GET | `/agents/:agentId/diary` / `/diary/:date` | Agent diary (by date) |
| POST | `/agents/:agentId/diary/generate` | Generate diary now |

---

## ChatRooms

| Method | Path | Description |
|-----|------|------|
| GET | `/chatrooms` | List all chat rooms (includes lastMessage, members) |
| GET | `/chatrooms/:id` | Get single chat room details |
| POST | `/chatrooms` | Create chat room (`name`, `workDir?`, `rules?`, `ownerId?`) |
| PUT | `/chatrooms/:id` | Update chat room (`name`, `rules`, `dispatchRules`, `workDir`, `envVars`, `defaultAgentId`, `agentTriggerMode`) |
| DELETE | `/chatrooms/:id` | Delete chat room |
| PATCH | `/chatrooms/:id/pin` `/unpin` | Pin / unpin |
| PATCH | `/chatrooms/:id/collapse` `/uncollapse` | Collapse / uncollapse |
| POST | `/chatrooms/:id/duplicate` | Duplicate room (with members/rules/dispatchRules) |
| POST | `/chatrooms/:id/fork` | Fork a new room from archived history |

> `dispatchRules` (dispatch rules YAML) is saved via `PUT /chatrooms/:id` with zod structural validation on save; invalid formats are rejected.

### Chat Room Members

| Method | Path | Description |
|-----|------|------|
| POST | `/chatrooms/:id/agents` | Add agent/user member (`agentId`, `userId?`, `role?`, `injectGroupHistory?`) |
| DELETE | `/chatrooms/:id/agents/:agentId` | Remove member |
| PATCH | `/chatrooms/:id/agents/:agentId/settings` | Update member settings (`injectGroupHistory`) |
| POST | `/chatrooms/:id/agents/:agentId/clear-context` | Clear agent's context in this room |
| GET | `/chatrooms/:id/agents/:agentId/context` | Get agent's context info in this room |
| GET | `/chatrooms/:id/agents/:agentId/tasks` | Get agent's task queue in this room |
| GET | `/chatrooms/:id/tasks/board` | Get room task board (all agents' tasks summary) |
| GET | `/chatrooms/:id/quick-chat-session` | Get current quick chat session |

### Execution Records

| Method | Path | Description |
|-----|------|------|
| GET | `/chatrooms/:chatRoomId/agents/:agentId/executions` | Get execution record list (`take?`) |
| DELETE | `/chatrooms/:chatRoomId/agents/:agentId/executions` | Delete execution records |
| GET | `/chatrooms/:chatRoomId/agents/:agentName/debug` | Get agent debug info |

### Group Git / Scripts / Commands (desktop)

| Method | Path | Description |
|-----|------|------|
| GET | `/chatrooms/:id/git-status` | Git status of the room work dir |
| POST | `/chatrooms/:id/git-branch` | Create/switch branch |
| POST | `/chatrooms/:id/git-command` | Run a restricted git command |
| GET | `/chatrooms/:id/package-scripts` | Read package.json scripts |
| POST | `/chatrooms/:id/package-scripts/run` | Run a script |
| GET / POST | `/chatrooms/:chatRoomId/commands` | List / create custom commands |
| PUT / DELETE | `/commands/:commandId` | Update / delete a command |

---

## Messages

| Method | Path | Description |
|-----|------|------|
| GET | `/messages` | Message list (`chatRoomId?`, max 100) |
| GET | `/messages/:id` | Get single message |
| GET | `/messages/:id/execution` | Get execution record linked to message |
| GET | `/messages/search` | Full-text / conditional message search |
| GET | `/chatrooms/:chatRoomId/message-archives` | Room history archive list |
| POST | `/messages/batch-delete` · DELETE `/messages/batch` | Batch delete messages |
| DELETE | `/messages/chatroom/:chatRoomId` | Clear room messages (also aborts execution, clears context) |

---

## LLM Providers

| Method | Path | Description |
|-----|------|------|
| GET | `/llm-providers` | List all LLM providers |
| GET | `/llm-providers/:id` | Get single provider |
| POST | `/llm-providers` | Create (`name`, `model`, `apiKey`, `apiProtocol`, `apiUrl?`) |
| PUT | `/llm-providers/:id` | Update |
| DELETE | `/llm-providers/:id` | Delete |
| PATCH | `/llm-providers/:id/status` | Activate/deactivate |
| PATCH | `/llm-providers/:id/default` | Set as default |
| POST | `/llm-providers/:id/test` | Test connection |
| POST | `/llm-providers/parse-config` | Parse text config (paste model config for one-click parsing) |

---

## Skills

### Agent-level Skills (path contains agentId)

| Method | Path | Description |
|-----|------|------|
| GET | `/agents/:agentId/skills` | List skills installed for agent |
| POST | `/agents/:agentId/skills/discover` | Discover all skills in a GitHub repo (pass `slug` as repo URL) |
| POST | `/agents/:agentId/skills/install-selected` | Install selected skills from discover results (pass `sessionId` + `indices`) |
| POST | `/agents/:agentId/skills/install` | Install single skill (pass `slug` as GitHub URL or skill name) |
| DELETE | `/agents/:agentId/skills/:slug` | Uninstall specified skill |

### Shared / Global Skills

| Method | Path | Description |
|-----|------|------|
| GET | `/skills/search` | Search ClawdHub Registry (`q=`, `limit=`) |
| GET | `/skills/shared` | List all skills in shared directory |
| POST | `/skills/create` | Create skill in shared directory (`skillName`, `description`, `content`) |
| POST | `/skills/symlink` | Symlink install skill from shared directory to specified agent (`skillName`, `targetAgentId`) |
| DELETE | `/skills/symlink` | Delete symlink |
| GET | `/skills/:slug` | Get single skill details |
| GET | `/skills/external` | List external skill directories (Claude Code style) |
| POST | `/skills/external/install` | Install skill from external directory (symlink mode) |

---

## Categories

| Method | Path | Description |
|-----|------|------|
| GET | `/categories` | List all categories |
| PUT | `/categories/sort-order` | Batch update category sort order |
| GET | `/categories/:id` | Get single category |
| POST | `/categories` | Create category |
| PUT | `/categories/:id` | Update category |
| DELETE | `/categories/:id` | Delete category |

---

## Cron Tasks

| Method | Path | Description |
|-----|------|------|
| GET | `/chatrooms/:chatRoomId/cron-tasks` | List cron tasks for chat room |
| POST | `/chatrooms/:chatRoomId/cron-tasks` | Create cron task |
| GET | `/cron-tasks/:taskId` | Get single cron task |
| PUT | `/cron-tasks/:taskId` | Update cron task |
| PATCH | `/cron-tasks/:taskId/enable` | Enable/disable (`enabled: boolean`) |
| DELETE | `/cron-tasks/:taskId` | Delete cron task |
| GET | `/cron-tasks/:taskId/executions` | Execution history (`limit?`) |
| POST | `/cron-tasks/:taskId/test` | Test execute immediately once |

---

## Token Usage

| Method | Path | Description |
|-----|------|------|
| GET | `/token-usage/by-provider` | Token usage grouped by model provider |
| GET | `/token-usage/daily` | Daily token trend (optionally filtered by provider) |
| GET | `/token-usage/by-agent` | Token usage grouped by agent |
| GET | `/token-usage/provider/:id/detail` | Single-provider details (totals, agent breakdown, recent executions) |

---

## Upload

| Method | Path | Description |
|-----|------|------|
| POST | `/upload/image` | Upload one image (multipart/form-data, returns `{url, width, height, ...}`) |
| POST | `/upload/images` | Batch upload images |
| POST | `/upload/audio` | Upload audio (for STT) |

---

## Workbench (Today Tasks)

| Method | Path | Description |
|-----|------|------|
| GET | `/workbench/tasks` | List today tasks |
| POST | `/workbench/tasks` | Create a today task |
| PUT | `/workbench/tasks/:id` | Update (incl. status transitions) |
| DELETE | `/workbench/tasks/:id` | Delete |
| POST | `/workbench/tasks/:id/dispatch` | Dispatch to a chatroom |
| POST | `/workbench/tasks/dispatch-batch` | Batch dispatch |
| POST | `/workbench/recommend-room` | Recommend a target chatroom |

## Coordinator Logs (Dispatch Log)

| Method | Path | Description |
|-----|------|------|
| GET | `/coordinator-logs` | All coordinator decision logs |
| GET | `/coordinator-logs/:chatRoomId` | Logs for a specific room |

## Template Packages (Group Templates)

| Method | Path | Description |
|-----|------|------|
| POST | `/template-packages/export` | Export a group-template ZIP (members, rules, dispatchRules, skill refs, etc.) |
| POST | `/template-packages/preview` | Upload a template ZIP and preview import impact |
| POST | `/template-packages/import` | Import a template ZIP, create a new room, and record import audit |

## Bridge (External-platform bots, `/api/bridge/*`)

| Method | Path | Description |
|-----|------|------|
| GET | `/api/bridge/webhook-url` | Get current service webhook base URL |
| GET | `/api/bridge/platforms` | Supported platforms |
| GET | `/api/bridge/playbooks/:platform` | Platform config wizard |
| GET / POST | `/api/bridge/bots` | List / create bots |
| GET / PATCH / DELETE | `/api/bridge/bots/:id` | Bot details / update / delete |
| POST | `/api/bridge/bots/:id/bind` `/bind-code` `/unbind` | Bind room / generate bind code / unbind |
| GET | `/api/bridge/events` | Bridge event log |
| GET / PUT | `/api/bridge/system-config` | Global bridge config |
| POST | `/api/bridge/message` | Unified inbound message entry for external platforms |
| POST | `/api/bridge/webhook/wecom/:botId` etc. | Per-platform webhook entry (public) |

## Speech / Internal Tools

| Method | Path | Description |
|-----|------|------|
| POST | `/speech/*` (see `speech.router.ts`) | TTS / STT / voice catalog |
| POST | `/internal/agent-tools/*` | Built-in tool endpoints (background command, image gen, system tools, agent-to-agent message) |
| POST | `/codex-router/:token/:providerId/v1/responses` | Codex chat↔responses protocol conversion (internal) |
| POST | `/codex-router/:token/:providerId/v1/chat/completions` | Codex responses↔chat protocol conversion (internal) |

---

## Common Conventions

- All successful response format: `{ success: true, data: ... }`
- Error response format: `{ success: false, error: "..." }`
- JWT token passed via `Authorization: Bearer <token>`
- **A global `authHook` (`onRequest`) enforces JWT on all non-public endpoints**; public endpoints include login/register/first-run status/some platform webhooks. Socket connections also validate JWT in `auth.token`
