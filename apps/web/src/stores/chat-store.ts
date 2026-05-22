import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createElement, useRef, useCallback, useEffect, useMemo } from 'react'
import { Agent, Message, messageApi, agentApi, ExecutionRecord, debugApi, AgentDebugInfo, ChatRoom, chatRoomApi, AgentContextInfo, uploadApi } from '@/lib/agent-api'
import { useSocketStore } from './socket-store'
import { useChatRoomStore } from './chat-room-store'
import type { ToolCall, StreamEvent, AgentStatus } from './socket-store'
import { PendingImage } from '@/components/chat/image-preview-list'
import { compressImage, fileToBase64, createPreviewUrl, revokePreviewUrl, getImageDimensions, isValidImageType, isValidImageSize } from '@/lib/image-utils'
import { isActivelyViewingChatRoom } from '@/lib/chat-room-presence'
import { toast } from 'sonner'

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

export const VOICE_MESSAGE_PLACEHOLDER = '[语音消息]'

const missingRecipientToast = createElement(
  'span',
  { className: 'text-sm' },
  '请 ',
  createElement('span', { className: 'font-semibold text-yellow-700' }, '@助手'),
  ' 或在群设置里 ',
  createElement('span', { className: 'font-semibold text-yellow-700' }, '设置默认接收助手'),
)

function getMentionedAgentNames(content: string): string[] {
  const names: string[] = []
  const regex = /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_](?:[\u4e00-\u9fa5a-zA-Z0-9_-]*[\u4e00-\u9fa5a-zA-Z0-9_])?)(?=\s|$|[*_>#`!?.,:;！？。，；：]|-(?![\u4e00-\u9fa5a-zA-Z0-9_]))/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match[1] && !names.includes(match[1])) {
      names.push(match[1])
    }
  }
  return names
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')
}

function getMentionedKnownAgentNames(content: string, agentNames: string[]): string[] {
  const names: string[] = []
  if (agentNames.length === 0) return getMentionedAgentNames(content)
  const escapedNames = agentNames
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  if (escapedNames.length === 0) return names

  const boundaryChars = '*_>#`-'
  const endBoundaryChars = '*_>#`!?.,:;！？。，；：'
  const regex = new RegExp(
    `(?:^|\\s|[${boundaryChars}])@(${escapedNames.join('|')})(?=\\s|$|[${endBoundaryChars}]|-(?![\\u4e00-\\u9fa5a-zA-Z0-9_]))`,
    'g',
  )

  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match[1] && !names.includes(match[1])) {
      names.push(match[1])
    }
  }
  return names
}

function hasMentionedDispatchableAgent(content: string, chatRoom: ChatRoom, allAgents: Agent[]): boolean {
  const dispatchableAgentNames = new Set(
    (chatRoom.chatRoomAgents ?? [])
      .map((roomAgent) => roomAgent.agent?.name)
      .filter((name): name is string => Boolean(name))
  )

  for (const agent of allAgents) {
    if (agent.agentLevel === 'system' && agent.isActive) {
      dispatchableAgentNames.add(agent.name)
    }
  }

  const mentionedNames = getMentionedKnownAgentNames(content, Array.from(dispatchableAgentNames))
  if (mentionedNames.length === 0) return false

  return mentionedNames.some((name) => dispatchableAgentNames.has(name))
}

export type SidePanelMode = 'agents' | 'context' | 'history' | 'stream' | 'agent-detail' | 'record-detail' | 'reply-detail' | 'room-settings' | 'execution-detail' | 'cron-tasks' | 'task-queue' | 'task-board' | null

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface SelectedRoomAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
  chatRoomAgentId?: string
  agentType?: string
  chatRoomId?: string  // 用于计算默认工作目录
  injectGroupHistory?: boolean  // 是否注入群历史
}

interface ChatStore {
  // 消息状态
  messages: Message[]
  messagesByRoom: Record<string, Message[]>
  activeChatRoomId: string | null
  messageLoadVersions: Record<string, number>
  loadingByRoom: Record<string, boolean>
  loadingOlderMessagesByRoom: Record<string, boolean>
  hasOlderMessagesByRoom: Record<string, boolean>
  inputValue: string
  loading: boolean
  loadingOlderMessages: boolean
  hasOlderMessages: boolean
  allAgents: Agent[]

  // 面板状态
  sidePanelMode: SidePanelMode
  debugInfo: AgentDebugInfo | null
  debugLoading: boolean
  executionRecords: ExecutionRecord[]
  recordsLoading: boolean
  selectedRecord: ExecutionRecord | null
  selectedRoomAgent: SelectedRoomAgent | null
  streamingViewAgent: { messageId: string; agentId: string; name: string } | null
  selectedReplyMessage: Message | null
  contextLoading: boolean
  contextInfo: AgentContextInfo | null

  // 执行详情面板状态
  executionDetailRecord: ExecutionRecord | null
  executionDetailLoading: boolean

  // Dialog 状态
  showAddAgent: boolean
  addingAgentIds: Set<string>
  showClearConfirm: boolean
  clearing: boolean

