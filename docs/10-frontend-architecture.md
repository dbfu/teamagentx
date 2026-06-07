# 10 · 前端架构

[English](10-frontend-architecture_EN.md) | 中文

> 覆盖 `apps/web/`（React Web）与 `apps/desktop/`（Electron 壳）

---

## 1. 目录结构

```
apps/web/src/
├── main.tsx                  # React 入口
├── App.tsx                   # 路由根组件（登录态判断）
├── components/
│   ├── auth/                 # 登录/注册弹框
│   ├── chat/                 # 主界面所有组件
│   │   ├── sidebar-nav.tsx       # 左侧导航栏（群聊列表/助手/技能/设置）
│   │   ├── conversation-list.tsx # 群聊会话列表
│   │   ├── chat-area.tsx         # 聊天主区域（消息列表 + 输入框）
│   │   ├── chat-area-header.tsx  # 顶部：群名/成员/工具栏
│   │   ├── chat-messages-list.tsx # 消息列表（虚拟滚动）
│   │   ├── chat-message.tsx       # 单条消息气泡
│   │   ├── chat-input-area.tsx    # 底部输入区（@mention + 图片）
│   │   ├── mention-input.tsx      # react-mentions @提及输入
│   │   ├── assistant-page.tsx     # 助手管理页
│   │   ├── skill-page.tsx         # 技能管理页
│   │   ├── model-page.tsx         # 模型配置页
│   │   ├── settings-page.tsx      # 设置页
│   │   ├── chat-side-panel/       # 右侧面板（多面板切换）
│   │   │   ├── agents-panel.tsx       # 群成员列表
│   │   │   ├── context-panel.tsx      # 助手上下文检视
│   │   │   ├── history-panel.tsx      # 执行历史
│   │   │   ├── stream-panel.tsx       # 流式输出面板
│   │   │   ├── record-detail-panel.tsx # 执行记录详情
│   │   │   ├── room-settings-panel.tsx # 群设置
│   │   │   ├── cron-tasks-panel.tsx   # 定时任务
│   │   │   └── task-queue-panel.tsx   # 任务队列
│   │   └── dialogs/               # 各类弹框
│   └── ui/                   # shadcn/ui 组件（new-york style）
├── stores/                   # Zustand 状态管理
│   ├── auth-store.ts         # 用户认证状态
│   ├── chat-store.ts         # 聊天核心状态（消息/面板/Socket 状态）
│   ├── chat-room-store.ts    # 群聊列表状态
│   ├── socket-store.ts       # Socket.io 连接与事件
│   └── ui-store.ts           # 全局 UI 状态
├── lib/                      # API 客户端与工具
│   ├── agent-api.ts          # 所有 REST API 调用
│   ├── auth-api.ts
│   ├── llm-provider-api.ts
│   ├── skill-api.ts
│   ├── cron-task-api.ts
│   ├── token-usage-api.ts
│   ├── prompt-optimize-api.ts
│   ├── config.ts             # getApiBaseUrl()（动态感知 Electron/Dev/Prod）
│   ├── image-utils.ts        # 图片压缩/Base64
│   └── message-sound.ts      # 消息提示音
└── hooks/
    ├── use-dark-mode.ts
    └── use-mobile.ts
```

---

## 2. Zustand Stores

### 2.1 `auth-store.ts`
存储登录用户信息、token。提供 `login()`、`logout()`、`loadUser()` 方法。

### 2.2 `socket-store.ts`
管理 Socket.io 连接生命周期，处理所有 socket 事件并将状态同步到其他 store。

关键类型：
```ts
type AgentStatus = 'idle' | 'executing' | 'pending' | 'interrupted'
type ToolCall = { name: string; input: any; output?: any; status: 'calling'|'done'|'error' }
type StreamEvent = { type: 'stream'|'thinking'|'tool_call'; content?: string; toolCall?: ToolCall }
```

### 2.3 `chat-room-store.ts`
群聊列表、当前选中群聊、未读数。

### 2.4 `chat-store.ts`
最大的 store，管理：
- `messages`：当前群聊消息列表
- `sidePanelMode`：右侧面板模式（`'agents'|'context'|'history'|'stream'|'agent-detail'|'record-detail'|'reply-detail'|'room-settings'|'cron-tasks'|'task-queue'|'task-board'|null`）
- `typingAgents`：正在处理的助手列表（按 chatRoomId）
- `streamingContent / streamingThinking`：流式内容缓冲
- `toolCalls`：工具调用状态（按 messageId）
- `streamEvents`：完整事件流（按 `messageId_agentId`）
- `agentStatuses`：助手状态（按 agentId）
- `agentQueueCounts`：队列数量
- `pendingImages`：待上传图片列表
- `scrollToMessageId / forceScrollToBottom`：滚动控制

