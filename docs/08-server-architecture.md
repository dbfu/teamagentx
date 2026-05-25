# 08 · 服务端架构

> 版本：v0.1.0 · 对应 `server/src/`

## 1. 目录结构

```
server/src/
├── app.ts                  # Fastify 应用创建、插件注册、启动
├── index.ts                # 开发入口（直接监听）
├── electron-entry.ts       # Electron utilityProcess 入口
├── config/index.ts         # 集中配置（端口/JWT/Agent 参数）
├── gateway/                # REST 路由层（Fastify route handlers）
│   ├── agent.gateway.ts
│   ├── auth.gateway.ts
│   ├── category.gateway.ts
│   ├── chatroom.gateway.ts
│   ├── cron-task.gateway.ts
│   ├── llm-provider.gateway.ts
│   ├── message.gateway.ts
│   ├── skill.gateway.ts
│   └── token-usage.gateway.ts
├── socket/index.ts         # Socket.io 服务端（认证 + 事件处理）
├── core/
│   ├── agent/              # Agent 执行引擎（核心）
│   │   ├── agent-handler/  # 消息监听、任务入队、执行调度
│   │   ├── executor.factory.ts   # 执行器工厂
│   │   ├── executor.interface.ts # IAgentExecutor 接口
│   │   ├── langchain.executor.ts # builtin 执行器
│   │   ├── claude-sdk.executor.ts # Claude Agent SDK 执行器
│   │   ├── codex-sdk.executor.ts  # Codex SDK 执行器
│   │   ├── model.factory.ts      # LangChain ChatModel 工厂
│   │   ├── skill-instructions.ts # Skill 加载与注入
│   │   ├── agent-long-term-memory.ts # 长期记忆摘要
│   │   ├── work-dir.ts           # 工作目录解析
│   │   ├── agent-log.ts          # 执行日志
│   │   └── tools/                # 内置 LangChain 工具
│   ├── cron/
│   │   └── cron-scheduler.service.ts  # Cron 调度器
│   └── shell/
│       ├── shell-command.ts      # shell 命令执行
│       ├── background-task-manager.ts # 后台任务管理
│       ├── block-detector.ts     # 阻塞检测
│       └── task-output.ts        # 输出流管理
├── modules/                # 业务服务层
│   ├── auth/               # JWT 登录/注册
│   ├── agent-memory/       # AgentRoomMemory CRUD + 历史构建
│   ├── chatroom/           # ChatRoom CRUD
│   ├── checkpoint/         # LangChain checkpointer（builtin 上下文）
│   ├── cron-task/          # CronTask CRUD
│   ├── execution-record/   # ExecutionRecord CRUD
│   ├── llm-provider/       # LlmProvider CRUD
│   ├── message/            # Message CRUD
│   ├── prompt-optimize/    # 提示词优化（流式）
│   ├── quick-chat-session/ # QuickChatSession 生命周期
│   ├── recovery/           # 启动时任务恢复
│   ├── skill/              # Skill 安装/CRUD
│   ├── task-queue/         # TaskQueue 入队/出队
│   ├── token-usage/        # Token 用量统计
│   ├── upload/             # 图片上传
│   └── user/               # User CRUD
├── scripts/                # 启动时初始化脚本
│   ├── system-agent-definitions.ts  # 系统助手定义
│   ├── system-agent-sync.ts         # 同步系统助手到 DB
│   └── init-*.ts                    # 确保系统助手存在
└── lib/
    ├── prisma.ts            # Prisma 单例
    ├── checkpointer.ts      # libsql checkpointer
    └── libsql-client.ts     # libsql 连接
```

---

## 2. 启动流程

```
createApp()
  ├── 注册 CORS、静态文件（/uploads/）
  ├── 初始化上传目录
  ├── 创建 Socket.io server
  ├── 注册所有 gateways（REST 路由）
  ├── setupSocket(io)           # Socket.io 事件
  ├── migrateAgentAvatars()     # 数据迁移脚本
  ├── migrateChatRoomAvatars()
  ├── ensureAgentCreatorExists()  # 系统助手确保存在
  ├── ensureSkillsHelperExists()
  ├── ensureCronTaskHelperExists()
  ├── ensureChatroomHelperExists()
  ├── taskQueueService.recoverInterruptedTasks()  # 恢复中断任务
  ├── clearAllExecutionState()  # 清理 executing 状态
  ├── initAgents(io)            # 初始化 Agent handler
  └── cronSchedulerService.start()  # 启动 Cron 调度器
```

