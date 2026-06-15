# 02 · Feature List (TeamAgentX v0.1.x)

English | [中文](02-features.md)

> Based on the actual product (asar unpacked + UI strings) and `server/src` source review.
> Marking convention: ✅ Implemented; 🟡 Implemented but needs refinement; 🔵 Concept exists but not fully landed.
> First version: 2026-05-09 · Last updated: 2026-06-15 (added Smart Collaboration mode, dispatch rules, workbench, dispatch log, etc.).

## Overview

Platform divided into **12 feature domains**:

1. [LLM Provider Management](#1-llm-provider-management)
2. [Agent Management](#2-agent-management)
3. [Skill Management](#3-skill-management)
4. [ChatRoom Management](#4-chatroom-management)
5. [Messages and Conversations](#5-messages-and-conversations)
6. [Task Management](#6-task-management)
7. [Scheduled Tasks (Cron)](#7-scheduled-tasks-cron)
8. [Work Directory and Files](#8-work-directory-and-files)
9. [System Capabilities](#9-system-capabilities)
10. [Bridge External Platform Integration](#10-bridge-external-platform-integration)
11. [Speech](#11-speech)
12. [Collaboration Orchestration & Observability (New)](#12-collaboration-orchestration--observability-new)

---

## 1. LLM Provider Management

### 1.1 Basic CRUD

| Capability | Status | Description |
|------------|--------|-------------|
| Add/Edit/Delete Provider | ✅ | `POST/PUT/DELETE /llm-providers` |
| Enable/Disable | ✅ | `is_active` field, `PATCH /llm-providers/:id/status` |
| Set as Default | ✅ | `is_default` field, `PATCH /llm-providers/:id/default` |
| Test Connectivity | ✅ | `POST /llm-providers/:id/test` |

### 1.2 Protocol and Vendor Support

| Protocol | Status | Description |
|----------|--------|-------------|
| Anthropic Protocol | ✅ | Native support for Claude series |
| OpenAI Compatible Protocol | ✅ | Covers OpenAI, DeepSeek, Kimi, Alibaba Bailian etc. |
| Custom Endpoint | ✅ | `api_url` + `api_key` free configuration |
| Local Agent | ✅ | "Use local Agent config" — reuse local Claude Code/Codex config |

Additional fields:
- `contextLength` — model context length (tokens), default 1M, used for history-compaction decisions (added 2026-06, configurable in Settings)
- `codexWireApi` — the wire API Codex uses under the OpenAI protocol (`responses` / `chat`)
- `supportsThinking` — whether thinking mode is supported (auto-detected)
- When `modelType = audio`, configure `sttModel` and `audioUsage` (tts / stt / both), see §11

### 1.3 Smart Configuration (Highlight)

- **Paste text one-click parse config** (`POST /llm-providers/parse-config`)
  - UI hint: "Input your API configuration description, AI will auto-parse and fill the form. E.g.: My Claude API key is sk-ant-xxx"
  - Suitable scenario: User copies API info from docs/chat history, platform auto extracts name/url/key/model

### 1.4 Invalidity Protection

- "Incompatible LLM providers cleared" — auto cleanup references when model protocol mismatches
- "Invalid default agent" — prompt when default agent's dependent model becomes invalid
- "No compatible providers, please configure model or login local Agent first" — guided empty state

---

## 2. Agent Management

### 2.1 Basic CRUD

| Capability | Status | Description |
|------------|--------|-------------|
| Create/Edit/Delete Agent | ✅ | `POST/PUT/DELETE /agents` |
| Agent List | ✅ | `GET /agents`, `/agents/active`, `/agents/grouped` |
| Agent Sorting | ✅ | `PUT /agents/sort-order` |
| Activate/Deactivate Agent | ✅ | `PATCH /agents/:id/status` |
| Avatar + Color | ✅ | Custom avatar, avatarColor |

### 2.2 Agent Levels (Important Concept)

| `agent_level` | Meaning | Behavior |
|---------------|---------|----------|
| `system` | System preset agents (the unified "**Group Assistant**", plus the hidden "Group Coordinator") | Not allowed to modify, not allowed to drag other agents into, auto appears in all group member selectors |
| `normal` | User-created agents | Fully editable |

> Since 2026-06, the old 5 separate system agents (Agent Manager / Skill Manager / Cron / Chatroom Helper / External Platform) have been merged into a **single visible "Group Assistant"** that carries all the system tools; a separate **hidden "Group Coordinator"** handles Smart Collaboration adjudication (not directly user-manageable). See [08-server-architecture_EN.md §8](08-server-architecture_EN.md).

UI feedback:
- "System agent not allowed to modify"
- "System agent not allowed to drag other agents into"
- "System category not allowed to add agents"

### 2.3 Agent Categories

- Users can create custom categories to organize agents
- System categories (system folder) read-only
- "Create category" / "Modify category name" / "Delete category"
- "Please enter category name" / "Please enter category description (optional)"
- "Select category (optional)"

### 2.4 Agent Configuration Trio

| Configuration | Description |
|---------------|-------------|
| **Model** | Reference LLM Provider id (optional default) |
| **System Prompt** | "Please enter agent's prompt to define behavior and role" |
| **Skills** | Agent can load multiple skills |
| **Thinking Mode** | `off \| low \| medium \| high`, controls Claude series extended thinking budget; default `high` |

### 2.5 Prompt Optimization (Highlight)

- `POST /agents/optimize-prompt` — synchronous optimization
- `POST /agents/optimize-prompt-stream` — **Streaming optimization**, watch AI rewrite process in real-time
- UI: "Edit prompt", "Prompt optimized"

### 2.6 Quick Chat

- `POST /agents/quick-chat` — Skip group creation, direct 1v1 quick chat
- `GET /agents/:id/quick-chat-rooms?userId=...` — List all quick chats for this agent
- Quick chat is essentially a "special chatroom": `isQuickChat: true`, "This is a quick chat room, messages directly sent to agent, no @ mention needed"
- Quick chat supports custom workDir: "When empty, each conversation creates independent session directory"

**Import/switch local CLI sessions (added 2026-06)**: a quick chat can bind a local Claude Code / Codex history session and continue it inside TeamAgentX.

| Capability | Endpoint |
|------------|----------|
| List local Claude sessions | `GET /chatrooms/:id/quick-chat-session/claude-local-sessions` |
| Bind/switch Claude session | `POST /chatrooms/:id/quick-chat-session/claude-local-session` |
| List local Codex sessions | `GET /chatrooms/:id/quick-chat-session/codex-local-sessions` |
| Bind/switch Codex session | `POST /chatrooms/:id/quick-chat-session/codex-local-session` |

Binding info is stored in `QuickChatSession.claudeLocalSession*` / `codexLocalSession*` (session id, title, modified time).

### 2.7 Agent Default Directory

- Agent-level `workDir` default value, can be overridden when referenced by group
- "Agent default directory"

---

## 3. Skill Management

### 3.1 Three Installation Methods

| Method | Description | Endpoint |
|--------|-------------|----------|
| **Full Copy** | Files land locally, independent management, unaffected by external updates | `/skills/install` |
| **Symbolic Link (symlink)** | Link points to external directory, external updates auto-sync, saves disk | `/skills/symlink` |
| **Import External** | One-time scan external directory batch import | `/skills/import-external`, `/skills/external` |

UI hints:
- "Fully copy skill files locally, independent management, unaffected by external updates."
- "Create symbolic link pointing to external skill directory, external skill updates auto-sync, saves disk space."

### 3.2 Skill Marketplace (Prototype)

| Capability | Status | Endpoint |
|------------|--------|----------|
| Discover/Browse | ✅ | `GET /skills/discover` |
| Search | ✅ | `GET /skills/search` |
| Batch Install to Agent | ✅ | `POST /agents/:id/skills/install-selected` |
| Shared Skills | ✅ | `/skills/shared` |
| Claude Code skill format compatible | ✅ | symlink directly mounts `~/.claude/skills/` |

### 3.3 Create Skill via Chat (Highlight)

- The unified "**Group Assistant**" — generate skills through group chat dialogue (the old standalone "Skill Manager" capability has been merged into the Group Assistant)
- "E.g.: Help me find a coding skill, data analysis skill, image processing skill..."
- Endpoint: `POST /skills/create`

### 3.4 Agent ↔ Skill Relationship

- `GET /agents/:id/skills` — List skills loaded on agent
- `POST /agents/:id/skills/discover` — Recommend relevant skills for this agent
- `POST /agents/:id/skills/install` — Install single skill
- `POST /agents/:id/skills/install-selected` — Batch install
- One skill can be shared by multiple agents (via `/skills/shared`)

---

## 4. ChatRoom Management

### 4.1 Basic CRUD

| Capability | Status | Description |
|------------|--------|-------------|
| Create/Edit/Delete Group | ✅ | `POST/PUT/DELETE /chatrooms` |
| Pin/Unpin | ✅ | `PATCH /chatrooms/:id/pin` `unpin` |
| Mark Read | ✅ | `PATCH /chatrooms/:id/mark-read` |
| Global Unread Count | ✅ | `GET /chatrooms/unread-counts` |
| Group Description | ✅ | "Please enter group description" |

### 4.2 Group Member Management

| Role | Meaning | Behavior |
|------|---------|----------|
| `OWNER` | Group owner, must be human user | Owner's message can trigger default agent; cannot be removed |
| `MEMBER` | Regular member, can be agent or human | Can be removed |

Member view categorized display: **Owners / System Agents / Normal Agents** three groups.

### 4.3 Agent Personalization (Group-level Override)

Each `chatRoomAgent` relationship can independently configure:

| Field | Meaning |
|-------|---------|
| `injectGroupHistory` | Whether to inject group history messages when joining (**key to context management**) |
| Agent settings in group | `/chatrooms/:id/agents/:id/settings` |
| Clear agent's context in group | `POST /chatrooms/:id/agents/:id/clear-context` |
| View agent's context in group | `GET /chatrooms/:id/agents/:id/context` |
| View agent's execution records in group | `GET /chatrooms/:id/agents/:id/executions` |
| Tasks assigned to this agent in group | `GET /chatrooms/:id/agents/:id/tasks` |

UI hints:
- "Enable for agent to view group chat history" / "Group history injection enabled" / "Group history injection disabled"
- "Enable to get group chat context"
- "Conversation context cleared"

### 4.4 Trigger Mode (Important Design — merged into two in 2026-06)

The former "Coordinator" and "Auto" modes are merged into a single **Smart Collaboration** mode. Only two are exposed:

| Mode | Behavior | Suitable Scenario |
|------|----------|-------------------|
| **Smart Collaboration (default)** | An agent writing exactly one valid @ takes the fast path and relays directly (zero coordination cost); the built-in "Group Coordinator" is only invoked at 5 points (user routing miss / @ anomaly / batch join / stall fallback / circuit breaker); user multi-@ goes to the coordinator to split into single/parallel/serial | Vast majority of multi-role collaboration rooms |
| **Manual Mode** | @ in agent message doesn't trigger other agents, only as mention | User manual orchestration, agents don't cross-stage |

- Storage layer still stores `coordinator` (Smart Collaboration) / `manual`; the legacy value `auto` is an alias equal to Smart Collaboration
- For the "agent single-`@` direct relay", a built-in two-breaker (20 hops / 3 consecutive round-trips) + stall detection prevent fan-out storms and loops; coordinator multi-agent dispatch supports parallel/serial (see [14](14-agent-dispatch-flowcharts_EN.md))
- Every coordinator decision is written to `CoordinatorLog`, viewable in the "Dispatch Log"

Detailed trigger rules in [11-agent-trigger-system_EN.md](11-agent-trigger-system_EN.md); merge design in [13-unified-collaboration-mode-design_EN.md](13-unified-collaboration-mode-design_EN.md).

### 4.5 Default Receiving Agent

- "When group owner sends message without @ agent, this agent is automatically triggered."
- Existing solution for problem C (@ trigger ambiguity) — user's casual message without @, handled by default agent fallback

### 4.6 Group Rules + Dispatch Rules (split in 2026-06)

A room now distinguishes two kinds of rules, stored in different fields:

| Rule | Field | Purpose |
|------|-------|---------|
| **Group Rules** | `ChatRoom.rules` | Role behavior constraints / notes, injected into **all** agents' context |
| **Dispatch Rules (workflow)** | `ChatRoom.dispatchRules` (YAML) | Multi-agent orchestration flow, injected into the **Group Coordinator** to adjudicate "who's next" |

- Group rules: single add/edit, sent as a whole on save ("Group rules saved")
- Dispatch rules: generated by the Group Assistant's `generate_dispatch_rules` tool (optimize with instructions, auto-generate from the roster otherwise), zod-validated on save; the front-end has a dedicated dialog with a read-only flowchart + YAML source editing + multi-workflow tabs
- Business agents get a "task flow / handoff (next)" hint injected into their query per step; nothing is injected when there are no rules

### 4.7 Group Environment Variables (envVars, added 2026-06)

- `ChatRoom.envVars` (JSON array `[{ key, value, description }]`) is injected into the environment when this room's agents run shell commands
- Good for project-level API base, paths, tokens reused by commands

### 4.8 Group History Archive + Fork

- Group messages can be archived into `ChatRoomMessageArchive`, keeping title / start-end time / count
- **Fork a new chatroom** from an archived segment to keep going (`POST /chatrooms/:id/fork`), leaving the original room clean
- Duplicating a room (`POST /chatrooms/:id/duplicate`) carries members, rules, `dispatchRules`, etc.

### 4.9 Group Git / Scripts Integration (desktop)

- View git status, create branches, run restricted git commands on the group work directory (`/chatrooms/:id/git-status`, `/git-branch`, `/git-command`)
- Read and run `package.json` scripts (`/chatrooms/:id/package-scripts`, `/package-scripts/run`)

### 4.10 Group Custom Commands (/commands, added 2026-06)

- Users define `/commands` per room (`ChatRoomCommand`: name + content + sortOrder); typing `/` in the input pops a picker, and selecting fills the content into the input box
- Endpoints: `GET/POST /chatrooms/:chatRoomId/commands`, `PUT/DELETE /commands/:commandId`

### 4.11 Quick Chat Sub-session

- `POST /chatrooms/:id/quick-chat-session` — Attach a quick session under group
- "Session records created via quick chat"
- "Create new temporary session"

---

## 5. Messages and Conversations

### 5.1 Basic Messages

| Capability | Status | Description |
|------------|--------|-------------|
| Send/Fetch Messages | ✅ | `/messages`, `/messages/chatroom/:id` |
| Reply with Reference | ✅ | `replyMessageId` field |
| Image Messages | ✅ | jpeg/png/gif/webp, 10MB limit |
| @ Agent Trigger | ✅ | "Message content, can use @agent-name to trigger specific agent execution" |

### 5.2 Streaming Output (Highlight)

Real-time observable:
- `streamingContent` — Streaming text output
- `streamingThinking` — **Streaming thinking chain** (reasoning content real-time display)
- `toolCalls` — Tool call process

UI: "Tool call:", "Execute action:", "Processing..."

### 5.3 Execution Traceability (Important)

| Capability | Endpoint / UI |
|------------|---------------|
| View message execution details | `GET /messages/:id/execution` — "Click to view execution process" |
| View agent task queue | "View task queue" / "View current executing task" |
| View recent executions | "View recent executions" / "Execution duration" |
| View context | "View context" — Actual prompt received by agent |
| Clear context | "Clear context" — Reset agent's conversation memory in group |

UI prompt phrases:
- "Executing..." / "Processing..." / "Parsing..." / "Saving..." / "Creating..." / "Updating..." / "Deleting..." / "Clearing..." / "Installing..."
- "Execution content (sent message)"
- "Failed/Cancelled" / "No execution records" / "Execution details unavailable"

### 5.4 Message Sound

- "Play sound when receiving agent reply" — Setting can be disabled
- "Message sound"

### 5.5 Screenshot Export (Highlight)

- "Export chat history as image, can download or copy to clipboard"
- Screenshot contains watermark: "Generated by TeamAgentX"
- "Chat history screenshot · {group name}"
- Limitation: "No messages to screenshot"

---

## 6. Task Management

### 6.1 Task Board (`/tasks/board`)

Tasks displayed in 6 status columns:

| Status | UI Text |
|--------|---------|
| Pending | "No pending tasks" |
| Waiting Execution | "No waiting execution tasks" |
| Executing | "No executing tasks" |
| Completed | "No completed tasks" |
| Failed/Cancelled | "No failed or cancelled tasks" |
| Pending Recovery | "Tasks pending recovery" |

Features:
- "Task queue executes in time order, currently executing first pending task"
- "Click task card to jump to corresponding message" — Task ↔ Message bidirectional association
- "All columns hidden" — Columns can show/hide ("Show/Hide columns")

### 6.2 Task-Message Binding

- Tasks generated by agents during message execution
- Can locate original message by clicking task ("Jump to corresponding message")

### 6.3 Agent Tasks in Group

- `GET /chatrooms/:id/agents/:id/tasks` — Single agent's tasks in specific group

---

## 7. Scheduled Tasks (Cron)

### 7.1 Group-level Cron (Unique Feature)

| Capability | Status | Endpoint |
|------------|--------|----------|
| Create scheduled task in group | ✅ | `POST /chatrooms/:id/cron-tasks` |
| List all scheduled tasks in group | ✅ | `GET /chatrooms/:id/cron-tasks` |
| Enable/Disable | ✅ | `PATCH /cron-tasks/:id/enable` |
| Immediate Test Run | ✅ | `POST /cron-tasks/:id/test` |
| Execution History | ✅ | `GET /cron-tasks/:id/executions` |

### 7.2 Schedule Types

| Type | Description |
|------|-------------|
| **Presets** | "Every day 9:00", "Every day 18:00", "Every Monday 9:00", "Every Friday 18:00", "Every 1st of month 9:00" |
| **Interval Minutes** | "Interval minutes" |
| **Custom Cron Expression** | "Custom cron expression" / "Select preset or input custom expression" |
| **One-time Execution** | Only trigger once |

### 7.3 Execution Content Configuration

- "Execution content (sent message)" — Send message to group at scheduled time
- "Select agent to trigger" — Multiple agents split into multiple messages sent sequentially, each message triggers one agent
- "Max retry count"
- "Trigger user" / "Trigger message" / "Execution time" / "Execution duration"

### 7.4 Typical Use Cases

- Every day 9am @ Researcher crawl competitor updates once
- Every Friday 6pm @ Coordinator summarize this week's changes
- Every hour @ Monitor check service status

---

## 8. Work Directory and Files

### 8.1 Three-layer Directory Strategy

| Layer | Field | Description |
|-------|-------|-------------|
| **Group-level Shared** | `chatRoom.workDir` | "All agents in group share this runtime directory" |
| **Agent Default** | `agent.workDir` | "Agent default directory", can be overridden when referenced by group |
| **Quick Chat Independent** | `quickChat.workDir` | "When empty, each conversation creates independent session directory" |

UI hints:
- "Leave empty to use default group directory" / "Leave empty to use default directory strategy" / "Leave empty to restore to default generated directory"
- "Input custom work directory"

### 8.2 Work Directory Operations

| Capability | UI |
|------------|-----|
| Copy Path | "Copy group work directory path" / "Work directory path copied" |
| Open in File Manager | "Open group work directory" / "Open in new window" / "Select open method" |
| File Preview | "Select file to view content" |

Limitations:
- "Only supported in Electron client for opening directory" — Web version limited
- "Cannot preview this file"
- "Failed to open directory"

---

## 9. System Capabilities

### 9.1 User Authentication

- Username + password login
- Password at least 6 characters
- Registration flow
- "Can view session records after login"

### 9.2 Server Connection

- Client can connect to remote or local server
- "Server address" / "LAN address" / "Default is LAN address, can modify to other address"
- "Select LAN address" — Auto discovery
- "Service closed, attempting reconnect..." — Auto reconnect

### 9.3 Mobile Connection

- QR code scan login: "Use TeamAgentX App on phone to scan QR code for auto login and connection"
- Implemented in `qrcode-generator` dependency
- → Implies companion iOS/Android App exists

### 9.4 Personal Center

- Avatar / Username / Password modification
- "Personal info updated"
- Message sound settings

### 9.5 Desktop Exclusive

- Electron client: Can read/write local files, open local directories
- Web version functionality limited

### 9.6 Internationalization & User Preferred Language

- Web i18n resources now center on `zh-CN` / `en-US` (`apps/web/src/i18n/locales/`)
- User-level `preferredLanguage` (`zh-CN` / `en-US`, default `zh-CN`): switches not only the UI language but also the **language of Agent system prompts** (handoff protocol, coordinator prompts, etc. are generated per the user's preference)

---

## Feature Completeness Radar Chart

```
                              Coverage
Model Management        ██████████  100%
Agent Management        █████████░   90%
Skill Management        █████████░   90%
Chatroom Basics         ████████░░   80%
Trigger Mode Control    ████████░░   80%
Message Streaming       █████████░   90%
Execution Observability ████████░░   80%
Task Board              ███████░░░   70%
Group-level Cron        █████████░   90%
Work Directory Mgmt     ████████░░   80%
Group Rules Mechanism   ██████░░░░   60% (still soft constraint)
Role Boundary Enforce   ████░░░░░░   40% (still prompt)
Task Card Schema        ████░░░░░░   40% (board exists, schema not unified)
State Machine Enforce   ███░░░░░░░   30%
File Concurrency Ctrl   ██░░░░░░░░   20%
Objective Acceptance    █░░░░░░░░░   10%
Quality Metrics         █░░░░░░░░░   10%
Cost Dashboard          ░░░░░░░░░░    0%
```

Detailed gap analysis in [04-problems-and-solutions_EN.md](04-problems-and-solutions_EN.md).

---

## Comparison with Original Description

User's original description:
> Model management can add various models, skill management install skills, agent management configure agents (agents can configure model, prompt and install skill skills), message management can pull multiple agents to start group chat (group can configure group rules, rules guide each agent, group triggers agent work via @)

This document found **actual product is much richer than described** — here are capabilities **not mentioned in user description but already implemented**:

1. **Paste text one-click parse model config**
2. **Streaming prompt optimization**
3. **Quick Chat — 1v1 without formal group**
4. **Agent levels (system / normal)**
5. **Agent categories (user-created + system)**
6. **Skill symlink mode (Claude Code compatible)**
7. **Create skills via chat (unified "Group Assistant" system agent)**
8. **Group-level Cron scheduled tasks**
9. **Smart Collaboration / Manual trigger modes**
10. **Per-agent per-group independent context / history injection toggle**
11. **Three-layer workDir strategy**
12. **Streaming thinking chain visualization**
13. **Execution records and context inspection**
14. **Workbench today-tasks and dispatch log**
14. **Task board (6 status columns)**
15. **Screenshot export**
16. **Mobile QR code connection**
17. **Local Agent reuse (connect Claude Code)**

Added after 2026-06 (some Chapter 04 problems now hardened):

18. **Smart Collaboration mode** (merged auto/coordinator) + two-breaker against fan-out/loops (addresses A1/A2/H)
19. **Dispatch rules (workflow YAML) + flowchart visualization**
20. **Parallel-batch / serial-chain dispatch** (coordinator picks per dispatchMode)
21. **Workbench "today tasks" with dispatch**
22. **Dispatch log (CoordinatorLog) observability**
23. **Group custom commands `/commands`**
24. **Group environment variables (envVars)**
25. **Group history archive + fork; duplicate room**
26. **Quick chat import/switch local Claude/Codex sessions**
27. **User preferred language drives Agent prompt language**
28. **Agent diary / long-term memory daily promotion**

→ **Conclusion**: Product has built quite complete scaffolding, major problem points aren't "missing features", but "mechanism hardness" — i.e., Chapter [04](04-problems-and-solutions_EN.md) focus on "boundaries, state, loop prevention, objective acceptance"; loop/fan-out prevention is now landed via the Smart Collaboration budget.

---

## 10. Bridge External Platform Integration

Bridge external IM platform messages to TeamAgentX group chat, message flow identical to regular user messages.

| Capability | Status | Description |
|------------|--------|-------------|
| Create bot binding | ✅ | Add BridgeBot in group settings, select platform fill credentials |
| Telegram | ✅ | Long polling method |
| Feishu | ✅ | WebSocket long connection |
| DingTalk | ✅ | Stream long connection |
| WeCom | ✅ | Webhook callback |
| Built-in group commands | ✅ | `help`, `clear` (clear context), `@agent-name` (manual trigger) |
| Config wizard | ✅ | Each platform has guided text (Playbook) helping fill Token/Secret |

Architecture details in [08-server-architecture_EN.md §10](08-server-architecture_EN.md).

---

## 11. Speech

| Capability | Status | Description |
|------------|--------|-------------|
| TTS Text-to-Speech | ✅ | Supports remote TTS API |
| STT Speech Recognition | ✅ | Can configure independent STT model (`sttModel`) |
| Browser Local Speech | ✅ | `browser-local` mode, zero latency |
| Voice Catalog | ✅ | `buildSpeechVoiceCatalog()` aggregates all available voices |
| Provider Config | ✅ | LlmProvider set `modelType = audio`, `audioUsage = tts\|stt\|both` |

---

## 12. Collaboration Orchestration & Observability (New)

A set of capabilities added since 2026-06, centered on "how multi-agent collaboration is orchestrated and made visible".

### 12.1 Smart Collaboration mode

See §4.4 and [11-agent-trigger-system_EN.md](11-agent-trigger-system_EN.md): fast-path relay + 5-point coordinator fallback + two breakers + parallel-batch/serial-chain dispatch. Full flowcharts in [14-agent-dispatch-flowcharts_EN.md](14-agent-dispatch-flowcharts_EN.md).

### 12.2 Dispatch rules / workflow visualization

| Capability | Status | Description |
|------------|--------|-------------|
| YAML dispatch rules | ✅ | `ChatRoom.dispatchRules`, injected into the Group Coordinator |
| Auto-generate / optimize | ✅ | Group Assistant `generate_dispatch_rules` tool |
| Structural validation | ✅ | zod-validated on save, invalid rejected |
| Flowchart visualization | ✅ | Read-only flowchart + YAML source editing + multi-workflow tabs |

### 12.3 Workbench "Today Tasks"

| Capability | Status | Endpoint |
|------------|--------|----------|
| Create/edit/delete today tasks | ✅ | `GET/POST /workbench/tasks`, `PUT/DELETE /workbench/tasks/:id` |
| Dispatch to a chatroom | ✅ | `POST /workbench/tasks/:id/dispatch`, `/dispatch-batch` |
| Recommend target room | ✅ | `POST /workbench/recommend-room` |
| Status transitions | ✅ | `draft → dispatched → in_progress → waiting_review → needs_input → completed / blocked`, manually switchable |

`WorkbenchTask` is created by the user in the workbench; once dispatched to an existing room, the Group Coordinator organizes execution; status updates are pushed via socket `workbench:task-updated`.

### 12.4 Dispatch log (Coordinator Log)

- Every Group Coordinator decision (dispatch / no_dispatch / ask_owner / cannot_dispatch) is written to `CoordinatorLog`
- View via the front-end "Dispatch Log" panel/modal: decision type, target agents, forward-verbatim flag, source (user/agent), reason
- Endpoints: `GET /coordinator-logs`, `GET /coordinator-logs/:chatRoomId`

### 12.5 Agent diary / long-term memory promotion

- `AgentRoomMemory` long-term summary + a candidate-memory "diary" mechanism: info is promoted to long-term only if it recurs across multiple distinct dates (`AGENT_MEMORY_PROMOTE_MIN_DAYS`); error/lesson items are promoted on first occurrence
- Agent diaries are generated daily (`GET /agents/:agentId/diary`, `/diary/generate`) by the diary scheduler; gated by a global switch

### 12.6 Template package export / import

- A room's config (members, rules, `dispatchRules`, cron, etc.) can be exported as a `TemplatePackage` and imported elsewhere (`TemplateImportRecord` keeps an import audit trail)

### 12.7 Execution robustness

- Coordinator LLM decision timeout & retry (`AGENT_COORDINATOR_LLM_TIMEOUT_MS` / `_RETRY_COUNT`)
- Business-agent "no-activity" retry: if there's no output/stream/thinking/tool event for a while after start, the attempt is treated as stuck and retried (`AGENT_EXECUTION_NO_ACTIVITY_TIMEOUT_MS`)
- Task recovery on restart: executing/pending tasks are marked interrupted and can be resumed manually

See [08-server-architecture_EN.md](08-server-architecture_EN.md) and [09-api-reference_EN.md](09-api-reference_EN.md).
