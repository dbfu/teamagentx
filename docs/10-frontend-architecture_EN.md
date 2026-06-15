# 10 · Frontend Architecture

[English](10-frontend-architecture_EN.md) | [中文](10-frontend-architecture.md)

> Covers `apps/web/` (React Web) and `apps/desktop/` (Electron shell)

---

## 1. Directory Structure

```
apps/web/src/
├── main.tsx                  # React entry point
├── App.tsx                   # Route root component (auth state判断)
├── components/
│   ├── auth/                 # Login/Register modals
│   ├── chat/                 # All main interface components
│   │   ├── sidebar-nav.tsx       # Left sidebar navigation (chatroom list/assistants/skills/settings)
│   │   ├── conversation-list.tsx # Chatroom conversation list
│   │   ├── chat-area.tsx         # Main chat area (message list + input box)
│   │   ├── chat-area-header.tsx  # Top: room name/members/toolbar
│   │   ├── chat-messages-list.tsx # Message list (virtual scrolling)
│   │   ├── chat-message.tsx       # Single message bubble
│   │   ├── chat-input-area.tsx    # Bottom input area (@mention + images)
│   │   ├── mention-input.tsx      # react-mentions @mention input
│   │   ├── conversation-list-item.tsx # Chatroom list item (with "running" badge)
│   │   ├── assistant-page.tsx     # Assistant management page
│   │   ├── skill-page.tsx         # Skill management page
│   │   ├── model-page.tsx         # Model configuration page
│   │   ├── settings-page.tsx      # Settings page (split into settings/ sub-sections)
│   │   ├── settings/             # Settings sub-sections (after the split)
│   │   │   ├── account-section.tsx / general-section.tsx / about-section.tsx
│   │   │   ├── software-section.tsx / sdk-tools-card.tsx
│   │   │   └── mobile-connect-card.tsx / qr-code-display.tsx
│   │   ├── chat-side-panel/       # Right side panel (multi-panel switching)
│   │   │   ├── agents-panel.tsx       # Room member list
│   │   │   ├── agent-detail-panel.tsx # Assistant details
│   │   │   ├── context-panel.tsx      # Assistant context inspection
│   │   │   ├── history-panel.tsx      # Execution history
│   │   │   ├── stream-panel.tsx       # Stream output panel
│   │   │   ├── record-detail-panel.tsx / reply-detail-panel.tsx
│   │   │   ├── room-settings-panel.tsx # Room settings
│   │   │   ├── room-env-vars-editor.tsx # Group env vars
│   │   │   ├── cron-tasks-panel.tsx   # Scheduled tasks
│   │   │   ├── task-queue-panel.tsx / task-board-panel.tsx
│   │   │   ├── claude-local-sessions-panel.tsx # Import local Claude sessions
│   │   │   └── work-dir-card.tsx
│   │   └── dialogs/               # Various modals
│   │       ├── room-rules-dialog.tsx          # Group rules
│   │       ├── room-dispatch-rules-dialog.tsx # Dispatch rules (workflow)
│   │       ├── dispatch-rules-flow/           # Dispatch-rule flowchart visualization
│   │       ├── room-env-vars-dialog.tsx       # Group env vars
│   │       ├── custom-command-modal.tsx       # Custom commands
│   │       ├── create-cron-task-modal.tsx / select-agents-dialog.tsx
│   │       └── add-agent-dialog.tsx / clear-messages-dialog.tsx / stop-all-tasks-dialog.tsx
│   ├── coordinator-log-panel.tsx  # Dispatch log panel
│   ├── coordinator-log-modal.tsx  # Dispatch log modal
│   ├── workbench/                 # Workbench "today tasks"
│   └── ui/                   # shadcn/ui components (new-york style)
├── stores/                   # Zustand state management
│   ├── auth-store.ts         # User authentication state
│   ├── chat-store.ts         # Chat core state (messages/panels/Socket state)
│   ├── chat-room-store.ts    # Chatroom list state
│   ├── socket-store.ts       # Socket.io connection and events
│   ├── custom-command-store.ts # Group custom-command state
│   └── ui-store.ts           # Global UI state
├── lib/                      # API clients and utilities
│   ├── agent-api.ts          # All REST API calls (incl. AgentTriggerMode type)
│   ├── dispatch-rules/       # Dispatch-rules schema (front-end validation)
│   ├── auth-api.ts / llm-provider-api.ts / skill-api.ts / cron-task-api.ts
│   ├── token-usage-api.ts / prompt-optimize-api.ts
│   ├── config.ts             # getApiBaseUrl() (dynamic Electron/Dev/Prod detection)
│   ├── image-utils.ts        # Image compression/Base64
│   └── message-sound.ts      # Message notification sound
├── i18n/locales/             # zh-CN.json / en-US.json
└── hooks/
    ├── use-dark-mode.ts
    └── use-mobile.ts
```

---

## 2. Zustand Stores

### 2.1 `auth-store.ts`
Stores logged-in user information and token. Provides `login()`, `logout()`, `loadUser()` methods.

### 2.2 `socket-store.ts`
Manages Socket.io connection lifecycle, handles all socket events and syncs state to other stores.

Key types:
```ts
type AgentStatus = 'idle' | 'executing' | 'pending' | 'interrupted'
type ToolCall = { name: string; input: any; output?: any; status: 'calling'|'done'|'error' }
type StreamEvent = { type: 'stream'|'thinking'|'tool_call'; content?: string; toolCall?: ToolCall }
```

### 2.3 `chat-room-store.ts`
Chatroom list, current selected chatroom, unread counts.

