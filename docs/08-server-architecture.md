# 08 · 服务端架构

[English](08-server-architecture_EN.md) | 中文

> 对应 `server/src/` · 最近更新 2026-06-15

## 1. 目录结构

```
server/src/
├── app.ts                  # Fastify 应用创建、插件/网关注册、启动编排
├── index.ts                # 开发入口（直接监听 PORT）
├── electron-entry.ts       # Electron utilityProcess 入口
├── config/index.ts         # 集中配置（端口/JWT/Agent/协作预算/语音/Bridge）
├── gateway/                # REST 路由层（Fastify route handlers）
│   ├── agent.gateway.ts            # 助手 CRUD、快速对话、本地会话导入、日记/记忆
│   ├── app-setting.gateway.ts      # 应用级 KV 设置
│   ├── auth.gateway.ts             # 注册/登录/资料
│   ├── bridge.gateway.ts           # 外部平台机器人（/api/bridge/*）
│   ├── category.gateway.ts
│   ├── chatroom.gateway.ts         # 群 CRUD、成员、Fork/复制、归档、git/脚本、dispatchRules
│   ├── chatroom-command.gateway.ts # 群聊自定义指令 /commands
│   ├── codex-router.gateway.ts     # Codex chat-completions 路由转换端点
│   ├── cron-task.gateway.ts
│   ├── internal-agent-tools.gateway.ts # 内置助手工具 HTTP 端点（/internal/agent-tools/*）
│   ├── llm-provider.gateway.ts
│   ├── message.gateway.ts          # 消息查询、归档、搜索、批量删除
│   ├── setup.gateway.ts            # 首次引导状态
│   ├── skill.gateway.ts
│   ├── speech.gateway.ts           # 语音（TTS/STT/音色目录）
│   ├── template-package.gateway.ts # 模板包导出/导入
│   ├── token-usage.gateway.ts
│   ├── workbench.gateway.ts        # 工作台今日任务 + 调度日志（/coordinator-logs）
│   └── index.ts                    # registerGateways(app, [...])
├── socket/index.ts         # Socket.io 服务端（JWT 认证 + 房间事件）
├── core/
│   ├── agent/              # Agent 执行引擎（核心）
│   │   ├── agent-handler/          # 消息监听、触发判定、入队、执行、协作调度
│   │   ├── dispatch-rules/         # 群调度规则：schema / 生成 / 执行计划
│   │   ├── codex-router/           # Codex responses↔chat 协议转换
│   │   ├── tools/                  # 内置 LangChain 工具
│   │   ├── executor.factory.ts     # 执行器工厂
│   │   ├── executor.interface.ts   # IAgentExecutor / AgentTriggerMode
│   │   ├── claude-sdk.executor.ts  # Claude Agent SDK 执行器
│   │   ├── codex-sdk.executor.ts   # Codex SDK 执行器
│   │   ├── claude-local-config.ts  # 复用本机 Claude 配置
│   │   ├── codex-session-state.ts  # Codex 本地会话状态
│   │   ├── context-reset-command.ts# 上下文重置指令解析
│   │   ├── coordinator-dispatch.ts # 群调度助手裁决与派发
│   │   ├── internal-coordinator-agent.ts # 内置群调度助手（协调器）逻辑
│   │   ├── thinking-mode.ts        # 思考模式（off/low/medium/high）
│   │   ├── agent-system-prompt.ts  # 系统提示词（交接协议 / handoff reminder）
│   │   ├── agent-long-term-memory.ts / agent-memory-candidates.ts / agent-diary.ts # 长期记忆 + 日记沉淀
│   │   ├── diary-scheduler.service.ts # 日记每日调度
│   │   ├── room-env-vars.ts        # 群聊环境变量注入
│   │   ├── work-dir.ts             # 工作目录解析
│   │   ├── image-generation*.ts    # 图片生成服务 / 配置 / 厂商档案
│   │   └── skill-instructions.ts   # Skill 加载与注入
│   ├── cron/cron-scheduler.service.ts  # Cron 调度器
│   └── shell/             # shell 命令执行、后台任务、阻塞检测、输出流
├── modules/                # 业务服务层（每个目录含 service，部分含 gateway）
│   ├── agent-diary/ agent-memory/ app-setting/ auth/ bridge/ category/
│   ├── checkpoint/ chatroom/ coordinator-log/ cron-task/ execution-record/
│   ├── llm-provider/ message/ prompt-optimize/ quick-chat-session/ recovery/
│   ├── skill/ speech/ task-queue/ template-package/ todo/ token-usage/
│   ├── upload/ user/ workbench/
├── scripts/                # 启动时初始化 / 数据迁移脚本
│   ├── system-agent-definitions.ts  # 系统助手定义
│   ├── init-group-assistant.ts      # 确保唯一「群助手」存在，删除旧版系统助手
│   └── migrate-*.ts                 # 头像/音色等数据迁移
└── lib/
    ├── prisma.ts            # Prisma 单例 + WAL/busy_timeout 初始化
    └── checkpointer.ts / libsql-client.ts  # LangGraph checkpointer
```

