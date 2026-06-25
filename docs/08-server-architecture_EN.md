# 08 · Server Architecture

English | [中文](08-server-architecture.md)

> Corresponds to `server/src/` · Last updated 2026-06-15

## 1. Directory Structure

```
server/src/
├── app.ts                  # Fastify app creation, plugin/gateway registration, startup orchestration
├── index.ts                # Dev entry (listens on PORT)
├── electron-entry.ts       # Electron utilityProcess entry
├── config/index.ts         # Central config (port/JWT/agent/collaboration budget/speech/bridge)
├── gateway/                # REST route layer (Fastify route handlers)
│   ├── agent.gateway.ts            # Agent CRUD, quick chat, local-session import, diary/memory
│   ├── app-setting.gateway.ts      # App-level KV settings
│   ├── auth.gateway.ts             # Register/login/profile
│   ├── bridge.gateway.ts           # External-platform bots (/api/bridge/*)
│   ├── category.gateway.ts
│   ├── chatroom.gateway.ts         # Room CRUD, members, fork/duplicate, archive, git/scripts, dispatchRules
│   ├── chatroom-command.gateway.ts # Group custom commands /commands
│   ├── codex-router.gateway.ts     # Codex chat-completions routing endpoint
│   ├── cron-task.gateway.ts
│   ├── internal-agent-tools.gateway.ts # Built-in tool HTTP endpoints (/internal/agent-tools/*)
│   ├── llm-provider.gateway.ts
│   ├── message.gateway.ts          # Message query, archive, search, batch delete
│   ├── setup.gateway.ts            # First-run onboarding status
│   ├── skill.gateway.ts
│   ├── speech.gateway.ts           # Speech (TTS/STT/voice catalog)
│   ├── template-package.gateway.ts # Template package export/import
│   ├── token-usage.gateway.ts
│   ├── workbench.gateway.ts        # Workbench today-tasks + dispatch log (/coordinator-logs)
│   └── index.ts                    # registerGateways(app, [...])
├── socket/index.ts         # Socket.io server (JWT auth + room events)
├── core/
│   ├── agent/              # Agent execution engine (core)
│   │   ├── agent-handler/          # Message listening, trigger decisions, enqueue, execute, collaboration dispatch
│   │   ├── dispatch-rules/         # Dispatch rules: schema / generation / execution plan
│   │   ├── codex-router/           # Codex responses↔chat protocol conversion
│   │   ├── tools/                  # Built-in LangChain tools
│   │   ├── executor.factory.ts     # Executor factory
│   │   ├── executor.interface.ts   # IAgentExecutor / AgentTriggerMode
│   │   ├── claude-sdk.executor.ts  # Claude Agent SDK executor
│   │   ├── codex-sdk.executor.ts   # Codex SDK executor
│   │   ├── claude-local-config.ts  # Reuse local Claude config
│   │   ├── codex-session-state.ts  # Codex local session state
│   │   ├── context-reset-command.ts# Context-reset command parsing
│   │   ├── coordinator-dispatch.ts # Group coordinator adjudication & dispatch
│   │   ├── internal-coordinator-agent.ts # Built-in Group Coordinator logic
│   │   ├── thinking-mode.ts        # Thinking mode (off/low/medium/high)
│   │   ├── agent-system-prompt.ts  # System prompt (handoff protocol / handoff reminder)
│   │   ├── agent-long-term-memory.ts / agent-memory-candidates.ts / agent-diary.ts # Long-term memory + diary promotion
│   │   ├── diary-scheduler.service.ts # Daily diary scheduler
│   │   ├── room-env-vars.ts        # Group env var injection
│   │   ├── work-dir.ts             # Work directory resolution
│   │   ├── image-generation*.ts    # Image generation service / config / vendor profiles
│   │   └── skill-instructions.ts   # Skill loading & injection
│   ├── cron/cron-scheduler.service.ts  # Cron scheduler
│   └── shell/             # shell command execution, background tasks, block detection, output stream
├── modules/                # Service layer (each dir has a service, some have a gateway)
│   ├── agent-diary/ agent-memory/ app-setting/ auth/ bridge/ category/
│   ├── checkpoint/ chatroom/ coordinator-log/ cron-task/ execution-record/
│   ├── llm-provider/ message/ prompt-optimize/ quick-chat-session/ recovery/
│   ├── skill/ speech/ task-queue/ template-package/ todo/ token-usage/
│   ├── upload/ user/ workbench/
├── scripts/                # Startup init / data migration scripts
│   ├── system-agent-definitions.ts  # System agent definitions
│   ├── init-group-assistant.ts      # Ensure the single "Group Assistant" exists, delete legacy system agents
│   └── migrate-*.ts                 # Avatar / voice etc. data migrations
└── lib/
    ├── prisma.ts            # Prisma singleton + WAL/busy_timeout init
    └── checkpointer.ts / libsql-client.ts  # LangGraph checkpointer
```

