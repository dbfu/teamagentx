# StreamPanel 组件逻辑梳理

## 一、整体架构

```
┌─────────────────────────────────────────┐
│  固定区域 (shrink-0 px-3 pt-3)           │
│  ├── 状态栏（处理中/已完成 + 停止按钮）   │
│  └── 任务清单（TodoWrite 工具的输出）     │ ← OverlayScrollArea, max-h-24
├─────────────────────────────────────────┤
│  滚动区域 (min-h-0 flex-1)               │ ← OverlayScrollArea
│  ├── 思考过程卡片 (thinking)             │
│  ├── 工具调用卡片 (tool_call)            │
│  └── 输出内容卡片 (output)               │
├─────────────────────────────────────────┤
│  新消息提示按钮（悬浮在底部）             │ ← showNewMessageHint 控制
└─────────────────────────────────────────┘
```

---

## 二、数据层

### 2.1 输入 Props

| Prop | 类型 | 说明 |
|------|------|------|
| `streamingViewAgent` | `{ messageId, agentId, name } | null` | 当前正在流式输出的 Agent 信息 |
| `messageStartTime` | `number` | 消息开始时间（用于总耗时计算） |
| `completedAgents` | `Set<string>` | 已完成的 Agent key 集合 |
| `streamEvents` | `Map<string, StreamEvent[]>` | 按 messageId_agentId 分组的流式事件 |
| `chatRoomId` | `string` | 聊天室 ID（用于停止按钮） |
| `onStop` | `(agentId, messageId?) => void` | 停止执行回调 |

### 2.2 StreamEvent 类型

```typescript
type StreamEvent = {
  id: string
  type: 'thinking' | 'tool_call' | 'output'
  timestamp: number
  endTime?: number          // 完成时设置
  content?: string          // thinking/output 的内容
  toolCall?: {
    name: string
    status: 'in_progress' | 'completed' | 'error'
    input?: object
    output?: unknown
  }
}
```

### 2.3 数据派生逻辑

```typescript
// 1. 计算 streamKey（用于从 Map 中取数据）
const streamKey = streamingViewAgent 
  ? `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}` 
  : ''

// 2. 获取当前 streamKey 的事件列表
const events = streamingViewAgent 
  ? (streamEvents.get(streamKey) || []) 
  : []

// 3. 从事件中提取 TodoWrite 工具数据（单独显示在固定区域）
const todosEvent = events.find(e => 
  e.type === 'tool_call' && 
  ['write_todos', 'TodoWrite'].includes(e.toolCall?.name)
)
const todos = todosEvent?.toolCall?.input.todos || []

// 4. 过滤掉 TodoWrite 事件（不在滚动区域显示）
const displayEvents = events.filter(e => 
  !(e.type === 'tool_call' && ['write_todos', 'TodoWrite'].includes(e.toolCall?.name))
)

// 5. 计算执行状态
const completedKey = streamingViewAgent 
  ? `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}` 
  : ''
const isExecuting = streamingViewAgent && !completedAgents.has(completedKey)
```

---

## 三、自动滚动系统（最复杂的部分）

### 3.1 核心概念

**「贴底意图」(isAtBottomRef)**：
- 用户滚动到底部 → 设置为 `true`
- 用户向上滚动 → 设置为 `false`
- 用 `ref` 而非 `state`，因为：
  1. 渲染只依赖 `showNewMessageHint`，不需要触发重渲染
  2. 异步回调（setTimeout、事件监听）需要读取最新值

**「程序滚动标记」(autoScrollingRef)**：
- 程序调用 `stickToBottom()` 前，设置为 `true`
- `scroll` 事件触发时，检测到 `true` 则忽略本次事件
- 避免流式内容增长时被误判为「用户离开了底部」

### 3.2 三层监听机制

```
┌──────────────────────────────────────────────────────┐
│ Layer 1: scroll 事件监听                             │
│ - 监听用户手动滚动                                    │
│ - 检测是否在底部（scrollTop + clientHeight >=        │
│   scrollHeight - threshold）                         │
│ - 忽略程序触发的滚动（autoScrollingRef）              │
└──────────────────────────────────────────────────────┘
         ↓ 更新 isAtBottomRef
┌──────────────────────────────────────────────────────┐
│ Layer 2: ResizeObserver 监听                         │
│ - 监听内容高度变化（折叠/展开不触发 scroll 事件）      │
│ - 如果贴底意图存在，继续保持贴底                      │
│ - 如果内容收起导致底部可见，同步清除提示              │
└──────────────────────────────────────────────────────┘
         ↓ 调用 stickToBottom 或更新状态
┌──────────────────────────────────────────────────────┐
│ Layer 3: 内容变化监听 (useEffect + totalContent)     │
│ - totalContent 变化 → setTimeout 后执行              │
│ - 贴底 → 自动滚动到底部                               │
│ - 不贴底 → 显示「有新内容」提示                       │
└──────────────────────────────────────────────────────┘
```

### 3.3 关键函数

**stickToBottom(container)**：
```typescript
const stickToBottom = (container: HTMLDivElement) => {
  // 已在底部时不触发滚动（避免残留 autoScrollingRef 标记）
  const maxScrollTop = container.scrollHeight - container.clientHeight
  if (container.scrollTop >= maxScrollTop) return
  
  // 标记本次滚动是程序触发
  autoScrollingRef.current = true
  container.scrollTop = container.scrollHeight
}
```