---

## 2. 启动流程（`createApp`）

```
createApp()
  ├── 注册 CORS、静态文件（/uploads/）、multipart（图片 10MB / 音频 STT 25MB）
  ├── initDb()                       # SQLite WAL + busy_timeout
  ├── uploadService.init()           # 初始化上传目录
  ├── app.addHook('onRequest', authHook)  # 全局 JWT 认证钩子（公开端点除外）
  ├── 创建 Socket.io（装饰到 app.io）
  ├── 健康检查 /health、/network-info
  ├── registerGateways(app, [...])   # 注册所有 REST 网关
  ├── checkpointService.ensureTablesExist()
  ├── taskQueueService.markAsInterrupted() + markPendingAsInterrupted()  # 重启恢复
  ├── initAgents()                   # 初始化 Agent handler（监听 receivedMessage）
  ├── clearAllExecutionState()       # 清理 executing 状态
  ├── ensureGroupAssistantExists()   # 确保唯一群助手，删除旧版 5 个系统助手
  ├── migrateAgentAvatars() / migrateChatRoomAvatars()
  ├── cronSchedulerService.start()   # 启动 Cron 调度器
  ├── diaryScheduler.start()         # 助手日记调度（每日 0 点，受全局开关）
  ├── syncAllBridgeBotsRuntime()     # 外部平台机器人运行时
  ├── backgroundTaskManager.cleanupRunningTasks()
  ├── setupSocket(io)                # Socket.io 事件
  └── startLocalUserWatcher(io)      # 本地用户配置变更推送
```

**端口**：
- Web/开发模式：`PORT`（默认 `3001`）
- Electron 嵌入：固定 `11053`，移动 Web 入口 `11054`

---

## 3. Agent 执行系统

### 3.1 执行器类型

| 执行器类 | 触发条件 | 特点 |
|---------|---------|------|
| `ClaudeAgentSdkExecutor` | `agent.type='acp'` + `acpTool='claude'`，或 `type='builtin'` | Claude Agent SDK，流式 thinking，支持 `thinkingMode`（off/low/medium/high）|
| `CodexSdkExecutor` | `agent.type='acp'` + `acpTool='codex'` | OpenAI Codex SDK（含 codexWireApi 路由转换）|

`executor.factory.ts` 的 `createExecutor(options)` 按 `agent.type`/`acpTool` 分发；本地 Agent 路径目前只支持 Claude 和 Codex，`builtin` 回退到 Claude 执行器。

### 3.2 执行器缓存

执行器实例按 `chatRoomId_agentName` 为 key 缓存（`agent-handler/cache.ts`），保持每个「群-助手」组合的独立会话/记忆状态。清空消息或切换 `workDir` 时需清除对应缓存并销毁实例。

### 3.3 触发判定与智能协作（agent-handler）

`agent-handler/handler.ts` 监听 `receivedMessage` 事件，是消息流转的统一入口。模式由 `trigger-mode.ts` 归一为 **智能协作（`coordinator`，合并自原 auto/coordinator）** 或 **手动（`manual`）**。

智能协作的核心链路（详见 [11-agent-trigger-system.md](11-agent-trigger-system.md)）：

- **快路径**：助手回复中恰好一个合法 `@` 直接触发接力，零协调成本
- **协调器 5 个介入点**：用户路由落空 / `@` 异常 / 并行批次汇合 / 卡住兜底 / 熔断升级 —— 由 `coordinator-dispatch.ts` + `internal-coordinator-agent.ts` 裁决
- **协作预算**（`collaboration-budget.ts`）：仅约束「助手单 `@` 直连接力」快路径的跳数 / 连续环路两重熔断，计数窗口为「两次人类发言之间」
- **多助手派发**：协调器按 `dispatchMode` 选择并行或串行——**并行批次**（`parallel-batch-tracker.ts`，fork-join，批次内 `@` 挂起到汇合点统一裁决）或**串行链**（`serial-chain-tracker.ts` + `task-lifecycle.ts`，每次只派队首，由队列结算事件推进下一步）；用户介入即接管。全场景流程图见 [14-agent-dispatch-flowcharts.md](14-agent-dispatch-flowcharts.md)
- **卡住兜底**（`stall-watchdog.ts`）：助手发完消息后房间长时间无活动时唤醒协调器
- **群调度规则**（`dispatch-rules/`）：`ChatRoom.dispatchRules`（YAML）注入协调器系统提示，编排「下一棒交给谁」
- **执行健壮性**：协调器 LLM 决策超时/重试、普通助手「无活动」重试（`no-activity-timeout.ts`）

