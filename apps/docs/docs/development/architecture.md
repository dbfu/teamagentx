# 架构概览

## 项目结构

TeamAgentX 采用 Monorepo 结构：

```
teamagentx/
├── apps/
│   ├── web/          # React 前端
│   ├── desktop/      # Electron 桌面版
│   ├── mobile/       # Flutter 移动端
│   └── docs/         # VitePress 文档
├── server/           # Fastify 后端
├── packages/         # 共享包
└── docs/             # 项目文档
```

## 核心模块

### 后端服务 (server/)

- **Fastify 5**: 高性能 HTTP 服务
- **Socket.io**: 实时通信
- **Prisma 7**: 数据库 ORM
- **LangChain/LangGraph**: 智能体执行
- **ACP SDKs**: Claude/Codex 集成

### 前端应用 (apps/web/)

- **React 19**: UI 框架
- **Vite 6**: 构建工具
- **Tailwind CSS 4**: 样式系统
- **shadcn/ui**: UI 组件库
- **Zustand**: 状态管理

### 桌面版 (apps/desktop/)

- **Electron 41**: 桌面框架
- **electron-builder**: 打包工具
- **utilityProcess**: 后端嵌入

### 移动端 (apps/mobile/)

- **Flutter/Dart**: 移动框架
- **Provider**: 状态管理
- **go_router**: 路由
- **socket_io_client**: 实时通信

## 数据模型

### 核心实体

- `Agent`: 智能体定义
- `LlmProvider`: LLM 配置
- `ChatRoom`: 聊天室
- `Message`: 消息记录
- `TaskQueue`: 任务队列
- `ExecutionRecord`: 执行记录
- `AgentRoomMemory`: 房间记忆
- `CronTask`: 定时任务

### 关系图

```
User ── owns ──> ChatRoom
       │
       └── participates ──> ChatRoomAgent <── contains ──> Agent
                                        │
ChatRoom ── has ──> Message ── has ──> Attachment
       │           │
       │           └── triggers ──> TaskQueue ──> ExecutionRecord
       │
       └── has ──> CronTask
       │
       └── has ──> AgentRoomMemory
```

## 实时通信

### Socket.io 事件

**房间事件**:
- `message`: 新消息
- `agent:typing`: 智能体正在输入
- `agent:stream`: 流式响应
- `agent:thinking`: 思考过程
- `agent:tool_call`: 工具调用
- `agent:done`: 执行完成
- `agent:status`: 状态更新

**用户事件**:
- `unread:update`: 未读更新

### 房间命名

- 聊天室: `chatRoom:<id>`
- 用户: `user:<id>`

## 智能体执行系统

### 执行器工厂

```typescript
ExecutorFactory.create(agent) →
  LangChainAgentExecutor |
  ClaudeAgentSdkExecutor |
  CodexSdkExecutor |
  AcpExecutor
```

### 任务队列

1. 任务进入队列
2. 按聊天室-智能体分组
3. 顺序处理
4. 支持中断和恢复

### 缓存机制

- 按聊天室-智能体缓存执行器
- 保持会话和记忆隔离
- 设置变更时清除缓存