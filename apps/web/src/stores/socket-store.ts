import { create } from 'zustand'
import { io, Socket } from 'socket.io-client'
import { useChatStore } from './chat-store'
import { getApiBaseUrl } from '@/lib/config'

// 兼容 Android WebView 的 UUID 生成函数
function generateUUID(): string {
  // 优先使用 crypto.randomUUID（如果可用）
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // 回退方案：手动生成 UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ToolCall 类型定义
export interface ToolCall {
  name: string
  input: Record<string, unknown>
  toolCallId: string
  status?: 'in_progress' | 'completed' | 'error'
  output?: string | Record<string, unknown>
}

// 流式事件块类型
export interface StreamEvent {
  id: string
  type: 'thinking' | 'tool_call' | 'output'
  content?: string
  toolCall?: ToolCall
  status?: 'in_progress' | 'completed' | 'error'
  timestamp: number  // 开始时间（毫秒）
  endTime?: number   // 结束时间（毫秒），仅在 completed/error 时设置
}

// Agent 执行状态
export type AgentStatus = 'idle' | 'executing' | 'busy'

// Socket 事件数据类型
export interface SocketMessage {
  id: string
  type: 'message' | 'reply'
  content: string
  time: Date | string
  user?: string
  userId?: string | null
  agentId?: string
  agentName?: string
  avatar?: string | null
  avatarColor?: string | null
  chatRoomId: string
  replyMessageId?: string | null
  isHuman?: boolean
  attachments?: SocketAttachment[]
}

// Socket 附件类型
export interface SocketAttachment {
  url: string
  filename: string
  mimeType: string
  size: number
  width?: number
  height?: number
  base64?: string
}

interface SystemMessage {
  text: string
  chatRoomId: string
}

interface JoinedResponse {
  socketId: string
  username: string
  user?: {
    id: string
    username: string
    avatar: string | null
    avatarColor: string | null
  }
}

interface AgentTypingData {
  messageId: string
  agentId: string
  agentName: string
  status?: 'pending' | 'executing'
}

interface AgentDoneData {
  agentId: string
  agentName: string
  triggerMessageId: string
  executionRecordId?: string
  messageIds?: string[]
  duration?: number | null
  totalTokens?: number | null
  cacheReadTokens?: number | null
}

interface AgentStreamData {
  messageId: string
  agentId: string
  agentName: string
  content: string
}

interface AgentThinkingData {
  messageId: string
  agentId: string
  agentName: string
  thinking: string
}

interface AgentToolCallData {
  messageId: string
  agentId: string
  agentName: string
  toolCall: ToolCall
}

interface AgentStatusData {
  chatRoomId: string
  statuses: Record<string, AgentStatus>
  queueCounts?: Record<string, number>  // agentId -> queue count
}

// 未读数更新事件数据类型
export interface UnreadUpdateData {
  chatRoomId?: string
  count?: number
  unreadCounts?: Record<string, number>
}

// Agent 恢复事件数据类型（切回来恢复状态，不清理已有数据）
export interface AgentResumeData {
  messageId: string
  agentId: string
  agentName: string
}

// 缓存的流式事件数据类型
export interface CachedStreamEventData {
  chatRoomId: string
  messageId: string
  agentId: string
  events: StreamEvent[]
}

interface AgentStoppedData {
  chatRoomId: string
  agentId: string
}

interface AgentTaskQueueData {
  chatRoomId: string
  agentId: string
  tasks: {
    id: string
    messageId: string
    messageContent: string
    status: string
    createdAt: string
  }[]
}

// 任务取消事件数据
interface AgentTaskCancelledData {
  chatRoomId: string
  agentId: string
  taskId: string
  messageId: string
}

// 任务恢复事件数据
interface AgentTaskResumedData {
  chatRoomId: string
  agentId: string
  taskId: string
}

// 非活跃任务数据
interface InactiveTasksData {
  chatRoomId: string
  tasks: {
    id: string
    agentId: string
    agentName: string
    messageId: string
    messageContent: string
    status: string
    createdAt: string
  }[]
}

// Todo 数据类型
export interface TodoData {
  id: string
  chatRoomId: string
  messageId: string
  triggerAgentId: string
  triggerAgentName: string
  ownerUserId: string
  contentSummary: string
  chatRoomName: string
  status: string
  createdAt: string | Date
}

// 群聊创建事件数据类型
export interface ChatRoomCreatedData {
  chatRoom: {
    id: string
    name: string
    avatar: string | null
    avatarColor: string | null
    description: string | null
    isPinned: boolean
    pinnedAt: string | null
    createdAt: string
    lastMessage: null
  }
}

interface SocketStore {
  socket: Socket | null
  isConnected: boolean
  username: string | null
  user: JoinedResponse['user'] | null
  currentChatRoomId: string | null
  todos: TodoData[]  // 待办列表

  // Actions
  connect: (token: string) => Promise<void>
  disconnect: () => void
  joinChatRoom: (chatRoomId: string) => void
  leaveChatRoom: (chatRoomId: string) => void
  sendMessage: (message: { chatRoomId: string; content: string; isHuman?: boolean; attachments?: SocketAttachment[] }) => void
  setCurrentChatRoomId: (id: string | null) => void

  // Event listeners (返回 unsubscribe 函数)
  onMessage: (callback: (message: SocketMessage) => void) => () => void
  onSystem: (callback: (message: SystemMessage) => void) => () => void
  onError: (callback: (error: { message: string }) => void) => () => void
  onAgentTyping: (callback: (data: AgentTypingData) => void) => () => void
  onAgentDone: (callback: (data: AgentDoneData) => void) => () => void
  onAgentStream: (callback: (data: AgentStreamData) => void) => () => void
  onAgentThinking: (callback: (data: AgentThinkingData) => void) => () => void
  onAgentToolCall: (callback: (data: AgentToolCallData) => void) => () => void
  onAgentStatus: (callback: (data: AgentStatusData) => void) => () => void
  requestAgentStatus: (chatRoomId: string) => void
  onAgentResume: (callback: (data: AgentResumeData) => void) => () => void
  onCachedEvents: (callback: (data: CachedStreamEventData) => void) => () => void
  stopAgent: (chatRoomId: string, agentId: string) => void
  onAgentStopped: (callback: (data: AgentStoppedData) => void) => () => void
  requestAgentTaskQueue: (chatRoomId: string, agentId: string) => void
  onAgentTaskQueue: (callback: (data: AgentTaskQueueData) => void) => () => void
  cancelTask: (chatRoomId: string, taskId: string) => void
  onAgentTaskCancelled: (callback: (data: AgentTaskCancelledData) => void) => () => void
  resumeTask: (chatRoomId: string, taskId: string) => void
  onAgentTaskResumed: (callback: (data: AgentTaskResumedData) => void) => () => void
  requestInactiveTasks: (chatRoomId: string) => void
  onInactiveTasks: (callback: (data: InactiveTasksData) => void) => () => void
  onChatRoomCreated: (callback: (data: ChatRoomCreatedData) => void) => () => void

  // 未读消息相关方法
  markChatRoomRead: (chatRoomId: string) => void
  onUnreadUpdate: (callback: (data: UnreadUpdateData) => void) => () => void
  requestUnreadCounts: () => void

  // Todo 相关方法
  requestTodos: () => void
  onTodoList: (callback: (data: { todos: TodoData[] }) => void) => () => void
  onTodoCreated: (callback: (todo: TodoData) => void) => () => void
  completeTodo: (todoId: string) => void
  dismissTodo: (todoId: string) => void
  onTodoUpdated: (callback: (data: { todoId: string; status: string }) => void) => () => void

  // 内部方法：处理 socket 事件并更新 chat-store
  _handleAgentTyping: (data: AgentTypingData) => void
  _handleAgentDone: (data: AgentDoneData) => void
  _handleAgentStream: (data: AgentStreamData) => void
  _handleAgentThinking: (data: AgentThinkingData) => void
  _handleAgentToolCall: (data: AgentToolCallData) => void
}

export const useSocketStore = create<SocketStore>((set, get) => ({
  socket: null,
  isConnected: false,
  username: null,
  user: null,
  currentChatRoomId: null,
  todos: [],

  connect: async (token: string) => {
    const baseUrl = await getApiBaseUrl()
    // Disconnect existing socket if any
    const existingSocket = get().socket
    if (existingSocket) {
      existingSocket.disconnect()
    }

    const socketInstance = io(baseUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      auth: {
        token,
      },
    })

    socketInstance.on('connect', () => {
      console.log('Socket connected:', socketInstance.id)
      set({ isConnected: true })
    })

    socketInstance.on('disconnect', () => {
      console.log('Socket disconnected')
      set({ isConnected: false })
    })

    socketInstance.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message)
      set({ isConnected: false })
    })

    socketInstance.on('joined', (data: JoinedResponse) => {
      set({
        username: data.username,
        user: data.user || null,
      })
    })

    set({ socket: socketInstance })
  },

  disconnect: () => {
    const socket = get().socket
    if (socket) {
      socket.disconnect()
      set({
        socket: null,
        isConnected: false,
        username: null,
        user: null,
      })
    }
  },

  joinChatRoom: (chatRoomId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('chatroom:join', chatRoomId)
    set({ currentChatRoomId: chatRoomId })
  },

  leaveChatRoom: (chatRoomId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('chatroom:leave', chatRoomId)
  },

  sendMessage: (message) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('message', {
      id: generateUUID(),
      type: 'message',
      content: message.content,
      time: new Date(),
      chatRoomId: message.chatRoomId,
      isHuman: message.isHuman ?? true,
      attachments: message.attachments,
    })
  },

  setCurrentChatRoomId: (id) => set({ currentChatRoomId: id }),

  // Event listeners
  onMessage: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('message', callback)
    return () => socket?.off('message', callback)
  },

  onSystem: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('system', callback)
    return () => socket?.off('system', callback)
  },

  onError: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('error', callback)
    return () => socket?.off('error', callback)
  },

  onAgentTyping: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:typing', callback)
    return () => socket?.off('agent:typing', callback)
  },

  onAgentDone: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:done', callback)
    return () => socket?.off('agent:done', callback)
  },

  onAgentStream: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:stream', callback)
    return () => socket?.off('agent:stream', callback)
  },

  onAgentThinking: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:thinking', callback)
    return () => socket?.off('agent:thinking', callback)
  },

  onAgentToolCall: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:tool_call', callback)
    return () => socket?.off('agent:tool_call', callback)
  },

  onAgentStatus: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:status', callback)
    return () => socket?.off('agent:status', callback)
  },

  requestAgentStatus: (chatRoomId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('agent:status', chatRoomId)
  },

  onAgentResume: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:resume', callback)
    return () => socket?.off('agent:resume', callback)
  },

  onCachedEvents: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:cached-events', callback)
    return () => socket?.off('agent:cached-events', callback)
  },

  stopAgent: (chatRoomId: string, agentId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('agent:stop', { chatRoomId, agentId })
  },

  onAgentStopped: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:stopped', callback)
    return () => socket?.off('agent:stopped', callback)
  },

  requestAgentTaskQueue: (chatRoomId: string, agentId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('agent:task-queue', { chatRoomId, agentId })
  },

  onAgentTaskQueue: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:task-queue', callback)
    return () => socket?.off('agent:task-queue', callback)
  },

  cancelTask: (chatRoomId: string, taskId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('agent:task-cancel', { chatRoomId, taskId })
  },

  onAgentTaskCancelled: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:task-cancelled', callback)
    return () => socket?.off('agent:task-cancelled', callback)
  },

  resumeTask: (chatRoomId: string, taskId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('agent:task-resume', { chatRoomId, taskId })
  },

  onAgentTaskResumed: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:task-resumed', callback)
    return () => socket?.off('agent:task-resumed', callback)
  },

  requestInactiveTasks: (chatRoomId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('agent:inactive-tasks', chatRoomId)
  },

  onInactiveTasks: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('agent:inactive-tasks', callback)
    return () => socket?.off('agent:inactive-tasks', callback)
  },

  onChatRoomCreated: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('chatroom:created', callback)
    return () => socket?.off('chatroom:created', callback)
  },

  // 未读消息相关方法
  markChatRoomRead: (chatRoomId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('chatroom:mark-read', chatRoomId)
  },

  onUnreadUpdate: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('unread:update', callback)
    return () => socket?.off('unread:update', callback)
  },

  requestUnreadCounts: () => {
    const socket = get().socket
    if (!socket) return
    socket.emit('unread:request')
  },

  // 内部方法：处理 socket 事件并更新 chat-store
  _handleAgentTyping: (data) => {
    const chatRoomId = get().currentChatRoomId
    if (!chatRoomId) return

    const { typingAgents, completedAgents, toolCalls, streamingThinking, streamingContent } = useChatStore.getState()

    // 更新 typing agents
    const newTypingAgents = new Map(typingAgents)
    const existing = newTypingAgents.get(data.messageId) ?? []
    const existingIndex = existing.findIndex(a => a.agentId === data.agentId)
    if (existingIndex >= 0) {
      const updated = [...existing]
      updated[existingIndex] = {
        ...updated[existingIndex],
        agentName: data.agentName,
        status: data.status ?? updated[existingIndex].status,
      }
      newTypingAgents.set(data.messageId, updated)
    } else {
      newTypingAgents.set(data.messageId, [...existing, { agentId: data.agentId, agentName: data.agentName, status: data.status }])
    }

    // 新任务开始时，从已完成列表中移除
    const newCompletedAgents = new Set(completedAgents)
    newCompletedAgents.delete(data.agentId)

    // 清空工具调用、思考过程和输出内容
    const newToolCalls = new Map(toolCalls)
    newToolCalls.delete(data.agentId)

    const newStreamingThinking = new Map(streamingThinking)
    newStreamingThinking.delete(data.agentId)

    const newStreamingContent = new Map(streamingContent)
    newStreamingContent.delete(data.agentId)

    useChatStore.setState({
      typingAgents: newTypingAgents,
      completedAgents: newCompletedAgents,
      toolCalls: newToolCalls,
      streamingThinking: newStreamingThinking,
      streamingContent: newStreamingContent,
    })
  },

  _handleAgentDone: (data) => {
    const { completedAgents, typingAgents, messages } = useChatStore.getState()

    // 标记为已完成
    const newCompletedAgents = new Set(completedAgents)
    newCompletedAgents.add(data.agentId)

    // 移除 typing 状态
    const newTypingAgents = new Map(typingAgents)
    for (const [messageId, agents] of newTypingAgents) {
      const filtered = agents.filter(a => a.agentId !== data.agentId)
      if (filtered.length === 0) {
        newTypingAgents.delete(messageId)
      } else {
        newTypingAgents.set(messageId, filtered)
      }
    }

    // 更新消息的 executionRecordId、executionDuration 和 totalTokens
    const newMessages = [...messages]
    if (data.messageIds && data.messageIds.length > 0 && data.executionRecordId) {
      for (const msgId of data.messageIds) {
        const msgIndex = newMessages.findIndex(m => m.id === msgId)
        if (msgIndex >= 0) {
          newMessages[msgIndex] = {
            ...newMessages[msgIndex],
            executionRecordId: data.executionRecordId,
            executionDuration: data.duration ?? null,
            totalTokens: data.totalTokens ?? null,
            cacheReadTokens: data.cacheReadTokens ?? null,
          }
        }
      }
    }

    useChatStore.setState({
      completedAgents: newCompletedAgents,
      typingAgents: newTypingAgents,
      messages: newMessages,
    })
  },

  _handleAgentStream: (data) => {
    const chatRoomId = get().currentChatRoomId
    if (!chatRoomId) return

    const { streamingContent } = useChatStore.getState()
    const newStreamingContent = new Map(streamingContent)
    newStreamingContent.set(data.agentId, data.content)

    useChatStore.setState({ streamingContent: newStreamingContent })
  },

  _handleAgentThinking: (data) => {
    const chatRoomId = get().currentChatRoomId
    if (!chatRoomId) return

    const { streamingContent, streamingThinking } = useChatStore.getState()

    // 收到新的 thinking 时，清空之前的输出内容
    const newStreamingContent = new Map(streamingContent)
    newStreamingContent.delete(data.agentId)

    const newStreamingThinking = new Map(streamingThinking)
    newStreamingThinking.set(data.agentId, data.thinking)

    useChatStore.setState({
      streamingContent: newStreamingContent,
      streamingThinking: newStreamingThinking,
    })
  },

  _handleAgentToolCall: (data) => {
    const chatRoomId = get().currentChatRoomId
    if (!chatRoomId) return

    const { toolCalls } = useChatStore.getState()
    const newToolCalls = new Map(toolCalls)
    const existing = newToolCalls.get(data.agentId) ?? []

    // 查找是否已存在该工具调用
    const existingIndex = existing.findIndex(tc => tc.toolCallId === data.toolCall.toolCallId)
    if (existingIndex >= 0) {
      // 更新现有工具调用
      const updated = [...existing]
      updated[existingIndex] = data.toolCall
      newToolCalls.set(data.agentId, updated)
    } else {
      // 添加新工具调用
      newToolCalls.set(data.agentId, [...existing, data.toolCall])
    }

    useChatStore.setState({ toolCalls: newToolCalls })
  },

  // Todo 相关方法
  requestTodos: () => {
    const socket = get().socket
    if (!socket) return
    socket.emit('todo:request')
  },

  onTodoList: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('todo:list', callback)
    return () => socket?.off('todo:list', callback)
  },

  onTodoCreated: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('todo:created', callback)
    return () => socket?.off('todo:created', callback)
  },

  completeTodo: (todoId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('todo:complete', { todoId })
  },

  dismissTodo: (todoId: string) => {
    const socket = get().socket
    if (!socket) return
    socket.emit('todo:dismiss', { todoId })
  },

  onTodoUpdated: (callback) => {
    const socket = get().socket
    if (!socket) return () => {}
    socket.on('todo:updated', callback)
    return () => socket?.off('todo:updated', callback)
  },
}))