**端口**：
- Web/开发模式：`PORT`（默认 `3001`）
- Electron 嵌入：固定 `11053`，移动 Web 入口 `11054`

---

## 3. Agent 执行系统

### 3.1 执行器类型

| 执行器类 | 触发条件 | 特点 |
|---------|---------|------|
| `ClaudeAgentSdkExecutor` | `agent.type = 'acp'` + `acpTool = 'claude'` | Claude Agent SDK，流式 thinking |
| `CodexSdkExecutor` | `agent.type = 'acp'` + `acpTool = 'codex'` | OpenAI Codex SDK |

### 3.2 执行器工厂

`executor.factory.ts` 的 `createExecutor(options)` 根据 `agent.type` 和 `acpTool` 分发。当前本地 Agent 路径只支持 Claude 和 Codex：

```
agent.type === 'acp'
  acpTool === 'claude'  → ClaudeAgentSdkExecutor
  acpTool === 'codex'   → CodexSdkExecutor
agent.type === 'builtin' → ClaudeAgentSdkExecutor（兼容旧内置助手）
```

### 3.3 执行器缓存

执行器实例按 `chatRoomId_agentName` 为 key 缓存（`executorCache: Map<string, IAgentExecutor>`），保持每个「群-助手」组合的独立会话状态。

清空消息或切换 workDir 时需调用 `clearExecutorCache(agentName, chatRoomId)` 并销毁实例。

### 3.4 消息 → 执行链路

```
Socket.io 收到用户消息
  → messageService.save()
  → socket.emit('message', msg)
  → messageEventEmitter.emit('receivedMessage', {message, chatRoomId})

handler.ts 监听 receivedMessage
  → parseMentions(content) 提取 @助手名
  → 判断：快速对话群聊 / 普通群聊默认助手 / @触发
  → 手动模式（agentTriggerMode=manual）：助手消息的 @ 不触发
  → enqueueAgentTask(chatRoomId, message, agent)
       ├── agentMemoryService.buildHistory()   # 组装摘要 + 最近消息
       ├── taskQueueService.enqueue()          # 写入 TaskQueue 表
       ├── 更新 lastInjectedMessageId（增量注入位置）
       └── processQueue(chatRoomId, agentId)   # 触发队列处理

processor.ts 处理队列
  → 取出 pending 任务
  → getExecutor() 获取/创建执行器
  → executor.execute(message, history, attachments)
  → 流式回调：emitStream / emitThinking / emitToolCall
  → 完成：emitDone，存 ExecutionRecord
```

### 3.5 工作目录优先级

```
快速对话/会话目录（sessionDir）
  └─ 群工作目录（chatRoom.workDir）
        └─ 助手工作目录（agent.workDir）
              └─ 默认目录（~/teamagentx-sessions/）
```

`work-dir.ts` 中的 `resolveWorkDir()` 实现上述回退逻辑。

### 3.6 长期记忆（AgentRoomMemory）

- 每个「群-助手」组合有一条 `AgentRoomMemory` 记录
- 触发压缩条件：消息数超过 `AGENT_MEMORY_COMPACT_MESSAGES`（默认 40）
- 压缩目标：生成 ≤ `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` 个 token 的摘要
- 注入策略：每次执行前，`agentMemoryService.buildHistory()` 将摘要 + 最近 `AGENT_MEMORY_RECENT_MESSAGES` 条消息合并成历史数组
- 压缩在后台异步执行，不阻塞当前任务

---

## 4. Socket.io 事件

### 4.1 服务端 → 客户端

| 事件名 | payload | 说明 |
|-------|---------|------|
| `message` | `Message` | 新消息（人类或 AI） |
| `agent:typing` | `{messageId, agentId, agentName, status: 'pending'|'executing'}` | 助手开始处理/排队 |
| `agent:stream` | `{messageId, agentId, agentName, content}` | 流式内容片段 |
| `agent:thinking` | `{messageId, agentId, agentName, thinking}` | 思考链片段 |
| `agent:tool_call` | `{messageId, agentId, agentName, toolCall}` | 工具调用事件 |
| `agent:done` | `{agentId, agentName, triggerMessageId, executionRecordId?, messageIds?, duration?, totalTokens?, cacheReadTokens?}` | 助手完成 |
| `agent:status` | `{chatRoomId, statuses: Record<agentId, AgentStatus>, queueCounts?}` | 全局广播助手状态（广播给所有 socket） |
| `agent:task-queue` | `{chatRoomId, agentId, tasks[]}` | 任务队列快照 |
| `agent:task-cancelled` | `{agentId, agentName, taskId}` | 任务被取消 |
| `agent:task-resumed` | `{agentId, agentName, taskId}` | 任务恢复执行 |
| `unread:update` | `{chatRoomId, count}` | 未读数更新（用户房间） |