每次协调器决策写入 `CoordinatorLog`（`modules/coordinator-log/`）。

### 3.4 消息 → 执行链路

```
Socket.io / Bridge / Cron 产生消息
  → messageService.save() → io.emit('message')
  → messageEventEmitter.emit('receivedMessage', {message, chatRoomId})

handler.ts
  → normalizeTriggerMode(chatRoom.agentTriggerMode)  # coordinator | manual
  → 解析可触发 @、判定快路径/批次/路由（见 §3.3）
  → 手动模式：助手消息的 @ 不触发
  → enqueueAgentTask(chatRoomId, message, agent)
       ├── agentMemoryService.buildHistory()  # 摘要 + 最近消息 + 群规则 + envVars
       ├── taskQueueService.enqueue()         # 写入 TaskQueue
       └── processQueue(chatRoomId, agentId)

processor.ts
  → 取 pending 任务 → getExecutor() → executor.execute()
  → 流式回调：emitStream / emitThinking / emitToolCall（socket 端 50ms 批量合并）
  → 完成：emitDone，写 ExecutionRecord + Message（含 model/token 统计）
  → 群内空闲时按需流转工作台任务状态
```

### 3.5 工作目录优先级

```
快速对话/会话目录（sessionDir）
  └─ 群工作目录（chatRoom.workDir）
        └─ 助手工作目录（agent.workDir）
              └─ 默认目录
```

`work-dir.ts` 的 `resolveWorkDir()` 实现回退逻辑。注意：群助手不再有「群内自定义工作目录」，`ChatRoomAgent.customWorkDir` 为遗留字段，新运行时行为不使用。

### 3.6 长期记忆与日记（AgentRoomMemory）

- 每个「群-助手」组合一条 `AgentRoomMemory` 长期摘要
- 压缩触发：消息数超 `AGENT_MEMORY_COMPACT_MESSAGES`（默认 40），生成 ≤ `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` 的摘要
- 注入：每次执行前 `buildHistory()` 合并摘要 + 最近 `AGENT_MEMORY_RECENT_MESSAGES` 条
- 日记沉淀：候选信息需在 `AGENT_MEMORY_PROMOTE_MIN_DAYS` 个不同日期复现才晋升长期记忆；错误/教训类 1 次即沉淀（`AGENT_MEMORY_LESSON_PROMOTE_MIN_DAYS`）；未晋升候选超 `AGENT_MEMORY_CANDIDATE_TTL_DAYS` 天丢弃
- 压缩/日记在后台异步执行，不阻塞当前任务

---

## 4. Socket.io 事件

### 4.1 服务端 → 客户端（部分）

| 事件名 | 说明 |
|-------|------|
| `message` | 新消息（人类或 AI） |
| `agent:typing` | 助手开始处理/排队 |
| `agent:stream` / `agent:thinking` | 流式正文 / 思考链片段（50ms 批量） |
| `agent:tool_call` | 工具调用事件 |
| `agent:done` | 助手完成（含 executionRecordId、token 统计） |
| `agent:status` | 全局广播助手状态 + 队列数 |
| `agent:task-queue` / `agent:inactive-tasks` | 任务队列快照 / 可恢复任务 |
| `agent:task-cancelled` / `agent:task-resumed` | 任务取消 / 恢复 |
| `agent:stopped` / `agent:stop-failed` | 停止结果 |
| `agent:cached-events` | 重新进入房间时回放缓存的流式事件 |
| `chatroom:created/updated/list/joined/left` | 群聊变更/列表 |
| `chatroom:agent-added` / `chatroom:agents-updated` | 群成员变更 |
| `workbench:task-updated` | 工作台任务状态更新 |
| `todo:list/created/updated` | 待办（如启用） |
| `unread:update` | 未读数更新 |

### 4.2 客户端 → 服务端