---

## 2. Startup Flow (`createApp`)

```
createApp()
  ├── Register CORS, static files (/uploads/), multipart (image 10MB / audio STT 25MB)
  ├── initDb()                       # SQLite WAL + busy_timeout
  ├── uploadService.init()           # Init upload dirs
  ├── app.addHook('onRequest', authHook)  # Global JWT auth hook (except public endpoints)
  ├── Create Socket.io (decorated onto app.io)
  ├── Health checks /health, /network-info
  ├── registerGateways(app, [...])   # Register all REST gateways
  ├── checkpointService.ensureTablesExist()
  ├── taskQueueService.markAsInterrupted() + markPendingAsInterrupted()  # Restart recovery
  ├── initAgents()                   # Init Agent handler (listen to receivedMessage)
  ├── clearAllExecutionState()       # Clear executing state
  ├── ensureGroupAssistantExists()   # Ensure the single Group Assistant, delete legacy 5 system agents
  ├── migrateAgentAvatars() / migrateChatRoomAvatars()
  ├── cronSchedulerService.start()   # Start Cron scheduler
  ├── diaryScheduler.start()         # Agent diary scheduler (daily 0:00, gated by a switch)
  ├── syncAllBridgeBotsRuntime()     # External-platform bot runtime
  ├── backgroundTaskManager.cleanupRunningTasks()
  ├── setupSocket(io)                # Socket.io events
  └── startLocalUserWatcher(io)      # Local user config change push
```

**Ports**:
- Web/dev mode: `PORT` (default `3001`)
- Electron embedded: fixed `11053`, mobile web entry `11054`

---

## 3. Agent Execution System

### 3.1 Executor types

| Executor class | Trigger | Notes |
|----------------|---------|-------|
| `ClaudeAgentSdkExecutor` | `agent.type='acp'` + `acpTool='claude'`, or `type='builtin'` | Claude Agent SDK, streaming thinking, supports `thinkingMode` (off/low/medium/high) |
| `CodexSdkExecutor` | `agent.type='acp'` + `acpTool='codex'` | OpenAI Codex SDK (incl. codexWireApi routing) |

`executor.factory.ts` `createExecutor(options)` dispatches by `agent.type`/`acpTool`; the local-agent path currently supports only Claude and Codex, with `builtin` falling back to the Claude executor.

### 3.2 Executor cache

Executor instances are cached by `chatRoomId_agentName` (`agent-handler/cache.ts`), keeping per "room-agent" session/memory state isolated. On clearing messages or changing `workDir`, clear the matching cache and destroy the instance.

### 3.3 Trigger decisions & Smart Collaboration (agent-handler)

`agent-handler/handler.ts` listens to the `receivedMessage` event and is the single entry of message flow. The mode is normalized by `trigger-mode.ts` to **Smart Collaboration (`coordinator`, merged from the old auto/coordinator)** or **Manual (`manual`)**.

Core path of Smart Collaboration (see [11-agent-trigger-system_EN.md](11-agent-trigger-system_EN.md)):

- **Fast path**: an agent's reply with exactly one valid `@` triggers the relay directly, zero coordination cost
- **5 coordinator intervention points**: user routing miss / `@` anomaly / parallel-batch join / stall fallback / circuit-breaker escalation — adjudicated by `coordinator-dispatch.ts` + `internal-coordinator-agent.ts`
- **Structured-handoff guardrails** (`structured-handoff.service.ts` / `structured-handoff-runtime.ts`): bound fan-out, depth, total cascade dispatches, and revisits by root message and lineage
- **Multi-agent dispatch**: the coordinator picks parallel or serial per `dispatchMode` — **parallel batch** (`parallel-batch-tracker.ts`, fork-join; `@`s inside a batch suspended to the join) or **serial chain** (`serial-chain-tracker.ts` + `task-lifecycle.ts`, only the head dispatched at a time, advanced by queue settlement events); user intervention takes over. Full flowcharts in [14-agent-dispatch-flowcharts_EN.md](14-agent-dispatch-flowcharts_EN.md)
- **Stall fallback** (`stall-watchdog.ts`): wakes the coordinator when the room is idle after an agent finishes
- **Dispatch rules** (`dispatch-rules/`): `ChatRoom.dispatchRules` (YAML) injected into the coordinator's system prompt to orchestrate "who's next"
- **Execution robustness**: coordinator LLM decision timeout/retry, business-agent "no-activity" retry (`no-activity-timeout.ts`)