### 2.4 `chat-store.ts`
The largest store, manages:
- `messages`: Current chatroom message list
- `sidePanelMode`: Right panel mode (`'agents'|'context'|'history'|'stream'|'agent-detail'|'record-detail'|'reply-detail'|'room-settings'|'cron-tasks'|'task-queue'|'task-board'|null`)
- `typingAgents`: List of processing assistants (by chatRoomId)
- `streamingContent / streamingThinking`: Stream content buffer
- `toolCalls`: Tool call status (by messageId)
- `streamEvents`: Complete event stream (by `messageId_agentId`)
- `agentStatuses`: Assistant status (by agentId)
- `agentQueueCounts`: Queue counts
- `pendingImages`: Pending upload images list
- `scrollToMessageId / forceScrollToBottom`: Scroll control

### 2.5 `ui-store.ts`
Sidebar collapse, theme, and other global UI state.

### 2.6 `custom-command-store.ts`
Group custom command (`/commands`) state: fetch/cache a room's command list, offered when typing `/` in the input.

---

## 3. Route Structure

`App.tsx` determines based on login state in `auth-store`:
- Not logged in → Show `LoginModal` / `RegisterModal`
- Logged in → Main interface

Main interface uses "left sidebar + content area" layout:

| Nav Item | Component | Description |
|----------|-----------|-------------|
| Chatrooms | `conversation-list` + `chat-area` | Main chat functionality |
| Assistants | `assistant-page` | CRUD assistants |
| Skills | `skill-page` | Install/manage Skills |
| Models | `model-page` | Configure LLM Provider |
| Settings | `settings-page` | App settings |

---

## 4. API Client (`lib/agent-api.ts`)

All HTTP requests dynamically get base URL via `getApiBaseUrl()`, supporting three runtime environments:

```
Electron       → window.electronAPI.getServerUrl() → http://localhost:11053
Dev mode       → http://{hostname}:3001
Packaged Web   → window.location.origin (reverse proxy)
```

`VITE_API_BASE_URL` environment variable can override auto-detection.

---

## 5. @Mention Input

`mention-input.tsx` wraps `react-mentions`:
- Trigger character: `@`
- Data source: Assistant member list in chatroom
- `@assistant-name` in messages is highlighted during rendering (`remark-mentions.ts` plugin)

---

## 6. Message Rendering

`chat-message.tsx` handles:
- Markdown rendering (`react-markdown` + code highlighting)
- `@mention` highlighting
- Image attachment preview
- Tool call display (expandable)
- Chain of thought (collapsible)
- Stream content appending (lookup in `streamingContent` Map)

---

## 7. Right Side Panel System

`chat-side-panel/index.tsx` renders different panels based on `sidePanelMode`, panels are triggered via `setSidePanelMode()` in `chat-store`:

| Panel Mode | Trigger Method | Content |
|------------|----------------|---------|
| `agents` | Click member icon | Room member list, manageable |
| `context` | Click "Context" on assistant card | Full context of assistant in this room |
| `history` | Click "History" on assistant card | Execution record list |
| `stream` | Click stream output area | Complete stream event sequence |
| `record-detail` | Click execution record | Event details (thinking/tool_call/stream) |
| `room-settings` | Click settings icon | Room name/rules/workDir/trigger mode (Smart Collaboration vs Manual) |
| `cron-tasks` | Click scheduled task icon | Room scheduled task list |
| `task-queue` | Click task queue icon | Assistant task queue |
| `task-board` | Click task board icon | All assistant tasks summary |
| `agent-detail` / `reply-detail` | Click assistant card / quoted message | Assistant details / quoted-message details |

In addition, these are triggered as standalone dialogs/panels (not via `sidePanelMode`):
- **Dispatch rules** (`room-dispatch-rules-dialog` + `dispatch-rules-flow`): read-only flowchart + YAML source editing + multi-workflow tabs, re-fetched on open
- **Group env vars** (`room-env-vars-dialog`), **custom commands** (`custom-command-modal`)
- **Dispatch log** (`coordinator-log-panel` / `coordinator-log-modal`): view Group Coordinator decisions
- **Local session import** (`claude-local-sessions-panel`): bind local Claude/Codex sessions to a quick chat
- **Workbench "today tasks"** (`components/workbench/`)

---

## 8. Electron Integration

`apps/desktop/electron/preload.ts` exposes `window.electronAPI` via `contextBridge`:

| API | Description |
|-----|-------------|
| `getServerUrl()` | Get embedded backend URL (`http://localhost:11053`) |
| `getAppVersion()` | Version number |
| `openExternal(url)` | Open external link |
| `showItemInFolder(path)` | Locate file in Finder/Explorer |

Electron main process starts `server/src/electron-entry.ts` via `utilityProcess`, pointing `DATABASE_URL` to SQLite file under userData directory.

---

## 9. Mobile (Flutter)

`apps/mobile/` structure:

```
lib/
├── main.dart
├── services/
│   ├── api_service.dart       # HTTP API client
│   └── socket_service.dart    # Socket.io client
├── stores/                    # Provider state
└── screens/                   # Pages
```

Mobile embeds Web app via WebView (mobile Web entry on port `11054`), and provides native QR scan connection functionality (scan desktop QR code to get IP).

---

## 10. UI Guidelines

- Primary color: `blue-500` (primary buttons), `bg-gray-50/border-gray-200` (secondary buttons)
- Component library: shadcn/ui new-york style, components in `components/ui/`
- Modals: Reference `create-assistant-modal.tsx` (fixed positioning + rounded corners + shadow)
- Input boxes: `rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none`
- Path alias: `@/*` → `apps/web/src/*`