| 事件名 | 说明 |
|-------|------|
| `chatroom:join` / `chatroom:leave` / `chatroom:list` | 加入/离开/拉取群聊 |
| `chatroom:mark-read` | 标记已读 |
| `agent:status` | 查询群聊助手状态 |
| `agent:stop` | 中止助手执行 |
| `agent:task-queue` / `agent:task-cancel` / `agent:task-resume` | 队列查询 / 取消 / 恢复 |
| `agent:inactive-tasks` | 查询可恢复任务 |
| `unread:request` | 拉取未读数 |
| `todo:request` / `todo:complete` / `todo:dismiss` | 待办操作 |

> 消息发送主要通过 REST/内部流程产生后由服务端 `io.emit('message')` 广播；客户端 socket 主要处理房间订阅、状态查询与任务控制。

### 4.3 认证

Socket 连接时在 `auth.token` 传 JWT，服务端验证后将 user 挂到 `socket.data.user`。REST 侧由全局 `authHook`（`onRequest`）校验，公开端点（登录/注册/首次引导/部分 webhook）放行。

---

## 5. Cron 调度

`cron-scheduler.service.ts`：
- 启动时加载所有 `enabled=true` 的 `CronTask`
- 支持 `cron`（表达式）、`interval`（固定分钟）、`once`（一次性）
- 到期时将 `payload` 注入指定 `agentIds` 的群聊；多个助手拆成多条消息逐个触发，行为等同用户分别发消息
- 结果写入 `CronTaskExecution`，失败按 `maxRetries` 重试

---

## 6. 后台任务（Shell）

`core/shell/`：
- `shell-command.ts`：执行 shell 命令，输出写临时文件
- `background-task-manager.ts`：管理长时命令（`BackgroundTask` 表），前台/后台切换，重启清理
- `block-detector.ts`：检测命令超时无输出（阻塞）触发通知
- `task-output.ts`：流式读取输出推送前端

内置工具通过 `/internal/agent-tools/background-command/*` 端点驱动后台命令。

---

## 7. 内置工具（`core/agent/tools/`）

注册给助手的内置工具：

| 工具文件 | 功能 |
|---------|------|
| `agent-creator.tools.ts` | 创建/更新助手 |
| `skill-manager.tools.ts` | 安装/卸载/列出 Skill |
| `skills-helper.tools.ts` | 获取 Skill 内容 |
| `chatroom-helper.tools.ts` | 群聊信息查询 + `generate_dispatch_rules`（生成群调度规则） |
| `cron-task-helper.tools.ts` | 创建/管理 Cron 任务 |
| `external-platform-helper.tools.ts` | 外部平台接入辅助 |
| `chat-history-search.tools.ts` | 检索群历史消息 |
| `execution-context.tools.ts` | 读取执行上下文 |
| `system-assistant.tools.ts` / `system-tool.ts` | 群助手系统级工具聚合与调用 |

> 旧文档中的 `web_fetch` 工具已不存在。

---

## 8. 系统助手（System Agents）

2026-06 起，系统助手由「多个独立 @助手」收敛为：

| 助手 | ID 常量 | 可见性 | 职能 |
|-----|--------|-------|------|
| **群助手** | `GROUP_ASSISTANT_ID` | 可见（唯一） | 一身兼任：创建助手、管理技能、Cron、群聊信息、外部平台接入、生成群调度规则 |
| **群调度助手** | `GROUP_COORDINATOR_ID` | 隐藏 | 智能协作模式的协调器，只做路由裁决，不回答问题、不执行任务 |

- 启动时 `ensureGroupAssistantExists()` 确保群助手存在，并删除旧版 5 个独立系统助手（助手管理 / 技能管理 / 定时任务 / 群聊管理 / 外部平台接入，其 ID 见 `LEGACY_SYSTEM_AGENT_IDS`）
- 系统助手是「虚拟成员」，不加入 `ChatRoomAgent`，可在任何群被 @ 触发
- 群调度助手不对用户开放编辑/添加

---

## 9. 配置参数（`server/src/config/index.ts`）