Every coordinator decision is written to `CoordinatorLog` (`modules/coordinator-log/`).

### 3.4 Message → execution chain

```
Socket.io / Bridge / Cron produce a message
  → messageService.save() → io.emit('message')
  → messageEventEmitter.emit('receivedMessage', {message, chatRoomId})

handler.ts
  → normalizeTriggerMode(chatRoom.agentTriggerMode)  # coordinator | manual
  → parse triggerable @, decide fast path / batch / routing (see §3.3)
  → Manual mode: agent message @ doesn't trigger
  → enqueueAgentTask(chatRoomId, message, agent)
       ├── agentMemoryService.buildHistory()  # summary + recent + group rules + envVars
       ├── taskQueueService.enqueue()         # write TaskQueue
       └── processQueue(chatRoomId, agentId)

processor.ts
  → take pending task → getExecutor() → executor.execute()
  → streaming callbacks: emitStream / emitThinking / emitToolCall (50ms batched on socket side)
  → done: emitDone, write ExecutionRecord + Message (incl. model/token stats)
  → transition workbench task status when the room goes idle
```

### 3.5 Work directory priority

```
quick-chat / session dir (sessionDir)
  └─ room work dir (chatRoom.workDir)
        └─ agent work dir (agent.workDir)
              └─ default dir
```

`work-dir.ts` `resolveWorkDir()` implements the fallback. Note: group assistants no longer have a per-room custom work directory; `ChatRoomAgent.customWorkDir` is legacy and not used by new runtime behavior.

### 3.6 Long-term memory & diary (AgentRoomMemory)

- One `AgentRoomMemory` long-term summary per "room-agent"
- Compaction triggers when message count exceeds `AGENT_MEMORY_COMPACT_MESSAGES` (default 40), producing a summary ≤ `AGENT_MEMORY_SUMMARY_TARGET_TOKENS`
- Injection: before each execution, `buildHistory()` merges the summary + latest `AGENT_MEMORY_RECENT_MESSAGES`
- Diary promotion: a candidate must recur across `AGENT_MEMORY_PROMOTE_MIN_DAYS` distinct dates to be promoted; error/lesson items promote on first occurrence (`AGENT_MEMORY_LESSON_PROMOTE_MIN_DAYS`); unpromoted candidates older than `AGENT_MEMORY_CANDIDATE_TTL_DAYS` are dropped
- Compaction/diary run asynchronously, not blocking the current task

---

## 4. Socket.io Events

### 4.1 Server → client (partial)

| Event | Meaning |
|-------|---------|
| `message` | New message (human or AI) |
| `agent:typing` | Agent starts processing/queued |
| `agent:stream` / `agent:thinking` | Streaming body / thinking-chain segments (50ms batched) |
| `agent:tool_call` | Tool call event |
| `agent:done` | Agent finished (incl. executionRecordId, token stats) |
| `agent:status` | Global broadcast of agent status + queue counts |
| `agent:task-queue` / `agent:inactive-tasks` | Task queue snapshot / recoverable tasks |
| `agent:task-cancelled` / `agent:task-resumed` | Task cancelled / resumed |
| `agent:stopped` / `agent:stop-failed` | Stop result |
| `agent:cached-events` | Replay cached streaming events when re-entering a room |
| `chatroom:created/updated/list/joined/left` | Room changes / list |
| `chatroom:agent-added` / `chatroom:agents-updated` | Member changes |
| `workbench:task-updated` | Workbench task status update |
| `todo:list/created/updated` | Todos (if enabled) |
| `unread:update` | Unread count update |

### 4.2 Client → server

| Event | Meaning |
|-------|---------|
| `chatroom:join` / `chatroom:leave` / `chatroom:list` | Join/leave/list rooms |
| `chatroom:mark-read` | Mark read |
| `agent:status` | Query room agent status |
| `agent:stop` | Abort agent execution |
| `agent:task-queue` / `agent:task-cancel` / `agent:task-resume` | Queue query / cancel / resume |
| `agent:inactive-tasks` | Query recoverable tasks |
| `unread:request` | Fetch unread count |
| `todo:request` / `todo:complete` / `todo:dismiss` | Todo operations |

