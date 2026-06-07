# 群聊环境变量（ChatRoom Environment Variables）设计

[English](2026-06-06-chatroom-env-vars-design_EN.md) | 中文

- 日期：2026-06-06
- 状态：已评审，待实现

## 1. 背景与目标

群聊（ChatRoom）需要支持定义一组环境变量（`key` / `value` / `description`）。当群内助手启动执行时：

1. 把这些环境变量注入到助手执行脚本所在的 shell 命令环境，使后续脚本可以从环境变量里取值；
2. 在助手系统提示词里注入环境变量的 `key` 和 `description`（**不含 value**），让助手知道有哪些变量可用、用途是什么，从而在脚本里正确引用。

典型场景：群里配置 `GITHUB_TOKEN`、`DEPLOY_HOST` 等，助手在 `run_shell_command` 里通过 `$GITHUB_TOKEN` 取值调用外部服务。

## 2. 关键决策（已与用户确认）

- **value 处理**：明文存储到数据库；前端 UI 默认遮罩（`••••`），点击「显示」才可见；不写入日志。
- **存储方式**：在 `ChatRoom` 上新增 JSON 字段（`envVars String?`），整体保存，不建独立表。
- **注入边界**：环境变量**只注入到 shell 命令执行环境**（`run_shell_command` / `start_background_command` 及 Codex 的 shell spawn），**不注入执行器主进程 env**。
  - 理由：脚本取值的唯一路径就是 shell 命令环境；注入主进程 env 不仅无额外收益，还可能覆盖 `ANTHROPIC_*` / `OPENAI_*` 等鉴权键，导致请求打到错误端点（`buildEnv()` 中已有 `keysToClear` 处理此类冲突）。
- **保留键护栏**：注入时跳过一批保留键，防止群配置劫持执行器行为；被跳过的 key 在保存响应里提示前端。

## 3. 数据模型

### 3.1 Schema 变更

`server/prisma/schema.prisma` 的 `ChatRoom` 模型新增：

```prisma
envVars String? // 群聊环境变量，JSON 数组：[{ key, value, description }]
```

配套一条 Prisma migration（`server/prisma/migrations/`），并按需 `prisma generate`。遵循项目「迁移即真相」规则，不使用 `db push` / 手动 `ALTER TABLE` 作为长期方案。

### 3.2 存储格式

```json
[
  { "key": "GITHUB_TOKEN", "value": "ghp_xxx", "description": "用于调 GitHub API 的令牌" },
  { "key": "DEPLOY_HOST", "value": "10.0.0.1", "description": "部署目标主机地址" }
]
```

字段语义：
- `key`：环境变量名，必填。
- `value`：值，可空字符串。
- `description`：用途说明，注入到提示词，可空。

## 4. 后端实现

### 4.1 解析与校验工具

新增工具函数（建议放在 `server/src/core/agent/` 下，如 `room-env-vars.ts`）：

```ts
interface RoomEnvVar { key: string; value: string; description?: string }

// 解析 ChatRoom.envVars（JSON 字符串）为合法数组
function parseRoomEnvVars(raw: string | null | undefined): RoomEnvVar[]
```

解析规则：
- JSON 解析失败 → 返回 `[]`（不抛错，避免阻断执行）。
- `key` 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`，否则丢弃该条。
- key 去重：保留**首次**出现的那条，丢弃后续同名条目（与 UI 中靠上的行优先一致）。
- `value` 缺省为 `''`，`description` 缺省为 `undefined`。

保留键集合（注入时跳过，大小写不敏感按需处理）：
- `PATH`、`HOME`、`SHELL`、`PWD`、`USER`、`LOGNAME`、`TMPDIR`
- 前缀：`ANTHROPIC_`、`OPENAI_`、`ACPX_`、`CLAUDE_`、`CODEX_`、`TEAMAGENTX_`
- `NODE_PATH`、`NODE_OPTIONS`

工具函数同时导出：
- `buildShellEnvFromRoomEnvVars(base, roomEnvVars): { env, skippedKeys }` —— 在 `base` 之上 merge 非保留键，返回结果 env 与被跳过的 key 列表（供保存接口提示）。

### 4.2 配置流转

在 `executor-manager.ts`：
- 已经 `findById(chatRoomId)` 拿到 `chatRoom`，新增 `const roomEnvVars = parseRoomEnvVars(chatRoom?.envVars)`。
- 通过 `createExecutor` 传入新选项 `roomEnvVars`。

在 `executor.factory.ts`：
- `CreateExecutorOptions` 新增 `roomEnvVars?: RoomEnvVar[]`。
- 传递给 `ClaudeAgentSdkExecutor` 与 `CodexSdkExecutor` 构造函数（新增构造参数）。

### 4.3 注入到 shell 命令环境

**Claude**（`claude-sdk.executor.ts`）：
- 构造函数保存 `this.roomEnvVars`。
- 在 `buildMcpCommandEnv()` 里，对返回的 env 用 `buildShellEnvFromRoomEnvVars` merge `roomEnvVars`。
- 该方法已被 `run_shell_command`（`runShellCommandForMcp` 实际用的也是它）与 `start_background_command` 复用，因此两类脚本都能取到值。
  - 注意：`runShellCommandForMcp` 当前直接调用 `this.buildMcpCommandEnv()`，无需额外改动其内部。

**Codex**（`codex-sdk.executor.ts`）：
- 构造函数保存 `this.roomEnvVars`。
- 在其 shell 命令 spawn 的 env 处（Codex 执行 shell 的 env 来源）merge `roomEnvVars`，保持与 Claude 一致的保留键护栏。

### 4.4 注入到系统提示词

在 `agent-system-prompt.ts` 的 `buildAgentBaseSystemPrompt()`：
- `BuildAgentBaseSystemPromptOptions` 新增 `roomEnvVars?: RoomEnvVar[]`。
- 新增 section（与 `## Group Rules` / `## Working Directory` 同级），**只列 key + description，绝不含 value**：

