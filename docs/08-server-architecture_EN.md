# 08 · Server Architecture

English | [中文](08-server-architecture.md)

> Version: v0.1.0 · Corresponds to `server/src/`

## 1. Directory Structure

```
server/src/
├── app.ts                  # Fastify app creation, plugin registration, startup
├── index.ts                # Development entry (direct listening)
├── electron-entry.ts       # Electron utilityProcess entry
├── config/index.ts         # Centralized config (port/JWT/Agent params)
├── gateway/                # REST route layer (Fastify route handlers)
│   ├── agent.gateway.ts
│   ├── auth.gateway.ts
│   ├── bridge.gateway.ts          # External platform bots (Telegram/Feishu/DingTalk/WeChat)
│   ├── category.gateway.ts
│   ├── chatroom.gateway.ts
│   ├── cron-task.gateway.ts
│   ├── internal-agent-tools.gateway.ts  # Built-in assistant tool endpoints
│   ├── llm-provider.gateway.ts
│   ├── message.gateway.ts
│   ├── setup.gateway.ts           # Initialization/config endpoints
│   ├── skill.gateway.ts
│   ├── speech.gateway.ts          # Speech (TTS/STT)
│   ├── template-package.gateway.ts # Template packages
│   └── token-usage.gateway.ts
├── socket/index.ts         # Socket.io server (auth + event handling)
├── core/
│   ├── agent/              # Agent execution engine (core)
│   │   ├── agent-handler/  # Message listening, task enqueueing, execution scheduling
│   │   ├── executor.factory.ts   # Executor factory
│   │   ├── executor.interface.ts # IAgentExecutor interface
│   │   ├── claude-sdk.executor.ts # Claude Agent SDK executor
│   │   ├── codex-sdk.executor.ts  # Codex SDK executor
│   │   ├── thinking-mode.ts      # Thinking mode (off/low/medium/high)
│   │   ├── internal-coordinator-agent.ts # Built-in group scheduling assistant logic
│   │   ├── image-generation.service.ts   # Image generation service
│   │   ├── image-generation-config.ts    # Image generation config builder
│   │   ├── image-generation-provider-profiles.ts # Provider configs (APIMart GPT-Image etc.)
│   │   ├── skill-instructions.ts # Skill loading and injection
│   │   ├── agent-long-term-memory.ts # Long-term memory summarization
│   │   ├── work-dir.ts           # Working directory resolution
│   │   ├── agent-log.ts          # Execution logs
│   │   └── tools/                # Built-in LangChain tools
│   ├── cron/
│   │   └── cron-scheduler.service.ts  # Cron scheduler
│   └── shell/
│       ├── shell-command.ts      # Shell command execution
│       ├── background-task-manager.ts # Background task management
│       ├── block-detector.ts     # Block detection
│       └── task-output.ts        # Output stream management
├── modules/                # Business service layer
│   ├── auth/               # JWT login/register
│   ├── agent-memory/       # AgentRoomMemory CRUD + history building
│   ├── chatroom/           # ChatRoom CRUD
│   ├── checkpoint/         # LangChain checkpointer (builtin context)
│   ├── cron-task/          # CronTask CRUD
│   ├── execution-record/   # ExecutionRecord CRUD
│   ├── llm-provider/       # LlmProvider CRUD
│   ├── message/            # Message CRUD
│   ├── prompt-optimize/    # Prompt optimization (streaming)
│   ├── quick-chat-session/ # QuickChatSession lifecycle
│   ├── recovery/           # Startup task recovery
│   ├── skill/              # Skill installation/CRUD
│   ├── task-queue/         # TaskQueue enqueue/dequeue
│   ├── token-usage/        # Token usage statistics
│   ├── upload/             # Image upload
│   └── user/               # User CRUD
├── scripts/                # Startup initialization scripts
│   ├── system-agent-definitions.ts  # System assistant definitions
│   ├── system-agent-sync.ts         # Sync system assistants to DB
│   └── init-*.ts                    # Ensure system assistants exist
└── lib/
    ├── prisma.ts            # Prisma singleton
    ├── checkpointer.ts      # libsql checkpointer
    └── libsql-client.ts     # libsql connection
```