> Messages are mostly produced via REST/internal flow and broadcast by the server with `io.emit('message')`; client sockets mainly handle room subscriptions, status queries, and task control.

### 4.3 Authentication

On socket connect, pass JWT in `auth.token`; the server validates and attaches `user` to `socket.data.user`. The REST side is guarded by a global `authHook` (`onRequest`); public endpoints (login/register/first-run/some webhooks) are allowed through.

---

## 5. Cron Scheduling

`cron-scheduler.service.ts`:
- Loads all `enabled=true` `CronTask`s at startup
- Supports `cron` (expression), `interval` (fixed minutes), `once` (one-time)
- On fire, injects `payload` into the chatroom for the given `agentIds`; multiple agents split into multiple messages triggered one by one, behaving like the user sending each
- Results written to `CronTaskExecution`, retried per `maxRetries` on failure

---

## 6. Background Tasks (Shell)

`core/shell/`:
- `shell-command.ts`: runs shell commands, output to temp files
- `background-task-manager.ts`: manages long-running commands (`BackgroundTask` table), foreground/background switching, cleanup on restart
- `block-detector.ts`: detects no-output timeout (blocking) and notifies
- `task-output.ts`: streams output to the front-end

Built-in tools drive background commands via `/internal/agent-tools/background-command/*`.

---

## 7. Built-in Tools (`core/agent/tools/`)

Tools registered to agents:

| Tool file | Function |
|-----------|----------|
| `agent-creator.tools.ts` | Create/update agents |
| `skill-manager.tools.ts` | Install/uninstall/list skills |
| `skills-helper.tools.ts` | Fetch skill content |
| `chatroom-helper.tools.ts` | Room info query + `generate_dispatch_rules` (generate dispatch rules) |
| `cron-task-helper.tools.ts` | Create/manage Cron tasks |
| `external-platform-helper.tools.ts` | External-platform onboarding helper |
| `chat-history-search.tools.ts` | Search room history |
| `execution-context.tools.ts` | Read execution context |
| `system-assistant.tools.ts` / `system-tool.ts` | Group Assistant system-tool aggregation & invocation |

> The `web_fetch` tool in older docs no longer exists.

---

## 8. System Agents

Since 2026-06, system agents are consolidated from "several separate @agents" into:

| Agent | ID constant | Visibility | Role |
|-------|-------------|------------|------|
| **Group Assistant** | `GROUP_ASSISTANT_ID` | Visible (the only one) | All-in-one: create agents, manage skills, Cron, room info, external-platform onboarding, generate dispatch rules |
| **Group Coordinator** | `GROUP_COORDINATOR_ID` | Hidden | The Smart Collaboration coordinator; routes only, doesn't answer or execute tasks |

- At startup `ensureGroupAssistantExists()` ensures the Group Assistant exists and deletes the legacy 5 separate system agents (Agent Manager / Skill Manager / Cron / Chatroom Helper / External Platform, IDs in `LEGACY_SYSTEM_AGENT_IDS`)
- System agents are "virtual members": they don't join `ChatRoomAgent` and can be `@`-triggered in any room
- The Group Coordinator is not user-editable/addable

---