```
## Environment Variables
The following environment variables are available in your shell command environment. Read their values at runtime via the shell (e.g. `$GITHUB_TOKEN`); never assume or hardcode their values.
- GITHUB_TOKEN: 用于调 GitHub API 的令牌
- DEPLOY_HOST: 部署目标主机地址
```

- 无变量或全部被保留键过滤后为空 → 整段不输出。
- 列表使用过滤掉保留键后的同一份变量，保证「提示词里出现的 key」与「shell 里真实可取的 key」一致。
- claude/codex 各自构建系统提示词处把 `roomEnvVars` 透传进 `buildAgentBaseSystemPrompt`。

### 4.5 API

`chatroom.gateway.ts`：
- 更新 body schema（`PATCH/PUT chatrooms/:id` 对应处，rules/workDir 同段）新增 `envVars: { type: 'string', nullable: true }`。
- `UpdateChatRoomBody` / `UpdateChatRoomData` 类型新增 `envVars?: string | null`。
- 保存时对 `envVars` 做一次 `parseRoomEnvVars` 规整后再存（剔除非法 key、统一格式），并在响应里返回 `skippedReservedKeys: string[]`（保留键命中列表），供前端提示。

`chatroom.service.ts` 的 `update()` 透传 `envVars`。

## 5. 前端实现

### 5.1 API 客户端

`chatRoomApi.update` 已是通用 `updates` 透传，无需改动签名；调用方传 `{ envVars: <json string> }`。如有 TS 类型定义需同步加 `envVars?: string | null`。

### 5.2 UI 组件

在 `room-settings-panel.tsx` 的「群规则」区块附近新增「环境变量」区块。该文件已较大，**抽出独立子组件** `room-env-vars-editor.tsx`（遵循单文件 ≤500 行规则）：

- 入参：当前 `envVars`（解析后的数组）、保存回调。
- 每行：
  - `key` 输入框（校验 `^[A-Za-z_][A-Za-z0-9_]*$`）；
  - `value` 输入框（`type=password`，默认遮罩，带眼睛图标切换明文/遮罩）；
  - `description` 输入框；
  - 删除按钮。
- 「+ 添加变量」按钮；区块级「保存」按钮（与现有 rules 保存交互一致）。
- 前端校验：key 非空、格式合法、不重复；不通过则禁用保存并提示。
- 保存：序列化为 JSON 字符串 → `chatRoomApi.update(roomId, { envVars })` → 成功后 `onChatRoomChange()`。
- 若响应含 `skippedReservedKeys`，toast 提示「以下保留键已被忽略：…」。

样式遵循项目 UI 规范（主题蓝、输入框/标签/按钮样式、自定义 toggle）。

## 6. 测试与验证

- **后端单测**（`server`，node:test）：
  - `parseRoomEnvVars`：合法/非法 JSON、非法 key 过滤、去重、缺省值。
  - `buildShellEnvFromRoomEnvVars`：保留键被跳过、`skippedKeys` 正确、普通键正确 merge。
- **端到端手测**：
  1. 建群 → 在设置面板添加 `TEST_KEY=hello` 与描述 → 保存。
  2. @ 助手让其执行 `echo $TEST_KEY`，确认输出 `hello`。
  3. 确认助手系统提示词中出现 `TEST_KEY` 及其 description，但**不含 value**。
  4. 添加保留键（如 `PATH`）→ 确认被忽略并有提示，且 shell 中 `PATH` 未被污染。

## 7. 影响范围与风险

- 触及：Prisma schema + migration、`executor-manager.ts`、`executor.factory.ts`、`claude-sdk.executor.ts`、`codex-sdk.executor.ts`、`agent-system-prompt.ts`、`chatroom.gateway.ts`、`chatroom.service.ts`、前端设置面板 + 新子组件。
- 执行器实例按 chatRoom-agent 缓存；环境变量变更后需保证下次执行使用新值。由于 executor 在每次 `getOrCreateExecutor` 时按缓存复用，**修改环境变量后应清理对应房间的 executor 缓存**（与 workDir 变更一致的处理），否则旧实例仍持有旧 env。此点在实现计划中需明确落实。
- 安全：value 明文落库、UI 可显示，属已确认的取舍；保留键护栏降低劫持执行器风险。

## 8. YAGNI / 不做的事

- 不做加密存储 / KMS。
- 不做独立 `ChatRoomEnvVar` 表。
- 不把环境变量注入执行器主进程 env，不支持用其改执行器自身行为。
- 不做助手级 / 用户级环境变量（仅群聊级）。