### 2.5 `ui-store.ts`
侧边栏折叠、主题等全局 UI 状态。

---

## 3. 路由结构

`App.tsx` 根据 `auth-store` 中的登录状态决定：
- 未登录 → 显示 `LoginModal` / `RegisterModal`
- 已登录 → 主界面

主界面采用「左侧导航栏 + 内容区」布局：

| 导航项 | 组件 | 说明 |
|-------|-----|------|
| 群聊 | `conversation-list` + `chat-area` | 主聊天功能 |
| 助手 | `assistant-page` | CRUD 助手 |
| 技能 | `skill-page` | 安装/管理 Skill |
| 模型 | `model-page` | 配置 LLM Provider |
| 设置 | `settings-page` | 应用设置 |

---

## 4. API 客户端（`lib/agent-api.ts`）

所有 HTTP 请求通过 `getApiBaseUrl()` 动态获取 base URL，支持三种运行环境：

```
Electron       → window.electronAPI.getServerUrl() → http://localhost:11053
Dev 模式       → http://{hostname}:3001
打包 Web 模式  → window.location.origin（反向代理）
```

`VITE_API_BASE_URL` 环境变量可覆盖自动检测。

---

## 5. @Mention 输入

`mention-input.tsx` 封装 `react-mentions`：
- 触发字符：`@`
- 数据源：群聊中的助手成员列表
- 消息中的 `@助手名` 在渲染时高亮（`remark-mentions.ts` 插件）

---

## 6. 消息渲染

`chat-message.tsx` 处理：
- Markdown 渲染（`react-markdown` + 代码高亮）
- `@提及` 高亮
- 图片附件预览
- 工具调用展示（可展开）
- 思考链（可折叠）
- 流式内容追加（`streamingContent` Map 中查找）

---

## 7. 右侧面板系统

`chat-side-panel/index.tsx` 根据 `sidePanelMode` 切换渲染不同面板，面板通过 `chat-store` 中的 `setSidePanelMode()` 触发：

| 面板模式 | 触发方式 | 内容 |
|---------|---------|------|
| `agents` | 点击成员图标 | 群成员列表，可管理 |
| `context` | 点击助手卡片的「上下文」 | 助手在该群的完整上下文 |
| `history` | 点击助手卡片的「历史」 | 执行记录列表 |
| `stream` | 点击流式输出区域 | 完整的流式事件序列 |
| `record-detail` | 点击执行记录 | 事件详情（thinking/tool_call/stream） |
| `room-settings` | 点击设置图标 | 群名/规则/workDir/触发模式 |
| `cron-tasks` | 点击定时任务图标 | 群定时任务列表 |
| `task-queue` | 点击任务队列图标 | 助手任务队列 |
| `task-board` | 点击任务看板图标 | 所有助手任务汇总 |

---

## 8. Electron 集成

`apps/desktop/electron/preload.ts` 通过 `contextBridge` 暴露 `window.electronAPI`：

| API | 说明 |
|-----|------|
| `getServerUrl()` | 获取内嵌 backend 的 URL（`http://localhost:11053`） |
| `getAppVersion()` | 版本号 |
| `openExternal(url)` | 打开外部链接 |
| `showItemInFolder(path)` | 在 Finder/Explorer 中定位文件 |

Electron main process 通过 `utilityProcess` 启动 `server/src/electron-entry.ts`，将 `DATABASE_URL` 指向 userData 目录下的 SQLite 文件。

---

## 9. 移动端（Flutter）

`apps/mobile/` 结构：

```
lib/
├── main.dart
├── services/
│   ├── api_service.dart       # HTTP API 客户端
│   └── socket_service.dart    # Socket.io 客户端
├── stores/                    # Provider 状态
└── screens/                   # 页面
```

移动端通过 WebView 内嵌 Web 应用（`11054` 端口的移动 Web 入口），同时提供原生 QR 扫码连接功能（扫描桌面端 QR 码获取 IP）。

---

## 10. UI 规范

- 主题色：`blue-500`（主按钮），`bg-gray-50/border-gray-200`（次按钮）
- 组件库：shadcn/ui new-york style，组件在 `components/ui/`
- 弹框：参考 `create-assistant-modal.tsx`（固定定位 + 圆角 + 阴影）
- 输入框：`rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none`
- 路径别名：`@/*` → `apps/web/src/*`