## 9. Config Parameters (`server/src/config/index.ts`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3001` | HTTP listen port (Electron fixed at 11053) |
| `SERVER_HOST` | `0.0.0.0` | Listen address |
| `DATABASE_URL` | `file:./dev.db` | SQLite path (Electron points to userData) |
| `JWT_SECRET` | (random, persisted) | If unset, a `.jwt-secret` (0600) is generated in the data dir; never falls back to a hardcoded key |
| `AGENT_HISTORY_THRESHOLD` | `20` | History summary-compaction threshold |
| `AGENT_MEMORY_RECENT_MESSAGES` | `10` | Recent messages injected |
| `AGENT_MEMORY_COMPACT_MESSAGES` | `40` | Messages that trigger memory compaction |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | `2000` | Summary target tokens |
| `AGENT_MEMORY_PROMOTE_MIN_DAYS` | `3` | Distinct dates needed to promote a candidate |
| `AGENT_MEMORY_LESSON_PROMOTE_MIN_DAYS` | `1` | Promotion threshold for error/lesson items |
| `AGENT_MEMORY_CANDIDATE_TTL_DAYS` | `14` | TTL for unpromoted candidates |
| `AGENT_STALL_WATCHDOG_DELAY_MS` | `180000` | Stall-detection delay |
| `AGENT_STALL_WATCHDOG_MAX_CONSECUTIVE` | `5` | Consecutive rescue cap |
| `AGENT_COORDINATOR_LLM_TIMEOUT_MS` | `120000` | Coordinator LLM decision timeout for the first attempt; retry attempts use 2x timeout |
| `AGENT_COORDINATOR_LLM_RETRY_COUNT` | `1` | Coordinator LLM retry count; after the primary model fails, configured fallback models are tried in order |
| `AGENT_EXECUTION_NO_ACTIVITY_TIMEOUT_MS` | `90000` | Agent no-activity retry timeout (0 disables) |
| `AGENT_HANDOFF_FANOUT_MAX` | `20` | Structured-handoff fan-out cap |
| `AGENT_HANDOFF_DEPTH_MAX` | `100` | Structured-handoff lineage depth cap |
| `AGENT_HANDOFF_BUDGET_MAX` | `20` | Total cascade dispatch budget per root message |
| `AGENT_HANDOFF_REVISIT_MAX` | `1` | Per-agent revisit cap within one lineage |
| `AGENT_HANDOFF_AUDIT_ENABLED` | `true` | Run one silent same-assistant handoff audit when the first turn did not register `mention_agents` |
| `AGENT_HANDOFF_AUDIT_TIMEOUT_MS` | `30000` | Silent handoff-audit timeout in milliseconds; watchdog remains the fallback |
| `BRIDGE_ENCRYPTION_KEY` | `''` | Bridge credential encryption key |
| `BRIDGE_REQUIRE_SIGNATURE` | `false` | Whether to enforce webhook signature |
| `EDGE_TTS_BINARY` / `EDGE_TTS_DEFAULT_VOICE` | `edge-tts` / `zh-CN-XiaoxiaoNeural` | Speech synthesis |
| `TEAMAGENTX_SHARED_SKILLS_DIR` | `~/.teamagentx/skills` | Template-package shared skills dir |
| `TOOLS_DIR` | `''` | Tools dir override |

LLM credentials live mainly in the local `LlmProvider` table; ACP executors map providers to tool-specific env vars (Claude: `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`; Codex: `OPENAI_API_KEY`/`OPENAI_MODEL`). `start.sh` can load `OPENCLAW_GATEWAY_TOKEN` from `~/.openclaw/openclaw.json`.

---

## 10. Bridge External Platform Integration

`server/src/modules/bridge/` bridges external IM platform messages into chatrooms; subsequent flow matches normal user messages.

### 10.1 Supported platforms

| Platform | Connection |
|----------|------------|
| **Telegram** | Polling (long polling) |
| **Feishu** | WebSocket long connection |
| **DingTalk** | Stream long connection |
| **WeCom** | Webhook callback |

### 10.2 How it works

1. Create a bot binding in room settings (`BridgeBot`, fill per-platform credentials; multiple instances per platform, deduped by `credentialHash`)
2. On startup, establish long connections or register webhooks per platform (`syncAllBridgeBotsRuntime`)
3. Inbound messages are adapted by `bridge.service.ts` into chatroom messages and posted to the target room, flowing like normal user messages
4. Agent replies are pushed back to the external platform; events recorded in `BridgeEvent`

### 10.3 Key modules

| File | Responsibility |
|------|----------------|
| `bridge-platform-registry.ts` | Per-platform config field definitions |
| `bridge.service.ts` | Message routing core |
| `platform-inbound-adapters.ts` / `platform-senders.ts` | Platform ↔ internal format adapt/send |
| `bridge-commands.ts` | Bridge built-in commands (help / clear / @agent) |
| `bridge-platform-playbooks.ts` | Per-platform config wizard copy |

REST endpoints are under `/api/bridge/*` (bot CRUD, bind code, webhook entry, etc.).

---

## 11. Speech

`server/src/modules/speech/` (router `speech.router.ts`, gateway `speech.gateway.ts`) provides TTS/STT:

- Set `LlmProvider.modelType = audio`, specify `sttModel` (speech recognition) and `audioUsage` (`tts | stt | both`)
- Supports remote TTS APIs and browser-local speech (`browser-local`)
- `buildSpeechVoiceCatalog()` aggregates all available voices with platform metadata (`VOICE_PROVIDER_METADATA`)