  // Socket 状态
  typingAgents: Map<string, { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled' }[]>
  streamingContent: Map<string, string>
  streamingThinking: Map<string, string>
  toolCalls: Map<string, ToolCall[]>
  completedAgents: Set<string>
  streamEvents: Map<string, StreamEvent[]>  // 按 messageId_agentId 存储事件流
  agentStatuses: Map<string, AgentStatus>  // agentId -> status
  agentQueueCounts: Map<string, number>  // agentId -> queue count
  executingChatRooms: Set<string>  // 有助手正在执行的群聊 ID
  inactiveTasks: Map<string, { id: string; agentId: string; agentName: string; messageId: string; messageContent: string; status: string; createdAt: string }[]>  // chatRoomId -> inactive tasks

  // 未读消息状态
  unreadCounts: Record<string, number>  // chatRoomId -> unread count

  // 图片上传状态
  pendingImages: PendingImage[]

  // 消息定位状态
  scrollToMessageId: string | null
  // 强制滚动到底部（用户发送消息后）
  forceScrollToBottom: boolean
  // 滚动位置记忆（按群聊 ID 存储）
  scrollPositions: Record<string, number>  // chatRoomId -> scrollTop
  // 当前正在语音播报的消息 ID（auto 或 manual）
  playingVoiceMessageId: string | null
  // 语音消息已处理记录（用于避免自动重复播报）
  handledVoiceMessageIdsByRoom: Record<string, string[]>
  // 语音消息已播放记录（用于红点/已播状态）
  playedVoiceMessageIdsByRoom: Record<string, string[]>

  // Actions
  setInputValue: (value: string) => void
  setActiveChatRoomId: (chatRoomId: string | null) => void
  setMessages: (messages: Message[], chatRoomId?: string) => void
  addMessage: (message: Message) => void
  setSidePanelMode: (mode: SidePanelMode) => void
  setShowAddAgent: (show: boolean) => void
  setAddingAgentIds: (ids: Set<string>) => void
  setShowClearConfirm: (show: boolean) => void
  setClearing: (clearing: boolean) => void
  setSelectedRoomAgent: (agent: SelectedRoomAgent | null) => void
  setStreamingViewAgent: (agent: { messageId: string; agentId: string; name: string } | null) => void
  setSelectedRecord: (record: ExecutionRecord | null) => void
  setDebugInfo: (info: AgentDebugInfo | null) => void
  setDebugLoading: (loading: boolean) => void
  setExecutionRecords: (records: ExecutionRecord[]) => void
  setRecordsLoading: (loading: boolean) => void
  setLoading: (loading: boolean) => void
  setLoadingOlderMessages: (loading: boolean) => void
  setHasOlderMessages: (hasMore: boolean) => void
  setAllAgents: (agents: Agent[]) => void
  setTypingAgents: (agents: Map<string, { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled' }[]>) => void
  setStreamingContent: (content: Map<string, string>) => void
  setStreamingThinking: (thinking: Map<string, string>) => void
  setToolCalls: (calls: Map<string, ToolCall[]>) => void
  setCompletedAgents: (agents: Set<string>) => void
  setStreamEvents: (events: Map<string, StreamEvent[]>) => void
  addStreamEvent: (agentId: string, event: StreamEvent) => void
  updateStreamEvent: (agentId: string, eventId: string, updates: Partial<StreamEvent>) => void
  setAgentStatuses: (statuses: Map<string, AgentStatus>) => void
  setAgentQueueCounts: (counts: Map<string, number>) => void
  setExecutingChatRooms: (rooms: Set<string>) => void
  setInactiveTasks: (chatRoomId: string, tasks: { id: string; agentId: string; agentName: string; messageId: string; messageContent: string; status: string; createdAt: string }[]) => void
  setSelectedReplyMessage: (message: Message | null) => void
  setUnreadCounts: (counts: Record<string, number>) => void
  updateUnreadCount: (chatRoomId: string, count: number) => void
  setContextLoading: (loading: boolean) => void
  setContextInfo: (info: AgentContextInfo | null) => void
  setScrollToMessageId: (messageId: string | null) => void
  setForceScrollToBottom: (force: boolean) => void
  saveScrollPosition: (chatRoomId: string, scrollTop: number) => void
  getScrollPosition: (chatRoomId: string) => number | null
  setPlayingVoiceMessageId: (id: string | null) => void
  markVoiceMessagesHandled: (chatRoomId: string, messageIds: string[]) => void
  markVoiceMessagesPlayed: (chatRoomId: string, messageIds: string[]) => void
  loadMessages: (chatRoomId: string) => Promise<void>
  loadOlderMessages: (chatRoomId: string) => Promise<void>
  loadAllAgents: () => Promise<void>
  loadDebugInfo: (chatRoomId: string, agentName: string) => Promise<void>
  loadExecutionRecords: (chatRoomId: string, agentId: string) => Promise<void>
  loadExecutionDetailByMessage: (messageId: string) => Promise<void>
  loadContextInfo: (chatRoomId: string, chatRoomAgentId: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  deleteMessages: (messageIds: string[]) => Promise<void>
  clearMessages: (chatRoomId: string) => Promise<void>
  getAvailableAgents: (currentAgentIds: Set<string>) => Agent[]
  getMentionAgents: (chatRoomAgents: ChatRoom['chatRoomAgents']) => MentionAgent[]
  getReplyCounts: () => Map<string, number>
  findReplyTo: (replyMessageId: string | null) => Message | undefined
  getReplies: (messageId: string) => Message[]
  // 图片上传 Actions
  setPendingImages: (images: PendingImage[]) => void
  addPendingImage: (image: PendingImage) => void
  updatePendingImage: (id: string, updates: Partial<PendingImage>) => void
  removePendingImage: (id: string) => void
  clearPendingImages: () => void
  handleImageSelect: (files: File[]) => Promise<void>
}


// 每个房间最多保留多少个语音消息 ID，避免 localStorage 无限增长
const MAX_VOICE_IDS_PER_ROOM = 500
const EMPTY_MESSAGES: Message[] = []

function findCachedMessage(
  messages: Message[],
  messagesByRoom: Record<string, Message[]>,
  messageId: string,
): Message | undefined {
  const currentMessage = messages.find((message) => message.id === messageId)
  if (currentMessage) return currentMessage

  for (const roomMessages of Object.values(messagesByRoom)) {
    const found = roomMessages.find((message) => message.id === messageId)
    if (found) return found
  }

  return undefined
}

function sortMessagesByTime(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const aTime = new Date(a.time).getTime()
    const bTime = new Date(b.time).getTime()
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

function mergeUniqueIds(current: string[] | undefined, incoming: string[]): string[] {
  if (incoming.length === 0) return current ?? []
  const merged = new Set(current ?? [])
  let changed = false
  for (const id of incoming) {
    if (!merged.has(id)) {
      merged.add(id)
      changed = true
    }
  }
  if (!changed) return current ?? []
  let result = Array.from(merged)
  if (result.length > MAX_VOICE_IDS_PER_ROOM) {
    result = result.slice(-MAX_VOICE_IDS_PER_ROOM)
  }
  return result
}

export const useChatStore = create<ChatStore>()(
  persist((set, get) => ({
  // 消息状态
  messages: [],
  messagesByRoom: {},
  activeChatRoomId: null,
  messageLoadVersions: {},
  loadingByRoom: {},
  loadingOlderMessagesByRoom: {},
  hasOlderMessagesByRoom: {},
  inputValue: '',
  loading: false,
  loadingOlderMessages: false,
  hasOlderMessages: true,
  allAgents: [],

  // 面板状态
  sidePanelMode: null,
  debugInfo: null,
  debugLoading: false,
  executionRecords: [],
  recordsLoading: false,

  // 消息定位状态
  scrollToMessageId: null,
  forceScrollToBottom: false,
  scrollPositions: {},  // 滚动位置记忆
  playingVoiceMessageId: null,
  handledVoiceMessageIdsByRoom: {},
  playedVoiceMessageIdsByRoom: {},
  selectedRecord: null,
  selectedRoomAgent: null,
  streamingViewAgent: null,
  selectedReplyMessage: null,
  contextLoading: false,
  contextInfo: null,

  // 执行详情面板状态
  executionDetailRecord: null,
  executionDetailLoading: false,

  // Dialog 状态
  showAddAgent: false,
  addingAgentIds: new Set(),
  showClearConfirm: false,
  clearing: false,

  // Socket 状态
  typingAgents: new Map(),
  streamingContent: new Map(),
  streamingThinking: new Map(),
  toolCalls: new Map(),
  completedAgents: new Set(),
  streamEvents: new Map(),
  agentStatuses: new Map(),
  agentQueueCounts: new Map(),
  executingChatRooms: new Set(),
  inactiveTasks: new Map(),

  // 未读消息状态
  unreadCounts: {},

  // 图片上传状态
  pendingImages: [],

  // Actions
  setInputValue: (value) => set({ inputValue: value }),
  setActiveChatRoomId: (chatRoomId) => set((state) => {
    const roomMessages = chatRoomId ? state.messagesByRoom[chatRoomId] ?? [] : []
    return {
      activeChatRoomId: chatRoomId,
      messages: roomMessages,
      loading: chatRoomId ? state.loadingByRoom[chatRoomId] ?? false : false,
      loadingOlderMessages: chatRoomId ? state.loadingOlderMessagesByRoom[chatRoomId] ?? false : false,
      hasOlderMessages: chatRoomId ? state.hasOlderMessagesByRoom[chatRoomId] ?? true : true,
    }
  }),
  setMessages: (messages, chatRoomId) => set((state) => {
    const roomId = chatRoomId ?? messages[0]?.chatRoomId ?? state.activeChatRoomId
    if (!roomId) return { messages }

    const nextMessagesByRoom = {
      ...state.messagesByRoom,
      [roomId]: messages,
    }

    return {
      messagesByRoom: nextMessagesByRoom,
      messages: state.activeChatRoomId === roomId ? messages : state.messages,
    }
  }),
  addMessage: (message) => set((state) => {
    const roomId = message.chatRoomId
    if (!roomId) {
      if (state.messages.some(m => m.id === message.id)) return state
      return { messages: [...state.messages, message] }
    }

    const roomMessages = state.messagesByRoom[roomId] ?? []
    if (roomMessages.some(m => m.id === message.id)) return state

    const nextRoomMessages = sortMessagesByTime([...roomMessages, message])
    const nextMessagesByRoom = {
      ...state.messagesByRoom,
      [roomId]: nextRoomMessages,
    }

    return {
      messagesByRoom: nextMessagesByRoom,
      messages: state.activeChatRoomId === roomId ? nextRoomMessages : state.messages,
    }
  }),
  setSidePanelMode: (mode) => set({ sidePanelMode: mode }),
  setShowAddAgent: (show) => set({ showAddAgent: show }),
  setAddingAgentIds: (ids) => set({ addingAgentIds: ids }),
  setShowClearConfirm: (show) => set({ showClearConfirm: show }),
  setClearing: (clearing) => set({ clearing: clearing }),
  setSelectedRoomAgent: (agent) => set({ selectedRoomAgent: agent }),
  setStreamingViewAgent: (agent) => set({ streamingViewAgent: agent }),
  setSelectedRecord: (record) => set({ selectedRecord: record }),
  setDebugInfo: (info) => set({ debugInfo: info }),
  setDebugLoading: (loading) => set({ debugLoading: loading }),
  setExecutionRecords: (records) => set({ executionRecords: records }),
  setRecordsLoading: (loading) => set({ recordsLoading: loading }),
  setLoading: (loading) => set({ loading: loading }),
  setLoadingOlderMessages: (loading) => set({ loadingOlderMessages: loading }),
  setHasOlderMessages: (hasMore) => set({ hasOlderMessages: hasMore }),
  setAllAgents: (agents) => set({ allAgents: agents }),
  setTypingAgents: (agents) => set({ typingAgents: agents }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  setStreamingThinking: (thinking) => set({ streamingThinking: thinking }),
  setToolCalls: (calls) => set({ toolCalls: calls }),
  setCompletedAgents: (agents) => set({ completedAgents: agents }),
  setStreamEvents: (events) => set({ streamEvents: events }),
  addStreamEvent: (agentId, event) => set((state) => {
    const newEvents = new Map(state.streamEvents)
    const events = newEvents.get(agentId) || []
    newEvents.set(agentId, [...events, event])
    return { streamEvents: newEvents }
  }),
  updateStreamEvent: (agentId, eventId, updates) => set((state) => {
    const newEvents = new Map(state.streamEvents)
    const events = newEvents.get(agentId) || []
    const updatedEvents = events.map(e => e.id === eventId ? { ...e, ...updates } : e)
    newEvents.set(agentId, updatedEvents)
    return { streamEvents: newEvents }
  }),
  setAgentStatuses: (statuses) => set({ agentStatuses: statuses }),
  setAgentQueueCounts: (counts) => set({ agentQueueCounts: counts }),
  setExecutingChatRooms: (rooms) => set({ executingChatRooms: rooms }),
  setInactiveTasks: (chatRoomId: string, tasks: { id: string; agentId: string; agentName: string; messageId: string; messageContent: string; status: string; createdAt: string }[]) => {
    const state = useChatStore.getState()
    const currentTasks = state.inactiveTasks.get(chatRoomId)
    // 只在数据真正变化时才更新
    if (!currentTasks || JSON.stringify(currentTasks) !== JSON.stringify(tasks)) {
      set((state) => {
        const newInactiveTasks = new Map(state.inactiveTasks)
        newInactiveTasks.set(chatRoomId, tasks)
        return { inactiveTasks: newInactiveTasks }
      })
    }
  },
  setSelectedReplyMessage: (message) => set({ selectedReplyMessage: message }),
  setUnreadCounts: (counts) => set({ unreadCounts: counts }),
  updateUnreadCount: (chatRoomId, count) => set((state) => ({
    unreadCounts: { ...state.unreadCounts, [chatRoomId]: count }
  })),
  setContextLoading: (loading) => set({ contextLoading: loading }),
  setContextInfo: (info) => set({ contextInfo: info }),
  setScrollToMessageId: (messageId) => set({ scrollToMessageId: messageId }),
  setForceScrollToBottom: (force) => set({ forceScrollToBottom: force }),
  setPlayingVoiceMessageId: (id) => set({ playingVoiceMessageId: id }),
  markVoiceMessagesHandled: (chatRoomId, messageIds) => set((state) => {
    const nextIds = mergeUniqueIds(state.handledVoiceMessageIdsByRoom[chatRoomId], messageIds)
    if (nextIds === state.handledVoiceMessageIdsByRoom[chatRoomId]) {
      return state
    }
    return {
      handledVoiceMessageIdsByRoom: {
        ...state.handledVoiceMessageIdsByRoom,
        [chatRoomId]: nextIds,
      },
    }
  }),
  markVoiceMessagesPlayed: (chatRoomId, messageIds) => set((state) => {
    const nextIds = mergeUniqueIds(state.playedVoiceMessageIdsByRoom[chatRoomId], messageIds)
    if (nextIds === state.playedVoiceMessageIdsByRoom[chatRoomId]) {
      return state
    }
    return {
      playedVoiceMessageIdsByRoom: {
        ...state.playedVoiceMessageIdsByRoom,
        [chatRoomId]: nextIds,
      },
    }
  }),
  saveScrollPosition: (chatRoomId, scrollTop) => set((state) => ({
    scrollPositions: { ...state.scrollPositions, [chatRoomId]: scrollTop }
  })),
  getScrollPosition: (chatRoomId) => get().scrollPositions[chatRoomId] ?? null,

  // API calls
  loadMessages: async (chatRoomId) => {
    const version = (get().messageLoadVersions[chatRoomId] ?? 0) + 1
    set((state) => ({
      messageLoadVersions: {
        ...state.messageLoadVersions,
        [chatRoomId]: version,
      },
      loadingByRoom: {
        ...state.loadingByRoom,
        [chatRoomId]: true,
      },
      loadingOlderMessagesByRoom: {
        ...state.loadingOlderMessagesByRoom,
        [chatRoomId]: false,
      },
      hasOlderMessagesByRoom: {
        ...state.hasOlderMessagesByRoom,
        [chatRoomId]: true,
      },
      loading: state.activeChatRoomId === chatRoomId ? true : state.loading,
      loadingOlderMessages: state.activeChatRoomId === chatRoomId ? false : state.loadingOlderMessages,
      hasOlderMessages: state.activeChatRoomId === chatRoomId ? true : state.hasOlderMessages,
    }))
    try {
      const response = await messageApi.getAll(chatRoomId)
      if (response.success && response.data) {
        const hasMore = response.pagination?.hasMore ?? response.data.length >= 100
        set((state) => {
          if (state.messageLoadVersions[chatRoomId] !== version) return state

          const nextMessagesByRoom = {
            ...state.messagesByRoom,
            [chatRoomId]: response.data!,
          }
          return {
            messagesByRoom: nextMessagesByRoom,
            hasOlderMessagesByRoom: {
              ...state.hasOlderMessagesByRoom,
              [chatRoomId]: hasMore,
            },
            messages: state.activeChatRoomId === chatRoomId ? response.data! : state.messages,
            hasOlderMessages: state.activeChatRoomId === chatRoomId ? hasMore : state.hasOlderMessages,
          }
        })
      }
    } finally {
      set((state) => {
        if (state.messageLoadVersions[chatRoomId] !== version) return state
        return {
          loadingByRoom: {
            ...state.loadingByRoom,
            [chatRoomId]: false,
          },
          loading: state.activeChatRoomId === chatRoomId ? false : state.loading,
        }
      })
    }
  },

  loadOlderMessages: async (chatRoomId) => {
    const state = get()
    const messages = state.messagesByRoom[chatRoomId] ?? []
    const loading = state.loadingByRoom[chatRoomId] ?? false
    const loadingOlderMessages = state.loadingOlderMessagesByRoom[chatRoomId] ?? false
    const hasOlderMessages = state.hasOlderMessagesByRoom[chatRoomId] ?? true
    if (loading || loadingOlderMessages || !hasOlderMessages || messages.length === 0) return

    const beforeMessageId = messages[0].id
    set((state) => ({
      loadingOlderMessagesByRoom: {
        ...state.loadingOlderMessagesByRoom,
        [chatRoomId]: true,
      },
      loadingOlderMessages: state.activeChatRoomId === chatRoomId ? true : state.loadingOlderMessages,
    }))
    try {
      const response = await messageApi.getAll(chatRoomId, { beforeMessageId })
      if (response.success && response.data) {
        set((state) => {
          const roomMessages = state.messagesByRoom[chatRoomId] ?? []
          if (roomMessages[0]?.id !== beforeMessageId) {
            return state
          }

          const existingIds = new Set(roomMessages.map((message) => message.id))
          const olderMessages = response.data!.filter((message) => !existingIds.has(message.id))
          const nextRoomMessages = [...olderMessages, ...roomMessages]
          const hasMore = response.pagination?.hasMore ?? response.data!.length >= 100
          return {
            messagesByRoom: {
              ...state.messagesByRoom,
              [chatRoomId]: nextRoomMessages,
            },
            hasOlderMessagesByRoom: {
              ...state.hasOlderMessagesByRoom,
              [chatRoomId]: hasMore,
            },
            messages: state.activeChatRoomId === chatRoomId ? nextRoomMessages : state.messages,
            hasOlderMessages: state.activeChatRoomId === chatRoomId ? hasMore : state.hasOlderMessages,
          }
        })
      }
    } finally {
      set((state) => ({
        loadingOlderMessagesByRoom: {
          ...state.loadingOlderMessagesByRoom,
          [chatRoomId]: false,
        },
        loadingOlderMessages: state.activeChatRoomId === chatRoomId ? false : state.loadingOlderMessages,
      }))
    }
  },

  loadAllAgents: async () => {
    try {
      const response = await agentApi.getAll()
      if (response.success && response.data) {
        set({ allAgents: response.data })
      }
    } catch (error) {
      console.error('Failed to load agents:', error)
    }
  },

  loadDebugInfo: async (chatRoomId, agentName) => {
    set({ debugLoading: true, debugInfo: null })
    try {
      const response = await debugApi.getAgentDebugInfo(chatRoomId, agentName)
      if (response.success && response.data) {
        set({ debugInfo: response.data })
      }
    } catch (error) {
      console.error('Failed to load debug info:', error)
    } finally {
      set({ debugLoading: false })
    }
  },

  loadExecutionRecords: async (chatRoomId, agentId) => {
    set({ recordsLoading: true, executionRecords: [] })
    try {
      const response = await debugApi.getExecutionRecords(chatRoomId, agentId)
      if (response.success && response.data) {
        set({ executionRecords: response.data })
      }
    } catch (error) {
      console.error('Failed to load execution records:', error)
    } finally {
      set({ recordsLoading: false })
    }
  },

  loadExecutionDetailByMessage: async (messageId) => {
    set({ executionDetailLoading: true, executionDetailRecord: null })
    try {
      const response = await messageApi.getExecutionRecord(messageId)
      if (response.success && response.data) {
        set({ executionDetailRecord: response.data })
      }
    } catch (error) {
      console.error('Failed to load execution detail:', error)
    } finally {
      set({ executionDetailLoading: false })
    }
  },

  loadContextInfo: async (chatRoomId, chatRoomAgentId) => {
    set({ contextLoading: true, contextInfo: null })
    try {
      const response = await chatRoomApi.getAgentContext(chatRoomId, chatRoomAgentId)
      if (response.success && response.data) {
        set({ contextInfo: response.data })
      }
    } catch (error) {
      console.error('Failed to load context info:', error)
    } finally {
      set({ contextLoading: false })
    }
  },

  deleteMessage: async (messageId) => {
    const { messages, messagesByRoom } = get()
    const message = findCachedMessage(messages, messagesByRoom, messageId)
    try {
      const response = await messageApi.delete(messageId)
      if (!response.success) {
        throw new Error(response.error || '删除消息失败')
      }
      set((state) => {
        const nextMessagesByRoom: Record<string, Message[]> = {}
        for (const [roomId, roomMessages] of Object.entries(state.messagesByRoom)) {
          nextMessagesByRoom[roomId] = roomMessages
            .filter(m => m.id !== messageId)
            .map(m => m.replyMessageId === messageId ? { ...m, replyMessageId: null } : m)
        }
        const nextMessages = state.messages
          .filter(m => m.id !== messageId)
          .map(m => m.replyMessageId === messageId ? { ...m, replyMessageId: null } : m)

        return {
          messagesByRoom: nextMessagesByRoom,
          messages: nextMessages,
          selectedReplyMessage: state.selectedReplyMessage?.id === messageId ? null : state.selectedReplyMessage,
        }
      })
      if (message?.chatRoomId) {
        void useChatRoomStore.getState().loadChatRooms()
      }
    } catch (error) {
      console.error('Failed to delete message:', error)
      throw error
    }
  },

  deleteMessages: async (messageIds) => {
    const uniqueIds = Array.from(new Set(messageIds))
    if (uniqueIds.length === 0) return

    const state = get()
    const messagesById = new Map([
      ...state.messages.map(m => [m.id, m] as const),
      ...Object.values(state.messagesByRoom).flat().map(m => [m.id, m] as const),
    ])
    const affectedRoomIds = new Set(
      uniqueIds
        .map(id => messagesById.get(id)?.chatRoomId)
        .filter((id): id is string => Boolean(id))
    )

    try {
      const response = await messageApi.deleteBatch(uniqueIds)
      if (!response.success) {
        throw new Error(response.error || '删除消息失败')
      }

      const deletedIds = new Set(uniqueIds)
      set((state) => {
        const nextMessagesByRoom: Record<string, Message[]> = {}
        for (const [roomId, roomMessages] of Object.entries(state.messagesByRoom)) {
          nextMessagesByRoom[roomId] = roomMessages
            .filter(m => !deletedIds.has(m.id))
            .map(m => m.replyMessageId && deletedIds.has(m.replyMessageId) ? { ...m, replyMessageId: null } : m)
        }
        const nextMessages = state.messages
          .filter(m => !deletedIds.has(m.id))
          .map(m => m.replyMessageId && deletedIds.has(m.replyMessageId) ? { ...m, replyMessageId: null } : m)

        return {
          messagesByRoom: nextMessagesByRoom,
          messages: nextMessages,
          selectedReplyMessage: state.selectedReplyMessage && deletedIds.has(state.selectedReplyMessage.id)
            ? null
            : state.selectedReplyMessage,
        }
      })

      if (affectedRoomIds.size > 0) {
        void useChatRoomStore.getState().loadChatRooms()
      }
    } catch (error) {
      console.error('Failed to delete messages:', error)
      throw error
    }
  },

  clearMessages: async (chatRoomId) => {
    set({ clearing: true })
    try {
      await messageApi.clearByChatRoomId(chatRoomId)
      set((state) => ({
        messagesByRoom: {
          ...state.messagesByRoom,
          [chatRoomId]: [],
        },
        messages: state.activeChatRoomId === chatRoomId ? [] : state.messages,
        showClearConfirm: false,
      }))
    } catch (error) {
      console.error('Failed to clear messages:', error)
    } finally {
      set({ clearing: false })
    }
  },

  // 计算属性
  getAvailableAgents: (currentAgentIds) => {
    const { allAgents } = get()
    return allAgents.filter(a => !currentAgentIds.has(a.id) && a.isActive)
  },

  getMentionAgents: (chatRoomAgents) => {
    const result: MentionAgent[] = []
    for (const a of chatRoomAgents ?? []) {
      if (a.agent) {
        result.push({
          id: a.agent.id,
          name: a.agent.name,
          avatar: a.agent.avatar ?? undefined,
          avatarColor: a.agent.avatarColor ?? undefined,
          description: a.agent.description ?? undefined,
        })
      } else if (a.user) {
        // 用户（群主）
        result.push({
          id: a.user.id,
          name: a.user.username,
          avatar: a.user.avatar ?? undefined,
          avatarColor: a.user.avatarColor ?? undefined,
          description: undefined,
        })
      }
    }
    return result
  },

  getReplyCounts: () => {
    const { messages } = get()
    const counts = new Map<string, number>()
    for (const msg of messages) {
      if (msg.replyMessageId) {
        counts.set(msg.replyMessageId, (counts.get(msg.replyMessageId) ?? 0) + 1)
      }
    }
    return counts
  },

  findReplyTo: (replyMessageId) => {
    if (!replyMessageId) return undefined
    const { messages } = get()
    return messages.find(m => m.id === replyMessageId)
  },

  getReplies: (messageId) => {
    const { messages } = get()
    return messages.filter(m => m.replyMessageId === messageId)
  },

  // 图片上传 Actions
  setPendingImages: (images) => set({ pendingImages: images }),
  addPendingImage: (image) => set((state) => ({
    pendingImages: [...state.pendingImages, image]
  })),
  updatePendingImage: (id, updates) => set((state) => ({
    pendingImages: state.pendingImages.map(img =>
      img.id === id ? { ...img, ...updates } : img
    )
  })),
  removePendingImage: (id) => set((state) => {
    const image = state.pendingImages.find(img => img.id === id)
    if (image) {
      revokePreviewUrl(image.preview)
    }
    return {
      pendingImages: state.pendingImages.filter(img => img.id !== id)
    }
  }),
  clearPendingImages: () => set((state) => {
    state.pendingImages.forEach(img => revokePreviewUrl(img.preview))
    return { pendingImages: [] }
  }),
  handleImageSelect: async (files) => {
    for (const file of files) {
      // 验证文件
      if (!isValidImageType(file)) continue
      if (!isValidImageSize(file, 10)) continue

      const id = generateUUID()
      const preview = createPreviewUrl(file)

      // 添加待处理图片
      get().addPendingImage({
        id,
        file,
        preview,
        uploading: true,
      })

      try {
        // 压缩图片
        const compressedFile = await compressImage(file)

        // 获取尺寸
        const dimensions = await getImageDimensions(compressedFile)

        // 生成 base64
        const base64 = await fileToBase64(compressedFile)

        // 上传到服务器
        const result = await uploadApi.uploadImage(compressedFile)

        if (result.success && result.data) {
          get().updatePendingImage(id, {
            uploading: false,
            uploadedData: {
              url: result.data.url,
              filename: result.data.filename,
              mimeType: result.data.mimeType,
              size: result.data.size,
              width: dimensions.width,
              height: dimensions.height,
              base64,
            },
          })
        } else {
          get().updatePendingImage(id, {
            uploading: false,
            error: result.error || '上传失败',
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '处理失败'
        get().updatePendingImage(id, {
          uploading: false,
          error: message,
        })
      }
    }
  },
  }),
  {
    name: 'chat-ui-storage',
    partialize: (state) => ({
      handledVoiceMessageIdsByRoom: state.handledVoiceMessageIdsByRoom,
      playedVoiceMessageIdsByRoom: state.playedVoiceMessageIdsByRoom,
    }),
  })
)

// 导出一个组合 hook，用于 chat-area.tsx
export function useChatAreaStore(chatRoom?: ChatRoom, onChatRoomChange?: () => void) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevChatRoomIdRef = useRef<string | null>(null)
  const chatRoomId = chatRoom?.id ?? null

  // 使用 selectors 选择具体的值，避免整个 store 对象变化
  const messages = useChatStore((s) => chatRoomId ? s.messagesByRoom[chatRoomId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES)
  const inputValue = useChatStore((s) => s.inputValue)
  const loading = useChatStore((s) => chatRoomId ? s.loadingByRoom[chatRoomId] ?? false : false)
  const loadingOlderMessages = useChatStore((s) => chatRoomId ? s.loadingOlderMessagesByRoom[chatRoomId] ?? false : false)
  const hasOlderMessages = useChatStore((s) => chatRoomId ? s.hasOlderMessagesByRoom[chatRoomId] ?? true : true)
  const allAgents = useChatStore((s) => s.allAgents)
  const sidePanelMode = useChatStore((s) => s.sidePanelMode)
  const debugInfo = useChatStore((s) => s.debugInfo)
  const debugLoading = useChatStore((s) => s.debugLoading)
  const executionRecords = useChatStore((s) => s.executionRecords)
  const recordsLoading = useChatStore((s) => s.recordsLoading)
  const selectedRecord = useChatStore((s) => s.selectedRecord)
  const selectedRoomAgent = useChatStore((s) => s.selectedRoomAgent)
  const streamingViewAgent = useChatStore((s) => s.streamingViewAgent)
  const showAddAgent = useChatStore((s) => s.showAddAgent)
  const addingAgentIds = useChatStore((s) => s.addingAgentIds)
  const showClearConfirm = useChatStore((s) => s.showClearConfirm)
  const clearing = useChatStore((s) => s.clearing)
  const typingAgents = useChatStore((s) => s.typingAgents)
  const streamingContent = useChatStore((s) => s.streamingContent)
  const streamingThinking = useChatStore((s) => s.streamingThinking)
  const toolCalls = useChatStore((s) => s.toolCalls)
  const completedAgents = useChatStore((s) => s.completedAgents)
  const selectedReplyMessage = useChatStore((s) => s.selectedReplyMessage)
  const streamEvents = useChatStore((s) => s.streamEvents)
  const agentStatuses = useChatStore((s) => s.agentStatuses)
  const executingChatRooms = useChatStore((s) => s.executingChatRooms)
  const executionDetailRecord = useChatStore((s) => s.executionDetailRecord)
  const executionDetailLoading = useChatStore((s) => s.executionDetailLoading)
  const contextLoading = useChatStore((s) => s.contextLoading)
  const contextInfo = useChatStore((s) => s.contextInfo)

  // Actions - 使用 getState() 获取稳定引用
  const setInputValue = useChatStore((s) => s.setInputValue)
  const setActiveChatRoomId = useChatStore((s) => s.setActiveChatRoomId)
  const setSidePanelMode = useChatStore((s) => s.setSidePanelMode)
  const setShowAddAgent = useChatStore((s) => s.setShowAddAgent)
  const setAddingAgentIds = useChatStore((s) => s.setAddingAgentIds)
  const setShowClearConfirm = useChatStore((s) => s.setShowClearConfirm)
  const setSelectedRoomAgent = useChatStore((s) => s.setSelectedRoomAgent)
  const setStreamingViewAgent = useChatStore((s) => s.setStreamingViewAgent)
  const setSelectedRecord = useChatStore((s) => s.setSelectedRecord)
  const setTypingAgents = useChatStore((s) => s.setTypingAgents)
  const setCompletedAgents = useChatStore((s) => s.setCompletedAgents)
  const setToolCalls = useChatStore((s) => s.setToolCalls)
  const setStreamingThinking = useChatStore((s) => s.setStreamingThinking)
  const setStreamingContent = useChatStore((s) => s.setStreamingContent)
  const setStreamEvents = useChatStore((s) => s.setStreamEvents)
  const loadMessages = useChatStore((s) => s.loadMessages)
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages)
  const loadAllAgents = useChatStore((s) => s.loadAllAgents)
  const loadDebugInfo = useChatStore((s) => s.loadDebugInfo)
  const loadExecutionRecords = useChatStore((s) => s.loadExecutionRecords)
  const clearMessages = useChatStore((s) => s.clearMessages)
  const addMessage = useChatStore((s) => s.addMessage)
  const getAvailableAgents = useChatStore((s) => s.getAvailableAgents)
  const getMentionAgents = useChatStore((s) => s.getMentionAgents)
  const getReplies = useChatStore((s) => s.getReplies)
  const setSelectedReplyMessage = useChatStore((s) => s.setSelectedReplyMessage)
  const setAgentStatuses = useChatStore((s) => s.setAgentStatuses)
  const setAgentQueueCounts = useChatStore((s) => s.setAgentQueueCounts)
  const setExecutingChatRooms = useChatStore((s) => s.setExecutingChatRooms)
  const setInactiveTasks = useChatStore((s) => s.setInactiveTasks)
  const loadExecutionDetailByMessage = useChatStore((s) => s.loadExecutionDetailByMessage)
  const loadContextInfo = useChatStore((s) => s.loadContextInfo)
  const deleteMessage = useChatStore((s) => s.deleteMessage)

  const {
    isConnected,
    joinChatRoom,
    leaveChatRoom,
    sendMessage,
    onMessage,
    onAgentTyping,
    onAgentDone,
    onAgentStream,
    onAgentThinking,
    onAgentToolCall,
    onAgentStatus,
    requestAgentStatus,
    markChatRoomRead,
    onAgentResume,
    onAgentStopped,
    onCachedEvents,
    onAgentTaskCancelled,
    onInactiveTasks,
    onAgentTaskResumed,
  } = useSocketStore()

  // 处理新消息
  const handleNewMessage = useCallback((msg: any) => {
    const newMessage: Message = {
      id: msg.id,
      type: msg.type === 'reply' ? 'REPLY' : 'MESSAGE',
      content: msg.content,
      time: typeof msg.time === 'string' ? msg.time : new Date(msg.time).toISOString(),
      userId: msg.userId ?? null,
      agentId: msg.agentId ?? null,
      chatRoomId: msg.chatRoomId,
      replyMessageId: msg.replyMessageId ?? null,
      isHuman: msg.isHuman ?? true,
      executionRecordId: msg.executionRecordId ?? null,
      executionDuration: msg.executionDuration ?? null,
      totalTokens: msg.totalTokens ?? null,
      cacheReadTokens: msg.cacheReadTokens ?? null,
      avatar: msg.avatar ?? null,
      avatarColor: msg.avatarColor ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      user: msg.isHuman ? { id: msg.userId ?? '', socketId: '', username: msg.user ?? '用户', avatar: msg.avatar ?? null } : null,
      agent: msg.agentId && msg.agentName ? {
        id: msg.agentId,
        name: msg.agentName,
        avatar: msg.avatar ?? null,
        avatarColor: msg.avatarColor ?? null,
      } : null,
      attachments: msg.attachments ? msg.attachments.map((att: any) => ({
        id: att.id || generateUUID(),
        type: att.type || (typeof att.mimeType === 'string' && att.mimeType.startsWith('audio/') ? 'audio' : 'image'),
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        url: att.url,
        width: att.width ?? null,
        height: att.height ?? null,
        durationMs: att.durationMs ?? null,
        transcript: att.transcript ?? null,
        waveform: att.waveform ?? null,
        createdAt: new Date().toISOString(),
      })) : undefined,
    }
    addMessage(newMessage)
  }, [addMessage])

  // 进入群聊时刷新助手配置，确保系统助手或详情页更新后的语音配置能即时生效
  useEffect(() => {
    loadAllAgents()
  }, [chatRoom?.id, loadAllAgents])

  // 每次打开添加助手弹窗时刷新助手列表，避免使用进入群聊时缓存的旧列表
  useEffect(() => {
    if (!showAddAgent) return
    loadAllAgents()
  }, [showAddAgent, loadAllAgents])

  const hasWindowFocusRef = useRef(
    typeof document !== 'undefined' && typeof document.hasFocus === 'function'
      ? document.hasFocus()
      : true,
  )

  useEffect(() => {
    const handleFocus = () => {
      hasWindowFocusRef.current = true
    }
    const handleBlur = () => {
      hasWindowFocusRef.current = false
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // 监听新消息
  useEffect(() => {
    // 等待 socket 连接后再设置监听器
    if (!isConnected) return

    const unsubscribe = onMessage((msg) => {
      if (!msg.chatRoomId) return
      handleNewMessage(msg)

      // 只有当前群聊的消息才标记已读
      if (chatRoomId && msg.chatRoomId === chatRoomId) {
        if (isActivelyViewingChatRoom({
          isSelected: true,
          isDocumentVisible: !document.hidden,
          hasWindowFocus: hasWindowFocusRef.current,
        })) {
          // 用户正在前台查看当前群聊时，收到消息才自动标记为已读
          markChatRoomRead(chatRoomId)
        }
      }
    })
    return unsubscribe
  }, [isConnected, chatRoomId, onMessage, handleNewMessage, markChatRoomRead])

  // 监听 agent 事件
  useEffect(() => {
    // 等待 socket 连接后再设置监听器
    if (!isConnected) return

    const unsubTyping = onAgentTyping((data) => {
      // agent:typing 表示新任务开始，清空该 messageId_agentId 的历史流式数据
      const state = useChatStore.getState()
      const { typingAgents, completedAgents, toolCalls, streamingThinking, streamingContent, streamEvents } = state

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

      const newCompletedAgents = new Set(completedAgents)
      // 移除该 messageId_agentId 的完成状态（如果有）
      newCompletedAgents.delete(`${data.messageId}_${data.agentId}`)

      // 新任务开始，清空旧数据（按 messageId_agentId）
      const streamKey = `${data.messageId}_${data.agentId}`
      const newToolCalls = new Map(toolCalls)
      newToolCalls.delete(streamKey)

      const newStreamingThinking = new Map(streamingThinking)
      newStreamingThinking.delete(streamKey)

      const newStreamingContent = new Map(streamingContent)
      newStreamingContent.delete(streamKey)

      const newStreamEvents = new Map(streamEvents)
      newStreamEvents.delete(streamKey)

      setTypingAgents(newTypingAgents)
      setCompletedAgents(newCompletedAgents)
      setToolCalls(newToolCalls)
      setStreamingThinking(newStreamingThinking)
      setStreamingContent(newStreamingContent)
      setStreamEvents(newStreamEvents)
    })

    const unsubDone = onAgentDone((data) => {
      const state = useChatStore.getState()
      const { completedAgents, typingAgents, streamEvents, streamingViewAgent, sidePanelMode } = state

      // 按 messageId_agentId 标记完成
      const completedKey = `${data.triggerMessageId}_${data.agentId}`
      const newCompletedAgents = new Set(completedAgents)
      newCompletedAgents.add(completedKey)

      // 只移除 triggerMessageId 对应的 typingAgent，不影响其他消息的 typing
      const newTypingAgents = new Map(typingAgents)
      const agentsForMessage = newTypingAgents.get(data.triggerMessageId)
      if (agentsForMessage) {
        const filtered = agentsForMessage.filter(a => a.agentId !== data.agentId)
        if (filtered.length === 0) {
          newTypingAgents.delete(data.triggerMessageId)
        } else {
          newTypingAgents.set(data.triggerMessageId, filtered)
        }
      }

      // 完成时清空该 messageId_agentId 的流式数据（下次执行时重新开始）
      const streamKey = `${data.triggerMessageId}_${data.agentId}`
      const newStreamEvents = new Map(streamEvents)
      newStreamEvents.delete(streamKey)

      // 完成时更新状态
      setCompletedAgents(newCompletedAgents)
      setTypingAgents(newTypingAgents)
      setStreamEvents(newStreamEvents)

      // 如果当前正在查看该 messageId_agentId 的流式面板，自动关闭
      if (sidePanelMode === 'stream' && streamingViewAgent?.messageId === data.triggerMessageId && streamingViewAgent?.agentId === data.agentId) {
        setStreamingViewAgent(null)
        setSidePanelMode(null)
      }

      // 如果有 executionRecordId，更新消息的 executionRecordId、executionDuration 和 totalTokens
      if (data.executionRecordId && data.messageIds && data.messageIds.length > 0) {
        const messageIds = new Set(data.messageIds)
        const updateExecutionFields = (msg: Message) => (
          messageIds.has(msg.id)
            ? {
                ...msg,
                executionRecordId: data.executionRecordId,
                executionDuration: data.duration,
                totalTokens: data.totalTokens,
                cacheReadTokens: data.cacheReadTokens,
              }
            : msg
        )

        useChatStore.setState((state) => {
          const nextMessagesByRoom: Record<string, Message[]> = {}
          for (const [roomId, roomMessages] of Object.entries(state.messagesByRoom)) {
            nextMessagesByRoom[roomId] = roomMessages.map(updateExecutionFields)
          }

          return {
            messagesByRoom: nextMessagesByRoom,
            messages: state.messages.map(updateExecutionFields),
          }
        })
      }
    })

    // 恢复状态：切回来时恢复 typing 状态，不清理已有数据
    const unsubResume = onAgentResume((data) => {
      const state = useChatStore.getState()
      const { typingAgents, completedAgents } = state

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

      const newCompletedAgents = new Set(completedAgents)
      // 移除该 messageId_agentId 的完成状态
      newCompletedAgents.delete(`${data.messageId}_${data.agentId}`)

      // 只更新 typing 状态，不清空任何流式数据
      setTypingAgents(newTypingAgents)
      setCompletedAgents(newCompletedAgents)
    })

    const unsubStream = onAgentStream((data) => {
      const state = useChatStore.getState()
      const { streamEvents } = state

      // 更新事件流：检查最后一个事件是否是 output（按 messageId_agentId 存储）
      const streamKey = `${data.messageId}_${data.agentId}`
      const newStreamEvents = new Map(streamEvents)
      const events = newStreamEvents.get(streamKey) || []
      const lastEvent = events[events.length - 1]
      const now = Date.now()

      if (lastEvent?.type === 'output') {
        // 在同一个 output 卡片内累加增量片段
        const updatedEvents = [...events]
        updatedEvents[updatedEvents.length - 1] = {
          ...lastEvent,
          content: (lastEvent.content || '') + data.content,
        }
        newStreamEvents.set(streamKey, updatedEvents)
      } else {
        // 切换到 output，创建新卡片（不带入历史）
        const updatedEvents = events.map(e => ({
          ...e,
          endTime: e.endTime ?? now,
        }))
        newStreamEvents.set(streamKey, [...updatedEvents, {
          id: `output-${now}`,
          type: 'output',
          content: data.content,  // 增量片段作为新卡片开始
          timestamp: now,
        }])
      }
      setStreamEvents(newStreamEvents)
    })

    const unsubThinking = onAgentThinking((data) => {
      const state = useChatStore.getState()
      const { streamEvents } = state

      // 更新事件流：检查最后一个事件是否是 thinking（按 messageId_agentId 存储）
      const streamKey = `${data.messageId}_${data.agentId}`
      const newStreamEvents = new Map(streamEvents)
      const events = newStreamEvents.get(streamKey) || []
      const lastEvent = events[events.length - 1]
      const now = Date.now()

      if (lastEvent?.type === 'thinking') {
        // 在同一个 thinking 卡片内累加增量片段
        const updatedEvents = [...events]
        updatedEvents[updatedEvents.length - 1] = {
          ...lastEvent,
          content: (lastEvent.content || '') + data.thinking,
        }
        newStreamEvents.set(streamKey, updatedEvents)
      } else {
        // 切换到 thinking，创建新卡片（不带入历史）
        const updatedEvents = events.map(e => ({
          ...e,
          endTime: e.endTime ?? now,
        }))
        newStreamEvents.set(streamKey, [...updatedEvents, {
          id: `thinking-${now}`,
          type: 'thinking',
          content: data.thinking,  // 增量片段作为新卡片开始
          timestamp: now,
        }])
      }
      setStreamEvents(newStreamEvents)
    })

    const unsubToolCall = onAgentToolCall((data) => {
      // 不过滤 chatRoom，让所有群聊的流式事件都能更新全局状态
      const state = useChatStore.getState()
      const { toolCalls, streamEvents } = state

      // 按 messageId_agentId 存储
      const streamKey = `${data.messageId}_${data.agentId}`

      // 更新旧的数据结构
      const newToolCalls = new Map(toolCalls)
      const existing = newToolCalls.get(streamKey) ?? []

      const existingIndex = existing.findIndex(tc => tc.toolCallId === data.toolCall.toolCallId)
      if (existingIndex >= 0) {
        const updated = [...existing]
        updated[existingIndex] = data.toolCall
        newToolCalls.set(streamKey, updated)
      } else {
        newToolCalls.set(streamKey, [...existing, data.toolCall])
      }
      setToolCalls(newToolCalls)

      // 更新事件流：检查是否存在相同的 toolCallId（按 messageId_agentId 存储）
      const newStreamEvents = new Map(streamEvents)
      const events = newStreamEvents.get(streamKey) || []
      const existingEventIndex = events.findIndex(
        e => e.type === 'tool_call' && e.toolCall?.toolCallId === data.toolCall.toolCallId
      )

      // 特殊处理 todo 工具（write_todos / TodoWrite）：合并到同一个事件，而不是创建新事件
      const isTodoTool = ['write_todos', 'TodoWrite'].includes(data.toolCall.name)
      const existingWriteTodosIndex = isTodoTool ? events.findIndex(
        e => e.type === 'tool_call' && e.toolCall?.name && ['write_todos', 'TodoWrite'].includes(e.toolCall.name)
      ) : -1

      if (isTodoTool && existingWriteTodosIndex >= 0 && existingEventIndex < 0) {
        // 更新现有的 todo 工具事件，保留第一个 toolCallId，更新数据
        const updatedEvents = [...events]
        const existingEvent = updatedEvents[existingWriteTodosIndex]
        const endTime = (data.toolCall.status === 'completed' || data.toolCall.status === 'error') ? Date.now() : undefined
        const incomingTodos = (data.toolCall.input as { todos?: unknown[] } | undefined)?.todos
        const nextInput = Array.isArray(incomingTodos) ? data.toolCall.input : existingEvent.toolCall!.input
        updatedEvents[existingWriteTodosIndex] = {
          ...existingEvent,
          toolCall: {
            ...existingEvent.toolCall!,
            input: nextInput, // 新 TodoWrite 开始时 input 可能是空对象，避免闪烁清空任务列表
            status: data.toolCall.status,
            output: data.toolCall.output,
          },
          status: data.toolCall.status,
          endTime,
        }
        newStreamEvents.set(streamKey, updatedEvents)
      } else if (existingEventIndex >= 0) {
        // 更新现有 tool_call 事件
        const updatedEvents = [...events]
        const endTime = (data.toolCall.status === 'completed' || data.toolCall.status === 'error') ? Date.now() : undefined
        const existingEvent = updatedEvents[existingEventIndex]
        const incomingTodos = isTodoTool ? (data.toolCall.input as { todos?: unknown[] } | undefined)?.todos : undefined
        const nextToolCall = isTodoTool && !Array.isArray(incomingTodos) && existingEvent.toolCall
          ? {
              ...data.toolCall,
              input: existingEvent.toolCall.input,
            }
          : data.toolCall
        updatedEvents[existingEventIndex] = {
          ...existingEvent,
          toolCall: nextToolCall,
          status: nextToolCall.status,
          endTime,
        }
        newStreamEvents.set(streamKey, updatedEvents)
      } else {
        // 创建新的 tool_call 事件，同时为上一个事件设置 endTime
        const now = Date.now()
        const updatedEvents = events.map(e => ({
          ...e,
          endTime: e.endTime ?? now,
        }))
        newStreamEvents.set(streamKey, [...updatedEvents, {
          id: `tool-${data.toolCall.toolCallId}`,
          type: 'tool_call',
          toolCall: data.toolCall,
          status: data.toolCall.status,
          timestamp: now,
        }])
      }
      setStreamEvents(newStreamEvents)
    })

    const unsubStatus = onAgentStatus((data) => {
      // 合并状态而不是覆盖，保留其他群聊的 agent 状态
      const state = useChatStore.getState()
      const { agentStatuses, typingAgents, completedAgents, executingChatRooms, agentQueueCounts } = state
      const newStatuses = new Map(agentStatuses)
      const newQueueCounts = new Map(agentQueueCounts)

      let newTypingAgents = typingAgents
      let newCompletedAgents = completedAgents
      let newExecutingChatRooms = executingChatRooms

      // 检查该群聊是否有正在执行的 agent
      const hasExecutingAgent = Object.values(data.statuses).some(
        status => status === 'executing' || status === 'busy'
      )

      // 更新 executingChatRooms
      newExecutingChatRooms = new Set(executingChatRooms)
      if (hasExecutingAgent) {
        newExecutingChatRooms.add(data.chatRoomId)
      } else {
        newExecutingChatRooms.delete(data.chatRoomId)
      }

      for (const [agentId, status] of Object.entries(data.statuses)) {
        newStatuses.set(agentId, status)

        // 更新队列数量
        if (data.queueCounts && data.queueCounts[agentId] !== undefined) {
          newQueueCounts.set(agentId, data.queueCounts[agentId])
        }

        // 根据状态更新 typing 状态
        if (status === 'idle') {
          // agent 已完成或未在执行，清除所有该 agentId 的 typing 状态
          if (typingAgents.size > 0) {
            newTypingAgents = new Map(newTypingAgents)
            for (const [messageId, agents] of newTypingAgents) {
              const filtered = agents.filter(a => a.agentId !== agentId)
              if (filtered.length === 0) {
                newTypingAgents.delete(messageId)
              } else {
                newTypingAgents.set(messageId, filtered)
              }
            }
          }
        }
      }

      setAgentStatuses(newStatuses)
      setAgentQueueCounts(newQueueCounts)
      setExecutingChatRooms(newExecutingChatRooms)
      if (newTypingAgents !== typingAgents) {
        setTypingAgents(newTypingAgents)
      }
      if (newCompletedAgents !== completedAgents) {
        setCompletedAgents(newCompletedAgents)
      }
    })

    // 监听 agent:stopped 事件
    const unsubStopped = onAgentStopped((data) => {
      const state = useChatStore.getState()
      const { completedAgents, typingAgents, streamingViewAgent, sidePanelMode } = state
      const newCompletedAgents = new Set(completedAgents)
      const newTypingAgents = new Map(typingAgents)

      for (const [messageId, agents] of typingAgents) {
        if (!agents.some(a => a.agentId === data.agentId)) continue
        newCompletedAgents.add(`${messageId}_${data.agentId}`)
        const filtered = agents.filter(a => a.agentId !== data.agentId)
        if (filtered.length === 0) {
          newTypingAgents.delete(messageId)
        } else {
          newTypingAgents.set(messageId, filtered)
        }
      }

      setCompletedAgents(newCompletedAgents)
      setTypingAgents(newTypingAgents)

      if (sidePanelMode === 'stream' && streamingViewAgent?.agentId === data.agentId) {
        setStreamingViewAgent(null)
        setSidePanelMode(null)
      }
    })

    // 监听 agent:task-cancelled 事件，更新 typingAgents 状态
    const unsubCancelled = onAgentTaskCancelled((data) => {
      const state = useChatStore.getState()
      const { typingAgents } = state

      const newTypingAgents = new Map(typingAgents)
      const agents = newTypingAgents.get(data.messageId)
      if (agents) {
        // 更新该 agent 的状态为 cancelled
        const updated = agents.map(a =>
          a.agentId === data.agentId ? { ...a, status: 'cancelled' as const } : a
        )
        newTypingAgents.set(data.messageId, updated)
        setTypingAgents(newTypingAgents)
      }
    })

    // 监听 agent:inactive-tasks 事件，更新 inactiveTasks store
    const unsubInactiveTasks = onInactiveTasks((data) => {
      setInactiveTasks(data.chatRoomId, data.tasks)
    })

    // 监听 agent:task-resumed 事件，从 inactiveTasks 中移除恢复的任务
    const unsubTaskResumed = onAgentTaskResumed((data) => {
      const state = useChatStore.getState()
      const inactiveTasks = state.inactiveTasks.get(data.chatRoomId)
      if (inactiveTasks) {
        const updated = inactiveTasks.filter(t => t.id !== data.taskId)
        setInactiveTasks(data.chatRoomId, updated)
      }
    })

    // 监听缓存的流式事件（用于刷新页面后恢复）
    const unsubCachedEvents = onCachedEvents((data) => {
      if (data.chatRoomId !== chatRoomId) return

      const { streamEvents } = useChatStore.getState()
      const streamKey = `${data.messageId}_${data.agentId}`
      const newStreamEvents = new Map(streamEvents)
      newStreamEvents.set(streamKey, data.events)
      setStreamEvents(newStreamEvents)
    })

    return () => {
      unsubTyping()
      unsubDone()
      unsubResume()
      unsubStream()
      unsubThinking()
      unsubToolCall()
      unsubStatus()
      unsubStopped()
      unsubCancelled()
      unsubInactiveTasks()
      unsubTaskResumed()
      unsubCachedEvents()
    }
    // 依赖 isConnected，确保 socket 连接后重新设置监听器
  }, [chatRoomId, isConnected, onAgentTyping, onAgentDone, onAgentResume, onAgentStream, onAgentThinking, onAgentToolCall, onAgentStatus, onAgentStopped, onAgentTaskCancelled, onInactiveTasks, onAgentTaskResumed, onCachedEvents, setTypingAgents, setCompletedAgents, setToolCalls, setStreamingThinking, setStreamingContent, setStreamEvents, setAgentStatuses, setAgentQueueCounts, setExecutingChatRooms, setInactiveTasks, setStreamingViewAgent, setSidePanelMode])

  // 切换群聊时加入房间
  useEffect(() => {
    setActiveChatRoomId(chatRoomId)

    if (!chatRoomId) return

    if (prevChatRoomIdRef.current && prevChatRoomIdRef.current !== chatRoomId) {
      leaveChatRoom(prevChatRoomIdRef.current)
      setSidePanelMode(null)
      setSelectedRoomAgent(null)
      setStreamingViewAgent(null)
      setSelectedRecord(null)
      // 不清空 agent 执行状态，保持全局状态以便切换回来时能显示
      // typingAgents, completedAgents, toolCalls 等状态会在 agent:done 时自动清理
    }

    if (isConnected) {
      joinChatRoom(chatRoomId)
      // 请求 agent 状态（用于恢复正在执行的 agent 显示）
      requestAgentStatus(chatRoomId)
      // 标记群聊已读
      markChatRoomRead(chatRoomId)
    }

    prevChatRoomIdRef.current = chatRoomId
    loadMessages(chatRoomId)

    return () => {
      leaveChatRoom(chatRoomId)
    }
  }, [chatRoomId, isConnected, joinChatRoom, leaveChatRoom, loadMessages, setActiveChatRoomId, setSidePanelMode, setSelectedRoomAgent, setStreamingViewAgent, setSelectedRecord, requestAgentStatus, markChatRoomRead])

  // 计算属性
  const chatRoomAgents = chatRoom?.chatRoomAgents ?? []
  const currentAgentIds = useMemo(
    () => new Set(chatRoomAgents.map(a => a.agentId).filter(Boolean) as string[]),
    [chatRoomAgents]
  )
  const availableAgents = useMemo(
    () => getAvailableAgents(currentAgentIds),
    [getAvailableAgents, currentAgentIds]
  )
  const mentionAgents = useMemo(
    () => getMentionAgents(chatRoomAgents),
    [getMentionAgents, chatRoomAgents]
  )
  // 处理函数
  const handleSend = useCallback(async () => {
    // 直接从 store 获取最新值，避免闭包延迟问题
    const { inputValue: currentInputValue, pendingImages: currentPendingImages } = useChatStore.getState()

    if (!chatRoom) return

    const trimmedInput = currentInputValue.trim()

    // 获取已上传成功的图片
    const uploadedImages = currentPendingImages.filter(img => img.uploadedData && !img.error)

    // 必须有内容或图片才能发送
    if (!trimmedInput && uploadedImages.length === 0) return

    const isRoomNewCommand =
      trimmedInput.toLowerCase() === '/new' &&
      uploadedImages.length === 0 &&
      getMentionedAgentNames(trimmedInput).length === 0
    if (isRoomNewCommand) {
      await clearMessages(chatRoom.id)
      setInputValue('')
      useChatStore.getState().setForceScrollToBottom(true)
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      return
    }

    if (
      !chatRoom.isQuickChatRoom &&
      !chatRoom.defaultAgentId &&
      !hasMentionedDispatchableAgent(trimmedInput, chatRoom, allAgents)
    ) {
      toast.warning(missingRecipientToast)
      return
    }

    // 构建附件数据
    const attachments = uploadedImages.map(img => img.uploadedData!).map(data => ({
      url: data.url,
      filename: data.filename,
      mimeType: data.mimeType,
      size: data.size,
      width: data.width,
      height: data.height,
      base64: data.base64,
    }))

    // 消息内容不再包含 Markdown 图片格式，图片通过 attachments 传递
    const content = trimmedInput

    // 生成临时消息 ID（兼容 Android WebView）
    const tempMessageId = generateUUID()
    const tempTime = new Date().toISOString()

    sendMessage({
      chatRoomId: chatRoom.id,
      content,
      isHuman: true,
      attachments,
    })

    // 发送消息时立即更新群聊的 lastMessage（使用临时数据）
    useChatRoomStore.getState().updateRoomLastMessage(chatRoom.id, {
      id: tempMessageId,
      content,
      time: tempTime,
      isHuman: true,
      userId: null, // 发送时不知道 userId，WebSocket 会返回正确的数据
      agentId: null,
      user: null,
      agent: null,
    })

    setInputValue('')
    // 清理已发送的图片
    useChatStore.getState().clearPendingImages()
    // 发送消息后强制滚动到底部
    useChatStore.getState().setForceScrollToBottom(true)
    // 移动端收起键盘：blur 当前活跃元素
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [allAgents, chatRoom, clearMessages, sendMessage, setInputValue])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // 中文输入过程中不响应回车（检测 nativeEvent.isComposing）
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleAddAgents = useCallback(async (agentIds: string[]) => {
    if (!chatRoom) return
    setAddingAgentIds(new Set(agentIds))
    try {
      // 依次添加每个助手（默认注入群历史消息）
      for (const agentId of agentIds) {
        await chatRoomApi.addAgent(chatRoom.id, {
          agentId,
          injectGroupHistory: true,
        })
      }
      onChatRoomChange?.()
      loadMessages(chatRoom.id)
    } catch (error) {
      console.error('Failed to add agents:', error)
    } finally {
      setAddingAgentIds(new Set())
      setShowAddAgent(false)
    }
  }, [chatRoom, onChatRoomChange, loadMessages, setAddingAgentIds, setShowAddAgent])

  const handleClearMessages = useCallback(async () => {
    if (!chatRoom) return
    await clearMessages(chatRoom.id)
  }, [chatRoom, clearMessages])

  const handleAgentAvatarClick = useCallback((agentId: string, agentName: string) => {
    const found = allAgents.find(a => a.id === agentId || a.name === agentName)
    if (found) {
      // 从 chatRoom.chatRoomAgents 中查找 chatRoomAgentId 和 agentType
      const roomAgent = chatRoom?.chatRoomAgents?.find(
        ra => ra.agentId === found.id || ra.agent?.name === found.name
      )
      setSelectedRoomAgent({
        id: found.id,
        name: found.name,
        avatar: found.avatar,
        avatarColor: found.avatarColor,
        description: found.description,
        chatRoomAgentId: roomAgent?.id,
        agentType: roomAgent?.agent?.type,
        chatRoomId: chatRoom?.id,
        injectGroupHistory: roomAgent?.injectGroupHistory ?? true,
      })
      setSidePanelMode('agent-detail')
    }
  }, [allAgents, chatRoom, setSelectedRoomAgent, setSidePanelMode])

  const handleTypingAgentClick = useCallback((messageId: string, agentId: string, agentName: string) => {
    setStreamingViewAgent({ messageId, agentId, name: agentName })
    setSidePanelMode('stream')
  }, [setStreamingViewAgent, setSidePanelMode])

  const handleReplyClick = useCallback((messageId: string) => {
    const { messages } = useChatStore.getState()
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setSelectedReplyMessage(message)
      setSidePanelMode('reply-detail')
    }
  }, [setSelectedReplyMessage, setSidePanelMode])

  const handleExecutionDetailClick = useCallback(async (messageId: string, _executionRecordId: string) => {
    await loadExecutionDetailByMessage(messageId)
    setSidePanelMode('execution-detail')
  }, [loadExecutionDetailByMessage, setSidePanelMode])

  const loadDebugInfoWrapper = useCallback(async () => {
    if (!chatRoom || !selectedRoomAgent) return
    await loadDebugInfo(chatRoom.id, selectedRoomAgent.name)
  }, [chatRoom, selectedRoomAgent, loadDebugInfo])

  const loadExecutionRecordsWrapper = useCallback(async () => {
    if (!chatRoom || !selectedRoomAgent) return
    await loadExecutionRecords(chatRoom.id, selectedRoomAgent.id)
  }, [chatRoom, selectedRoomAgent, loadExecutionRecords])

  const loadContextInfoWrapper = useCallback(async () => {
    if (!chatRoom || !selectedRoomAgent?.chatRoomAgentId) return
    await loadContextInfo(chatRoom.id, selectedRoomAgent.chatRoomAgentId)
  }, [chatRoom, selectedRoomAgent, loadContextInfo])

  const loadOlderMessagesWrapper = useCallback(async () => {
    if (!chatRoom) return
    await loadOlderMessages(chatRoom.id)
  }, [chatRoom, loadOlderMessages])

  // 从 ExecutionRecord 恢复 streamEvents（用于页面刷新后恢复流式输出面板数据）
  const restoreStreamEventsFromRecord = useCallback(async (agentId: string) => {
    if (!chatRoom) return

    const { streamEvents } = useChatStore.getState()

    // 如果已有流式数据，不恢复
    if (streamEvents.has(agentId)) return

    try {
      // 获取最新的执行记录
      const response = await debugApi.getExecutionRecords(chatRoom.id, agentId, 1)
      if (!response.success || !response.data || response.data.length === 0) return

      const record = response.data[0]

      // 只恢复正在执行的记录（status 不是 completed 或 failed）
      // 已完成的记录不应该恢复到流式面板
      if (record.status === 'completed' || record.status === 'failed') {
        console.log('[restoreStreamEvents] 最新记录已完成，不恢复')
        return
      }

      const now = Date.now()
      const events: StreamEvent[] = []

      // 使用新的 events 字段
      if (record.events && record.events.length > 0) {
        for (const event of record.events) {
          if (event.type === 'thinking') {
            events.push({
              id: `thinking-${event.timestamp}`,
              type: 'thinking',
              content: event.data.content || '',
              timestamp: event.timestamp,
              endTime: now,
            })
          } else if (event.type === 'tool_call') {
            events.push({
              id: `tool-${event.data.toolCallId || event.data.name}`,
              type: 'tool_call',
              toolCall: {
                name: event.data.name || '',
                input: event.data.input || {},
                toolCallId: event.data.toolCallId || event.data.name || '',
                status: event.data.status || 'completed',
                output: event.data.output,
              },
              status: event.data.status || 'completed',
              timestamp: event.timestamp,
              endTime: now,
            })
          } else if (event.type === 'output') {
            events.push({
              id: `output-${event.timestamp}`,
              type: 'output',
              content: event.data.content || '',
              timestamp: event.timestamp,
              endTime: now,
            })
          }
        }
      } else {
        // 兼容旧数据：从旧字段构建事件
        if (record.thinking) {
          const thinkingContent = typeof record.thinking === 'string'
            ? record.thinking
            : record.thinking.content
          events.push({
            id: `thinking-${record.createdAt}`,
            type: 'thinking',
            content: thinkingContent,
            timestamp: new Date(record.createdAt).getTime(),
            endTime: now,
          })
        }

        for (const tc of record.toolCalls) {
          events.push({
            id: `tool-${tc.toolCallId || tc.name}`,
            type: 'tool_call',
            toolCall: {
              name: tc.name,
              input: tc.input,
              toolCallId: tc.toolCallId || tc.name,
              status: tc.status || 'completed',
              output: tc.output,
            },
            status: tc.status || 'completed',
            timestamp: new Date(record.createdAt).getTime(),
            endTime: now,
          })
        }

        const outputContent = record.actions
          .filter(a => a.type === 'message')
          .map(a => a.content)
          .join('')

        if (outputContent) {
          events.push({
            id: `output-${record.createdAt}`,
            type: 'output',
            content: outputContent,
            timestamp: new Date(record.createdAt).getTime(),
            endTime: now,
          })
        }
      }

      if (events.length > 0) {
        console.log('[restoreStreamEvents] 恢复成功，事件数量:', events.length)
        const newStreamEvents = new Map(streamEvents)
        newStreamEvents.set(agentId, events)
        setStreamEvents(newStreamEvents)
      } else {
        console.log('[restoreStreamEvents] 没有事件需要恢复')
      }
    } catch (error) {
      console.error('[restoreStreamEvents] 恢复失败:', error)
    }
  }, [chatRoom, setStreamEvents])

  return {
    inputValue,
    setInputValue,
    messages,
    loading,
    loadingOlderMessages,
    hasOlderMessages,
    typingAgents,
    streamingContent,
    streamingThinking,
    toolCalls,
    completedAgents,
    mentionAgents,
    sidePanelMode,
    setSidePanelMode,
    debugInfo,
    debugLoading,
    executionRecords,
    recordsLoading,
    selectedRecord,
    setSelectedRecord,
    selectedRoomAgent,
    setSelectedRoomAgent,
    streamingViewAgent,
    setStreamingViewAgent,
    selectedReplyMessage,
    setSelectedReplyMessage,
    showAddAgent,
    setShowAddAgent,
    addingAgentIds,
    showClearConfirm,
    setShowClearConfirm,
    clearing,
    availableAgents,
    streamEvents,
    agentStatuses,
    executingChatRooms,
    loadOlderMessages: loadOlderMessagesWrapper,
    handleSend,
    handleKeyDown,
    handleAddAgents,
    handleClearMessages,
    deleteMessage,
    deleteMessages: useChatStore((s) => s.deleteMessages),
    handleAgentAvatarClick,
    handleTypingAgentClick,
    handleReplyClick,
    handleExecutionDetailClick,
    getReplies,
    messagesEndRef,
    loadDebugInfo: loadDebugInfoWrapper,
    loadExecutionRecords: loadExecutionRecordsWrapper,
    loadContextInfo: loadContextInfoWrapper,
    restoreStreamEventsFromRecord,
    contextLoading,
    contextInfo,
    executionDetailRecord,
    executionDetailLoading,
    // 图片上传相关
    pendingImages: useChatStore((s) => s.pendingImages),
    handleImageSelect: useChatStore((s) => s.handleImageSelect),
    removePendingImage: useChatStore((s) => s.removePendingImage),
  }
}
