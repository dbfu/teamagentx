# 09 · REST API 速查

[English](09-api-reference_EN.md) | 中文

> 所有接口均以 `http://localhost:3001` 为 base URL（Electron 打包后为 `http://localhost:11053`）。  
> 开发模式下可访问 Swagger UI：`http://localhost:3001/docs`

---

## Auth

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/auth/check-first-use` | 检查是否首次使用（无用户则免注册） |
| POST | `/auth/register` | 注册（`username`, `password`） |
| POST | `/auth/login` | 登录，返回 `token` |
| GET | `/auth/me` | 获取当前用户信息（需 Bearer token） |
| PUT | `/auth/profile` | 更新用户名/头像 |

---

## Setup / App Settings / Health

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/health` | 健康检查 |
| GET | `/network-info` | 局域网访问地址信息 |
| GET | `/openapi.json` | OpenAPI JSON（开发/非 Electron 默认启用 Swagger） |
| GET | `/setup/status` | 首次引导状态与 ACP 工具安装情况（公开，桌面端） |
| POST | `/setup/complete` | 完成首次引导（注册 + 默认 Agent/模型） |
| POST | `/setup/install-tool` | 流式安装 ACP 工具（Claude / Codex，桌面端） |
| GET / PUT | `/settings/:key` | 读取 / 更新白名单应用设置（目前 `diaryEnabled`） |

---

## Agents

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/agents` | 所有助手列表 |
| GET | `/agents/active` | 所有活跃助手 |
| GET | `/agents/grouped` | 按分类分组的助手列表 |
| GET | `/acp-tools` | 支持的本地 Agent 工具列表及安装状态（Claude / Codex） |
| GET | `/agents/:id` | 单个助手详情 |
| POST | `/agents` | 创建助手 |
| PUT | `/agents/:id` | 更新助手 |
| DELETE | `/agents/:id` | 删除助手 |
| PATCH | `/agents/:id/status` | 激活/停用（`isActive: boolean`） |
| POST | `/agents/:id/clear-context` | 清空助手全局上下文 |
| PUT | `/agents/sort-order` | 批量更新排序（`items: [{id, sortOrder}]`） |
| POST | `/agents/optimize-prompt` | 提示词优化（同步） |
| POST | `/agents/optimize-prompt-stream` | 提示词优化（流式 SSE） |

### 快速对话

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/agents/quick-chat` | 创建快速对话临时群聊（`agentId`, `userId`, `workDir?`） |
| GET | `/agents/:agentId/quick-chat-rooms` | 获取助手的快速对话群聊列表 |
| GET | `/agents/:agentId/quick-chat-count` | 获取助手的快速对话次数 |
| GET | `/chatrooms/:chatRoomId/quick-chat-session/claude-local-sessions` | 列出本机 Claude 历史会话 |
| POST | `/chatrooms/:chatRoomId/quick-chat-session/claude-local-session` | 绑定/切换本机 Claude 会话 |
| GET | `/chatrooms/:chatRoomId/quick-chat-session/codex-local-sessions` | 列出本机 Codex 历史会话 |
| POST | `/chatrooms/:chatRoomId/quick-chat-session/codex-local-session` | 绑定/切换本机 Codex 会话 |

### 助手日记 / 记忆

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/agents/:agentId/memory` | 助手长期记忆摘要 |
| GET | `/agents/:agentId/diary` / `/diary/:date` | 助手日记（按日） |
| POST | `/agents/:agentId/diary/generate` | 立即生成日记 |

---

## ChatRooms

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/chatrooms` | 所有群聊列表（含 lastMessage、成员） |
| GET | `/chatrooms/:id` | 单个群聊详情 |
| POST | `/chatrooms` | 创建群聊（`name`, `workDir?`, `rules?`, `ownerId?`） |
| PUT | `/chatrooms/:id` | 更新群聊（`name`, `rules`, `dispatchRules`, `workDir`, `envVars`, `defaultAgentId`, `agentTriggerMode`） |
| DELETE | `/chatrooms/:id` | 删除群聊 |
| PATCH | `/chatrooms/:id/pin` `/unpin` | 置顶 / 取消置顶 |
| PATCH | `/chatrooms/:id/collapse` `/uncollapse` | 折叠 / 取消折叠 |
| POST | `/chatrooms/:id/duplicate` | 复制群聊（带成员/规则/dispatchRules） |
| POST | `/chatrooms/:id/fork` | 从归档历史 Fork 新群聊 |

> `dispatchRules`（群调度规则 YAML）通过 `PUT /chatrooms/:id` 保存，保存时做 zod 结构化校验；非法格式拒绝。