---

## 2. Startup Flow

```
createApp()
  ├── Register CORS, static files (/uploads/)
  ├── Initialize upload directory
  ├── Create Socket.io server
  ├── Register all gateways (REST routes)
  ├── setupSocket(io)           # Socket.io events
  ├── migrateAgentAvatars()     # Data migration scripts
  ├── migrateChatRoomAvatars()
  ├── ensureAgentCreatorExists()  # Ensure system assistants exist
  ├── ensureSkillsHelperExists()
  ├── ensureCronTaskHelperExists()
  ├── ensureChatroomHelperExists()
  ├── taskQueueService.recoverInterruptedTasks()  # Recover interrupted tasks
  ├── clearAllExecutionState()  # Clear executing states
  ├── initAgents(io)            # Initialize Agent handlers
  └── cronSchedulerService.start()  # Start Cron scheduler
```

**Ports**:
- Web/development mode: `PORT` (default `3001`)
- Electron embedded: fixed `11053`, mobile web entry `11054`

---

## 3. Agent Execution System

### 3.1 Executor Types

| Executor Class | Trigger Condition | Features |
|----------------|-------------------|----------|
| `ClaudeAgentSdkExecutor` | `agent.type = 'acp'` + `acpTool = 'claude'` | Claude Agent SDK, streaming thinking, supports `thinkingMode` (off/low/medium/high) |
| `CodexSdkExecutor` | `agent.type = 'acp'` + `acpTool = 'codex'` | OpenAI Codex SDK |
| `ClaudeAgentSdkExecutor` | `agent.type = 'builtin'` | Backward compatible with legacy built-in assistants |

### 3.2 Executor Factory

`createExecutor(options)` in `executor.factory.ts` dispatches based on `agent.type` and `acpTool`. Current local Agent paths only support Claude and Codex:

```
agent.type === 'acp'
  acpTool === 'claude'  → ClaudeAgentSdkExecutor
  acpTool === 'codex'   → CodexSdkExecutor
agent.type === 'builtin' → ClaudeAgentSdkExecutor (backward compatible with legacy built-in assistants)
```

### 3.3 Executor Cache

Executor instances are cached with `chatRoomId_agentName` as key (`executorCache: Map<string, IAgentExecutor>`), maintaining independent session state for each "room-agent" combination.

Call `clearExecutorCache(agentName, chatRoomId)` and destroy instances when clearing messages or switching workDir.

### 3.4 Message → Execution Pipeline

```
Socket.io receives user message
  → messageService.save()
  → socket.emit('message', msg)
  → messageEventEmitter.emit('receivedMessage', {message, chatRoomId})

handler.ts listens for receivedMessage
  → parseMentions(content) extracts @assistant names
  → Determine: quick chat room / normal room default assistant / @ trigger
  → Manual mode (agentTriggerMode=manual): assistant message @ doesn't trigger
  → enqueueAgentTask(chatRoomId, message, agent)
       ├── agentMemoryService.buildHistory()   # Assemble summary + recent messages
       ├── taskQueueService.enqueue()          # Write to TaskQueue table
       ├── Update lastInjectedMessageId (incremental injection position)
       └── processQueue(chatRoomId, agentId)   # Trigger queue processing

processor.ts processes queue
  → Dequeue pending task
  → getExecutor() gets/creates executor
  → executor.execute(message, history, attachments)
  → Streaming callbacks: emitStream / emitThinking / emitToolCall
  → Complete: emitDone, save ExecutionRecord
```

### 3.5 Working Directory Priority