| 变量 | 默认值 | 说明 |
|-----|-------|------|
| `PORT` | `3001` | HTTP 监听端口（Electron 固定 11053） |
| `SERVER_HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_URL` | `file:./dev.db` | SQLite 路径（Electron 指向 userData） |
| `JWT_SECRET` | （随机生成持久化） | 未设置时在数据目录生成 `.jwt-secret`（0600），绝不回退硬编码密钥 |
| `AGENT_HISTORY_THRESHOLD` | `20` | 历史摘要压缩阈值 |
| `AGENT_MEMORY_RECENT_MESSAGES` | `10` | 注入最近消息数 |
| `AGENT_MEMORY_COMPACT_MESSAGES` | `40` | 触发记忆压缩的消息数 |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | `2000` | 摘要目标 token |
| `AGENT_MEMORY_PROMOTE_MIN_DAYS` | `3` | 候选记忆晋升所需不同日期数 |
| `AGENT_MEMORY_LESSON_PROMOTE_MIN_DAYS` | `1` | 错误/教训类晋升门槛 |
| `AGENT_MEMORY_CANDIDATE_TTL_DAYS` | `14` | 未晋升候选记忆 TTL |
| `AGENT_STALL_WATCHDOG_DELAY_MS` | `180000` | 卡住检测延迟 |
| `AGENT_STALL_WATCHDOG_MAX_CONSECUTIVE` | `5` | 连续救援上限 |
| `AGENT_COORDINATOR_LLM_TIMEOUT_MS` | `120000` | 协调器 LLM 决策超时 |
| `AGENT_COORDINATOR_LLM_RETRY_COUNT` | `1` | 协调器 LLM 重试次数 |
| `AGENT_EXECUTION_NO_ACTIVITY_TIMEOUT_MS` | `90000` | 助手无活动重试超时（0 关闭） |
| `AGENT_MAX_HANDOFF_HOPS` | `20` | 协作预算：单 `@` 接力跳数预算 |
| `AGENT_HANDOFF_CYCLE_REPEAT_LIMIT` | `3` | 协作预算：连续环路来回上限 |
| `BRIDGE_ENCRYPTION_KEY` | `''` | Bridge 凭据加密密钥 |
| `BRIDGE_REQUIRE_SIGNATURE` | `false` | 是否强制 Webhook 验签 |
| `EDGE_TTS_BINARY` / `EDGE_TTS_DEFAULT_VOICE` | `edge-tts` / `zh-CN-XiaoxiaoNeural` | 语音合成 |
| `TEAMAGENTX_SHARED_SKILLS_DIR` | `~/.teamagentx/skills` | 模板包技能共享目录 |
| `TOOLS_DIR` | `''` | 工具目录覆盖 |

LLM 凭据主要存于本地 `LlmProvider` 表；ACP 执行器把供应商映射为工具专属环境变量（Claude 用 `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`，Codex 用 `OPENAI_API_KEY`/`OPENAI_MODEL`）。`start.sh` 可从 `~/.openclaw/openclaw.json` 载入 `OPENCLAW_GATEWAY_TOKEN`。

---

## 10. Bridge 外部平台集成

`server/src/modules/bridge/` 将外部 IM 平台消息桥接到群聊，后续流转与普通用户消息一致。

### 10.1 支持平台

| 平台 | 连接方式 |
|------|---------|
| **Telegram** | Polling（长轮询） |
| **飞书（Feishu）** | WebSocket 长连接 |
| **钉钉（DingTalk）** | Stream 长连接 |
| **企业微信（WeCom）** | Webhook 回调 |

### 10.2 工作原理

1. 在群聊设置创建机器人绑定（`BridgeBot`，按平台填凭据；同平台可多实例，`credentialHash` 去重）
2. 启动时按平台建立长连接或注册 Webhook（`syncAllBridgeBotsRuntime`）
3. 外部消息到达后由 `bridge.service.ts` 适配为群聊消息发入目标群，流转与普通用户消息一致
4. 助手回复同步推回外部平台；事件记录于 `BridgeEvent`

### 10.3 关键模块

| 文件 | 职责 |
|-----|------|
| `bridge-platform-registry.ts` | 各平台配置字段定义 |
| `bridge.service.ts` | 消息路由核心 |
| `platform-inbound-adapters.ts` / `platform-senders.ts` | 平台 ↔ 内部格式适配/发送 |
| `bridge-commands.ts` | 桥接群内置命令（help / clear / @助手）|
| `bridge-platform-playbooks.ts` | 各平台配置向导文案 |

REST 端点为 `/api/bridge/*`（机器人 CRUD、绑定码、Webhook 入口等）。

---

## 11. 语音（Speech）

`server/src/modules/speech/`（路由 `speech.router.ts`，网关 `speech.gateway.ts`）提供 TTS/STT：

- `LlmProvider` 设 `modelType = audio`，指定 `sttModel`（语音识别专用）和 `audioUsage`（`tts | stt | both`）
- 支持远端 TTS API 与浏览器本地语音（`browser-local`）
- `buildSpeechVoiceCatalog()` 聚合所有可用音色，含平台元数据（`VOICE_PROVIDER_METADATA`）
