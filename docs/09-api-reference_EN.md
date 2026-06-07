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

---

## ChatRooms

| Method | Path | Description |
|-----|------|------|
| GET | `/chatrooms` | List all chat rooms (includes lastMessage, members) |
| GET | `/chatrooms/:id` | Get single chat room details |
| POST | `/chatrooms` | Create chat room (`name`, `workDir?`, `rules?`, `ownerId?`) |
| PUT | `/chatrooms/:id` | Update chat room (`name`, `rules`, `workDir`, `defaultAgentId`, `agentTriggerMode`) |
| DELETE | `/chatrooms/:id` | Delete chat room |
| PATCH | `/chatrooms/:id/pin` | Pin |
| PATCH | `/chatrooms/:id/unpin` | Unpin |

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

---

## Messages

| Method | Path | Description |
|-----|------|------|
| GET | `/messages` | Message list (`chatRoomId?`, max 100) |
| GET | `/messages/:id` | Get single message |
| GET | `/messages/:id/execution` | Get execution record linked to message |
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
| GET | `/token-usage/summary` | Full token usage summary (`startDate?`, `endDate?`, `chatRoomId?`, `agentId?`) |
| GET | `/token-usage/timeline` | Usage trend grouped by day |
| GET | `/token-usage/providers/:providerId` | Usage for specified provider |

---

## Upload

| Method | Path | Description |
|-----|------|------|
| POST | `/upload/image` | Upload image (multipart/form-data, returns `{url, width, height, ...}`) |

---

## Common Conventions

- All successful response format: `{ success: true, data: ... }`
- Error response format: `{ success: false, error: "..." }`
- JWT token passed via `Authorization: Bearer <token>`
- Authentication requirements not listed for each endpoint (current version has most endpoints without mandatory auth, relies on Socket JWT auth)