### 群聊成员

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/chatrooms/:id/agents` | 添加助手/用户成员（`agentId`, `userId?`, `role?`, `injectGroupHistory?`） |
| DELETE | `/chatrooms/:id/agents/:agentId` | 移除成员 |
| PATCH | `/chatrooms/:id/agents/:agentId/settings` | 更新成员设置（`injectGroupHistory`） |
| POST | `/chatrooms/:id/agents/:agentId/clear-context` | 清空助手在该群的上下文 |
| GET | `/chatrooms/:id/agents/:agentId/context` | 获取助手在该群的上下文信息 |
| GET | `/chatrooms/:id/agents/:agentId/tasks` | 获取助手在该群的任务队列 |
| GET | `/chatrooms/:id/tasks/board` | 获取群聊任务看板（所有助手任务汇总） |
| GET | `/chatrooms/:id/quick-chat-session` | 获取当前快速对话会话 |

### 执行记录

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/chatrooms/:chatRoomId/agents/:agentId/executions` | 获取执行记录列表（`take?`） |
| DELETE | `/chatrooms/:chatRoomId/agents/:agentId/executions` | 删除执行记录 |
| GET | `/chatrooms/:chatRoomId/agents/:agentName/debug` | 获取助手调试信息 |

### 群聊 Git / 脚本 / 指令（桌面端）

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/chatrooms/:id/git-status` | 群工作目录 git 状态 |
| POST | `/chatrooms/:id/git-branch` | 创建/切换分支 |
| POST | `/chatrooms/:id/git-command` | 执行受限 git 命令 |
| GET | `/chatrooms/:id/package-scripts` | 读取 package.json 脚本 |
| POST | `/chatrooms/:id/package-scripts/run` | 运行脚本 |
| GET / POST | `/chatrooms/:chatRoomId/commands` | 群自定义指令列表 / 新建 |
| PUT / DELETE | `/commands/:commandId` | 更新 / 删除指令 |

---

## Messages

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/messages` | 消息列表（`chatRoomId?`，最多 100 条） |
| GET | `/messages/:id` | 单条消息 |
| GET | `/messages/:id/execution` | 消息关联的执行记录 |
| GET | `/messages/search` | 全文/条件搜索消息 |
| GET | `/chatrooms/:chatRoomId/message-archives` | 群历史归档列表 |
| POST | `/messages/batch-delete` · DELETE `/messages/batch` | 批量删除消息 |
| DELETE | `/messages/chatroom/:chatRoomId` | 清空群聊消息（同时中止执行、清空上下文） |

---

## LLM Providers

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/llm-providers` | 所有 LLM 供应商 |
| GET | `/llm-providers/:id` | 单个供应商 |
| POST | `/llm-providers` | 创建（`name`, `model`, `apiKey`, `apiProtocol`, `apiUrl?`） |
| PUT | `/llm-providers/:id` | 更新 |
| DELETE | `/llm-providers/:id` | 删除 |
| PATCH | `/llm-providers/:id/status` | 激活/停用 |
| PATCH | `/llm-providers/:id/default` | 设为默认 |
| POST | `/llm-providers/:id/test` | 测试连接 |
| POST | `/llm-providers/parse-config` | 解析文本配置（粘贴模型配置一键解析） |

---

## Skills

### 助手级 skill（路径含 agentId）

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/agents/:agentId/skills` | 助手已安装的 skill 列表 |
| POST | `/agents/:agentId/skills/discover` | 发现 GitHub 仓库中的所有 skill（传 `slug` 为仓库地址） |
| POST | `/agents/:agentId/skills/install-selected` | 安装 discover 返回的选中 skill（传 `sessionId` + `indices`） |
| POST | `/agents/:agentId/skills/install` | 安装单个 skill（传 `slug` 为 GitHub URL 或 skill 名） |
| DELETE | `/agents/:agentId/skills/:slug` | 卸载指定 skill |

### 共享 / 全局 skill

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/skills/search` | 搜索 ClawdHub Registry（`q=`, `limit=`） |
| GET | `/skills/shared` | 列出共享目录中的所有 skill |
| POST | `/skills/create` | 创建 skill 到共享目录（`skillName`, `description`, `content`） |
| POST | `/skills/symlink` | 将共享目录中的 skill symlink 安装到指定助手（`skillName`, `targetAgentId`） |
| DELETE | `/skills/symlink` | 删除 symlink |
| GET | `/skills/:slug` | 获取单个 skill 详情 |
| GET | `/skills/external` | 外部 skill 目录列表（Claude Code 风格） |
| POST | `/skills/external/install` | 从外部目录安装 skill（symlink 模式） |

---

## Categories

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/categories` | 所有分类 |
| PUT | `/categories/sort-order` | 批量更新分类排序 |
| GET | `/categories/:id` | 单个分类 |
| POST | `/categories` | 创建分类 |
| PUT | `/categories/:id` | 更新分类 |
| DELETE | `/categories/:id` | 删除分类 |