### 4.2 客户端 → 服务端

| 事件名 | payload | 说明 |
|-------|---------|------|
| `join` | `{chatRoomId}` | 加入群聊房间 |
| `leave` | `{chatRoomId}` | 离开群聊房间 |
| `message` | `{id, content, chatRoomId, userId?, agentId?, isHuman, attachments?}` | 发送消息 |
| `stop_agent` | `{chatRoomId, agentId}` | 中止助手执行 |
| `resume_task` | `{chatRoomId, agentId, taskId}` | 恢复中断任务 |
| `mark_read` | `{chatRoomId, userId}` | 标记已读 |
| `get_agent_statuses` | `{chatRoomId}` | 查询群聊助手状态 |

### 4.3 认证

Socket 连接时需在 `auth.token` 中传 JWT token，服务端 `auth middleware` 验证后将 user 信息挂到 `socket.data.user`。

---

## 5. Cron 调度

`cron-scheduler.service.ts`：
- 服务启动时加载所有 `enabled=true` 的 `CronTask`
- 支持 `cron`（cron 表达式）、`interval`（固定分钟）、`once`（一次性）三种类型
- 到期时将 `payload` 注入指定 `agentIds` 的群聊；多个助手会拆成多条消息逐个触发，行为等同于用户分别发送消息
- 执行结果写入 `CronTaskExecution`，失败自动重试（`maxRetries`）

---

## 6. 后台任务（Shell）

- `shell-command.ts`：执行 shell 命令，输出写入临时文件
- `background-task-manager.ts`：管理长时运行命令（`BackgroundTask` 表），支持前台/后台切换
- `block-detector.ts`：检测命令是否超时无输出（阻塞），触发通知
- `task-output.ts`：流式读取输出文件，推送给前端

---

## 7. 内置工具（LangChain builtin 执行器）

`core/agent/tools/` 注册以下内置工具：

| 工具 | 文件 | 功能 |
|-----|------|------|
| `skill_manager` | `skill-manager.tools.ts` | 安装/卸载/列出 Skill |
| `skills_helper` | `skills-helper.tools.ts` | 获取 Skill 内容 |
| `chatroom_helper` | `chatroom-helper.tools.ts` | 查询群聊信息 |
| `agent_creator` | `agent-creator.tools.ts` | 创建/更新助手 |
| `cron_task_helper` | `cron-task-helper.tools.ts` | 创建/管理 Cron 任务 |
| `web_fetch` | `web-fetch.tools.ts` | HTTP 请求 |

---

## 8. 系统助手（System Agents）

`scripts/system-agent-definitions.ts` 定义了 4 个系统级助手（`agentLevel: 'system'`），启动时由对应的 `init-*.ts` 脚本自动同步到数据库：

| 助手 | ID 常量 | 功能 |
|-----|--------|------|
| 技能管理 | `SKILLS_HELPER_AGENT_ID` | 通过对话安装/管理 Claude Code skill |
| 助手创建 | `AGENT_CREATOR_AGENT_ID` | 通过对话创建新助手 |
| 定时任务管理 | `CRON_TASK_HELPER_AGENT_ID` | 通过对话创建 Cron 任务 |
| 群聊助手 | `CHATROOM_HELPER_AGENT_ID` | 群聊信息查询助手 |

系统助手是「虚拟成员」——不加入 `ChatRoomAgent`，可在任何群聊中被 @ 触发。

---

## 9. 配置参数

`server/src/config/index.ts`：

| 变量 | 默认值 | 说明 |
|-----|-------|------|
| `PORT` | `3001` | HTTP 监听端口 |
| `SERVER_HOST` | `0.0.0.0` | 监听地址 |
| `DATABASE_URL` | `file:./dev.db` | SQLite 路径 |
| `JWT_SECRET` | `teamagentx-default-secret-key` | JWT 密钥 |
| `JWT_EXPIRES_IN` | `7d` | JWT 有效期 |
| `AGENT_HISTORY_THRESHOLD` | `20` | 历史消息阈值（暂用于旧逻辑） |
| `AGENT_MEMORY_RECENT_MESSAGES` | `10` | 注入最近消息数 |
| `AGENT_MEMORY_COMPACT_MESSAGES` | `40` | 触发记忆压缩的消息数 |
| `AGENT_MEMORY_SUMMARY_TARGET_TOKENS` | `2000` | 摘要目标 token 数 |
