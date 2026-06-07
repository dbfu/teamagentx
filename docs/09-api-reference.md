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

---

## ChatRooms

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/chatrooms` | 所有群聊列表（含 lastMessage、成员） |
| GET | `/chatrooms/:id` | 单个群聊详情 |
| POST | `/chatrooms` | 创建群聊（`name`, `workDir?`, `rules?`, `ownerId?`） |
| PUT | `/chatrooms/:id` | 更新群聊（`name`, `rules`, `workDir`, `defaultAgentId`, `agentTriggerMode`） |
| DELETE | `/chatrooms/:id` | 删除群聊 |
| PATCH | `/chatrooms/:id/pin` | 置顶 |
| PATCH | `/chatrooms/:id/unpin` | 取消置顶 |

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

---

## Messages

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | `/messages` | 消息列表（`chatRoomId?`，最多 100 条） |
| GET | `/messages/:id` | 单条消息 |
| GET | `/messages/:id/execution` | 消息关联的执行记录 |
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
| GET | `/token-usage/summary` | 全量 token 用量汇总（`startDate?`, `endDate?`, `chatRoomId?`, `agentId?`） |
| GET | `/token-usage/timeline` | 按天分组的用量趋势 |
| GET | `/token-usage/providers/:providerId` | 指定供应商的用量 |

---

## Upload

| 方法 | 路径 | 说明 |
|-----|------|------|
| POST | `/upload/image` | 上传图片（multipart/form-data，返回 `{url, width, height, ...}`） |

---

## 通用约定

- 所有成功响应格式：`{ success: true, data: ... }`
- 错误响应格式：`{ success: false, error: "..." }`
- JWT token 通过 `Authorization: Bearer <token>` 传递
- 需要认证的接口未列出认证要求（当前版本大部分接口无强制认证，依赖 Socket JWT 认证）