```
Quick chat/session directory (sessionDir)
  └─ Room working directory (chatRoom.workDir)
        └─ Assistant working directory (agent.workDir)
              └─ Default directory (~/teamagentx-sessions/)
```

`resolveWorkDir()` in `work-dir.ts` implements the above fallback logic.

### 3.6 Long-term Memory (AgentRoomMemory)

- Each "room-agent" combination has one `AgentRoomMemory` record
- Compression trigger: message count exceeds `AGENT_MEMORY_COMPACT_MESSAGES` (default 40)
- Compression target: generate summary with ≤ `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` tokens
- Injection strategy: before each execution, `agentMemoryService.buildHistory()` combines summary + recent `AGENT_MEMORY_RECENT_MESSAGES` messages into history array
- Compression runs asynchronously in background, doesn't block current task

---

## 4. Socket.io Events

### 4.1 Server → Client

| Event Name | Payload | Description |
|------------|---------|-------------|
| `message` | `Message` | New message (human or AI) |
| `agent:typing` | `{messageId, agentId, agentName, status: 'pending'|'executing'}` | Assistant starts processing/queueing |
| `agent:stream` | `{messageId, agentId, agentName, content}` | Streaming content chunk |
| `agent:thinking` | `{messageId, agentId, agentName, thinking}` | Thinking chain chunk |
| `agent:tool_call` | `{messageId, agentId, agentName, toolCall}` | Tool call event |
| `agent:done` | `{agentId, agentName, triggerMessageId, executionRecordId?, messageIds?, duration?, totalTokens?, cacheReadTokens?}` | Assistant completed |
| `agent:status` | `{chatRoomId, statuses: Record<agentId, AgentStatus>, queueCounts?}` | Global broadcast of assistant status (broadcast to all sockets) |
| `agent:task-queue` | `{chatRoomId, agentId, tasks[]}` | Task queue snapshot |
| `agent:task-cancelled` | `{agentId, agentName, taskId}` | Task cancelled |
| `agent:task-resumed` | `{agentId, agentName, taskId}` | Task resumed |
| `unread:update` | `{chatRoomId, count}` | Unread count update (user room) |

### 4.2 Client → Server

| Event Name | Payload | Description |
|------------|---------|-------------|
| `join` | `{chatRoomId}` | Join chat room |
| `leave` | `{chatRoomId}` | Leave chat room |
| `message` | `{id, content, chatRoomId, userId?, agentId?, isHuman, attachments?}` | Send message |
| `stop_agent` | `{chatRoomId, agentId}` | Abort assistant execution |
| `resume_task` | `{chatRoomId, agentId, taskId}` | Resume interrupted task |
| `mark_read` | `{chatRoomId, userId}` | Mark as read |
| `get_agent_statuses` | `{chatRoomId}` | Query room assistant status |

### 4.3 Authentication

When establishing Socket connection, pass JWT token in `auth.token`, server `auth middleware` validates and attaches user info to `socket.data.user`.

---

## 5. Cron Scheduling

`cron-scheduler.service.ts`:
- On service startup, loads all `CronTask` with `enabled=true`
- Supports three types: `cron` (cron expression), `interval` (fixed minutes), `once` (one-time)
- On trigger, injects `payload` to specified `agentIds` in the room; multiple assistants are split into separate messages triggered individually, behaving like users sending messages separately
- Execution results written to `CronTaskExecution`, automatic retry on failure (`maxRetries`)

---

## 6. Background Tasks (Shell)

- `shell-command.ts`: Execute shell commands, output written to temp files
- `background-task-manager.ts`: Manage long-running commands (`BackgroundTask` table), supports foreground/background switching
- `block-detector.ts`: Detect if command has no output timeout (blocked), trigger notification
- `task-output.ts`: Stream read output files, push to frontend

---

## 7. Built-in Tools (LangChain builtin executor)

`core/agent/tools/` registers the following built-in tools:

| Tool | File | Function |
|------|------|----------|
| `skill_manager` | `skill-manager.tools.ts` | Install/uninstall/list Skills |
| `skills_helper` | `skills-helper.tools.ts` | Get Skill content |
| `chatroom_helper` | `chatroom-helper.tools.ts` | Query chatroom info |
| `agent_creator` | `agent-creator.tools.ts` | Create/update assistants |
| `cron_task_helper` | `cron-task-helper.tools.ts` | Create/manage Cron tasks |
| `web_fetch` | `web-fetch.tools.ts` | HTTP requests |

---

## 8. System Agents

`scripts/system-agent-definitions.ts` defines 4 system-level assistants (`agentLevel: 'system'`), automatically synced to database on startup by corresponding `init-*.ts` scripts:

| Assistant | ID Constant | Function |
|-----------|-------------|----------|
| Skill Management | `SKILLS_HELPER_AGENT_ID` | Install/manage Claude Code skill via conversation |
| Assistant Creator | `AGENT_CREATOR_AGENT_ID` | Create new assistants via conversation |
| Cron Task Management | `CRON_TASK_HELPER_AGENT_ID` | Create Cron tasks via conversation |
| Chatroom Helper | `CHATROOM_HELPER_AGENT_ID` | Chatroom info query assistant |

System assistants are "virtual members" — they don't join `ChatRoomAgent`, can be @ triggered in any chatroom.

---

## 9. Configuration Parameters

`server/src/config/index.ts`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP listening port |
| `SERVER_HOST` | `0.0.0.0` | Listen address |
| `DATABASE_URL` | `file:./dev.db` | SQLite path |
| `JWT_SECRET` | `teamagentx-default-secret-key` | JWT secret |
| `JWT_EXPIRES_IN` | `7d` | JWT expiration |
| `AGENT_HISTORY_THRESHOLD` | `20` | History message threshold (used for legacy logic) |
| `AGENT_MEMORY_RECENT_MESSAGES` | `10` | Number of recent messages to inject |
| `AGENT_MEMORY_COMPACT_MESSAGES` | `40` | Message count to trigger memory compression |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | `2000` | Summary target token count |

---

## 10. Bridge External Platform Integration

`server/src/modules/bridge/` provides ability to bridge external IM platform messages to chatrooms.

### 10.1 Supported Platforms

| Platform | Connection Method |
|----------|-------------------|
| **Telegram** | Polling (long polling) |
| **Feishu** | WebSocket persistent connection |
| **DingTalk** | Stream persistent connection |
| **WeCom** | Webhook callback |

### 10.2 How It Works

1. Create "bot binding" (`BridgeBot`) in chatroom settings, select platform and fill in Token/AppSecret credentials
2. On service startup, establish persistent connection or register Webhook per platform type
3. When external message arrives, `bridge.service.ts` adapts it to chatroom message and sends to target room, subsequent flow is identical to regular user messages
4. Assistant replies are pushed back to external platform

### 10.3 Key Modules

| File | Responsibility |
|------|----------------|
| `bridge-platform-registry.ts` | Register config field definitions for each platform |
| `bridge.service.ts` | Message routing core |
| `platform-inbound-adapters.ts` | Each platform message → internal format adapter |
| `platform-senders.ts` | Internal format → each platform message sending |
| `bridge-commands.ts` | Bridge room built-in commands (help / clear / @assistant) |
| `bridge-platform-playbooks.ts` | Configuration guide text for each platform |

---

## 11. Speech

`server/src/modules/speech/` provides TTS/STT capabilities, `speech.gateway.ts` exposes endpoints.

- LlmProvider can configure `modelType = audio`, specify `sttModel` (speech recognition dedicated model) and `audioUsage` (`tts | stt | both`)
- Supports remote TTS API and browser local speech (`browser-local` mode)
- Speech Catalog: `buildSpeechVoiceCatalog()` aggregates all available voices, includes platform metadata (`VOICE_PROVIDER_METADATA`)