**handleScroll()**：
```typescript
const handleScroll = () => {
  // 忽略程序触发的事件
  if (autoScrollingRef.current) {
    autoScrollingRef.current = false
    return
  }
  
  // 判断是否在底部
  const atBottom = scrollTop + clientHeight >= scrollHeight - threshold
  setAtBottom(atBottom)
  
  // 用户滚动到底部，清除提示
  if (atBottom) setShowNewMessageHint(false)
}
```

### 3.4 为什么用 setTimeout？

```typescript
useEffect(() => {
  if (totalContent === prevTotalContentRef.current) return
  prevTotalContentRef.current = totalContent
  
  setTimeout(() => {
    // 这里读取 ref，拿到最新的贴底意图
    if (isAtBottomRef.current) {
      stickToBottom(c)
    } else {
      setShowNewMessageHint(true)
    }
  }, 0)
}, [totalContent])
```

原因：React 的 useEffect 在渲染后同步执行，但 DOM 更新是异步的。用 `setTimeout(0)` 确保在 DOM 更新完成后再滚动。

---

## 四、任务清单滚动逻辑

### 4.1 目标
当 `in_progress` 任务变化时，自动滚动到该任务使其可见。

### 4.2 实现细节

```typescript
// 查找正在执行的任务
const inProgressIndex = todos.findIndex(t => t.status === 'in_progress')
const inProgressKey = `${streamKey}:${inProgressIndex}:${todo.content}`

// 任务变化时滚动
useEffect(() => {
  // 1. 任务未找到 / 未变化 → 不处理
  if (inProgressIndex === -1 || inProgressKey === prevInProgressKeyRef.current) return
  
  // 2. 找到对应 DOM 元素（通过 data-todo-index 属性）
  const todoElements = container.querySelectorAll('[data-todo-index]')
  const targetElement = todoElements[inProgressIndex]
  
  // 3. 计算是否在可视区域内
  const containerRect = container.getBoundingClientRect()
  const elementRect = targetElement.getBoundingClientRect()
  
  // 4. 任务在上方 → 向上滚动
  if (elementRect.top < containerRect.top) {
    nextScrollTop += elementRect.top - containerRect.top - padding
  }
  
  // 5. 任务在下方 → 向下滚动
  if (elementRect.bottom > containerRect.bottom) {
    nextScrollTop += elementRect.bottom - containerRect.bottom + padding
  }
  
  // 6. 平滑滚动
  container.scrollTo({ top: nextScrollTop, behavior: 'smooth' })
  
  // 7. 记录已处理，避免重复滚动
  prevInProgressKeyRef.current = inProgressKey
}, [inProgressIndex, inProgressKey])
```

---

## 五、时间显示逻辑

### 5.1 TimeIndicator（单个事件）

- **开始时间**：`formatStartTime(timestamp)` → `HH:MM:SS`
- **持续时间**：每秒更新（未完成时），完成后固定

```typescript
useEffect(() => {
  if (isFinal) return  // 已完成不更新
  setInterval(() => setNow(Date.now()), 1000)
}, [isFinal])
```

### 5.2 TotalTimeIndicator（总耗时）

- 从 `messageStartTime` 或第一个事件时间开始计算
- 执行中每秒更新，完成后取最后一个事件的 endTime

---

## 六、UI 渲染逻辑

### 6.1 卡片类型

| 类型 | 颜色 | 图标 | 默认展开 |
|------|------|------|---------|
| thinking | amber（思考） | 🧠 | ✅ |
| tool_call (in_progress) | purple | 🔧 | ❌ |
| tool_call (completed) | green | ✅ | ❌ |
| tool_call (error) | red | ✗ | ❌ |
| output | primary（蓝） | 📤 | ✅ |

### 6.2 工具名称截断

```typescript
// truncateToolName 截断长工具名
// 例如: "mcp__gitnexus__query" → "gitnexus.query"

// UI 上根据屏幕宽度限制显示宽度
className="truncate max-w-[12rem] shrink sm:max-w-[18rem] lg:max-w-[24rem] xl:max-w-[30rem]"
```

---

## 七、边界情况处理

### 7.1 空状态

```typescript
// 没有选中 Agent
if (!streamingViewAgent) return '暂无内容'

// Agent 正在执行但还没有事件
if (displayEvents.length === 0 && todos.length === 0) {
  return <Loader2>执行中...</Loader2>
}
```

### 7.2 streamKey 变化

```typescript
// 切换 Agent 时重置状态
useEffect(() => {
  prevInProgressKeyRef.current = ''
  todosContainerRef.current.scrollTop = 0
}, [streamKey])
```

### 7.3 长文本溢出

- 长链接：`<a className="break-all">` 强制换行
- JSON 输出：`overflow-hidden` + `break-all`
- 任务内容：`truncate` 单行截断

---

## 八、性能考虑

1. **用 ref 替代 state**：`isAtBottomRef`、`autoScrollingRef` 不触发重渲染
2. **定时器清理**：所有 `setInterval` 都在 `useEffect` 清理函数中 `clearInterval`
3. **ResizeObserver 清理**：在 `useEffect` 清理函数中 `disconnect`
4. **事件去重**：`prevTotalContentRef`、`prevInProgressKeyRef` 防止重复处理

---

## 九、潜在改进点

1. **时间更新优化**：可以用单个全局定时器，而不是每个 TimeIndicator 都创建一个
2. **totalContent 计算**：用 JSON.stringify 可能更可靠，目前用字符串拼接可能误判变化
3. **滚动阈值**：`scrollThreshold = 50` 是固定值，可考虑根据容器高度动态计算
4. **代码拆分**：组件已接近 500 行，可考虑拆分：
   - `useAutoScroll` hook（滚动逻辑）
   - `useTodosScroll` hook（任务清单滚动）
   - `StreamEventCard` 子组件（卡片渲染）