---

## Cron Tasks

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/chatrooms/:chatRoomId/cron-tasks` | 群聊的定时任务列表 |
| POST | `/chatrooms/:chatRoomId/cron-tasks` | 创建定时任务 |
| GET | `/cron-tasks/:taskId` | 单个定时任务 |
| PUT | `/cron-tasks/:taskId` | 更新定时任务 |
| PATCH | `/cron-tasks/:taskId/enable` | 启用/禁用（`enabled: boolean`） |
| DELETE | `/cron-tasks/:taskId` | 删除定时任务 |
| GET | `/cron-tasks/:taskId/executions` | 执行历史（`limit?`） |
| POST | `/cron-tasks/:taskId/test` | 立即测试执行一次 |

---

## Token Usage

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/token-usage/by-provider` | 按模型供应商聚合 token 用量 |
| GET | `/token-usage/daily` | 每日 token 趋势（可按 provider 过滤） |
| GET | `/token-usage/by-agent` | 按助手聚合 token 用量 |
| GET | `/token-usage/provider/:id/detail` | 单个供应商明细（总量、助手拆分、最近执行） |

---

## Upload

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/upload/image` | 上传单张图片（multipart/form-data，返回 `{url, width, height, ...}`） |
| POST | `/upload/images` | 批量上传图片 |
| POST | `/upload/audio` | 上传音频（用于 STT） |

---

## Workbench（工作台今日任务）

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/workbench/tasks` | 今日任务列表 |
| POST | `/workbench/tasks` | 创建今日任务 |
| PUT | `/workbench/tasks/:id` | 更新（含状态流转） |
| DELETE | `/workbench/tasks/:id` | 删除 |
| POST | `/workbench/tasks/:id/dispatch` | 派发到群聊 |
| POST | `/workbench/tasks/dispatch-batch` | 批量派发 |
| POST | `/workbench/recommend-room` | 推荐目标群聊 |

## Coordinator Logs（调度日志）

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/coordinator-logs` | 全部群调度决策日志 |
| GET | `/coordinator-logs/:chatRoomId` | 指定群的调度日志 |

## Template Packages（群模板包）

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/template-packages/export` | 导出群模板 ZIP（成员、规则、dispatchRules、技能引用等） |
| POST | `/template-packages/preview` | 上传模板 ZIP 并预检导入影响 |
| POST | `/template-packages/import` | 导入模板 ZIP，生成新群并记录导入审计 |

## Bridge（外部平台机器人，`/api/bridge/*`）

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/api/bridge/webhook-url` | 获取当前服务 Webhook 基础地址 |
| GET | `/api/bridge/platforms` | 支持的平台 |
| GET | `/api/bridge/playbooks/:platform` | 平台配置向导 |
| GET / POST | `/api/bridge/bots` | 机器人列表 / 创建 |
| GET / PATCH / DELETE | `/api/bridge/bots/:id` | 机器人详情 / 更新 / 删除 |
| POST | `/api/bridge/bots/:id/bind` `/bind-code` `/unbind` | 绑定群 / 生成绑定码 / 解绑 |
| GET | `/api/bridge/events` | 桥接事件日志 |
| GET / PUT | `/api/bridge/system-config` | 全局桥接配置 |
| POST | `/api/bridge/message` | 外部平台入站消息统一入口 |
| POST | `/api/bridge/webhook/wecom/:botId` 等 | 各平台 Webhook 入口（公开） |

## Speech / 内部工具

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/speech/*`（见 `speech.router.ts`） | TTS / STT / 音色目录 |
| POST | `/internal/agent-tools/*` | 内置助手工具端点（后台命令、生成图片、系统工具、助手间消息） |
| POST | `/codex-router/:token/:providerId/v1/responses` | Codex chat↔responses 协议转换（内部） |
| POST | `/codex-router/:token/:providerId/v1/chat/completions` | Codex responses↔chat 协议转换（内部） |

---

## 通用约定

- 所有成功响应格式：`{ success: true, data: ... }`
- 错误响应格式：`{ success: false, error: "..." }`
- JWT token 通过 `Authorization: Bearer <token>` 传递
- **全局 `authHook`（`onRequest`）对所有非公开端点强制校验 JWT**；公开端点包括登录/注册/首次引导状态/部分平台 Webhook。Socket 连接另在 `auth.token` 校验 JWT
