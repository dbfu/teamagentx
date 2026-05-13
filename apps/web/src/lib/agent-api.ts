import { getApiBaseUrl } from './config'
import type { SpeechProfile } from '@/speech'

// 分类相关类型
export interface AgentCategory {
  id: string
  name: string
  description: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
  _count?: {
    agents: number
  }
}

export interface CreateCategoryRequest {
  name: string
  description?: string
  sortOrder?: number
}

export interface UpdateCategoryRequest {
  name?: string
  description?: string
  sortOrder?: number
}

export interface Agent {
  id: string
  name: string
  avatar: string | null
  avatarColor: string | null
  description: string | null
  prompt: string
  type: 'builtin' | 'acp'
  agentLevel: 'normal' | 'system'
  acpTool: string | null
  workDir: string | null
  speechConfig: AgentSpeechConfig | null
  isActive: boolean
  categoryId: string | null
  category: AgentCategory | null
  llmProviderId: string | null
  llmProvider: {
    id: string
    name: string
    type: string
    apiUrl: string | null
    model: string
    isActive: boolean
    isDefault: boolean
  } | null
  sortOrder: number  // 同分类内的排序顺序
  createdAt: string
  updatedAt: string
}

export interface AgentSpeechBehaviorConfig {
  enabled: boolean
  outputMode: 'off' | 'manual' | 'auto_final_only'
  autoPlay: boolean
}

export interface AgentSpeechConfig {
  behavior: AgentSpeechBehaviorConfig
  profile: SpeechProfile
}

export interface CreateAgentRequest {
  name: string
  avatar?: string
  avatarColor?: string
  description?: string
  prompt: string
  type?: 'builtin' | 'acp'
  acpTool?: string
  workDir?: string
  speechConfig?: AgentSpeechConfig | null
  categoryId?: string
  llmProviderId?: string | null
  sortOrder?: number
}

export interface UpdateAgentRequest {
  name?: string
  avatar?: string
  avatarColor?: string
  description?: string
  prompt?: string
  isActive?: boolean
  type?: 'builtin' | 'acp'
  acpTool?: string
  workDir?: string
  speechConfig?: AgentSpeechConfig | null
  categoryId?: string | null
  llmProviderId?: string | null
  sortOrder?: number
}

export interface UpdateStatusRequest {
  isActive: boolean
}

// 最后一条消息类型
export interface LastMessage {
  id: string
  content: string
  time: string
  isHuman: boolean
  userId: string | null
  agentId: string | null
  user: {
    id: string
    username: string
  } | null
  agent: {
    id: string
    name: string
  } | null
}

export interface ChatRoom {
  id: string
  name: string
  avatar: string | null
  avatarColor: string | null
  description: string | null
  rules: string | null
  workDir: string | null
  ownerId: string | null
  isPinned?: boolean           // 是否置顶
  pinnedAt?: string | null     // 置顶时间
  createdAt: string
  updatedAt: string
  isQuickChatRoom?: boolean
  quickChatAgentId?: string | null
  defaultAgentId?: string | null
  agentTriggerMode?: 'auto' | 'manual'  // 助手触发模式：auto(自动) | manual(手动)
  owner?: {
    id: string
    username: string
    avatar: string | null
    avatarColor: string | null
  } | null
  chatRoomAgents: ChatRoomAgent[]
  messages?: Message[]
  lastMessage?: LastMessage | null  // 最后一条消息
}

export interface ChatRoomAgent {
  id: string
  userId: string | null
  agentId: string | null
  role: string
  injectGroupHistory: boolean
  customWorkDir: string | null
  joinedAt: string
  agent?: {
    id: string
    name: string
    avatar: string | null
    avatarColor: string | null
    description: string | null
    type?: 'builtin' | 'acp'
    agentLevel?: 'normal' | 'system'
    workDir?: string | null
  }
  user?: {
    id: string
    username: string
    avatar: string | null
    avatarColor: string | null
  }
}

export interface CreateChatRoomRequest {
  name: string
  avatar?: string
  avatarColor?: string
  description?: string
  rules?: string
  workDir?: string | null
  ownerId?: string
}

export interface AddAgentToChatRoomRequest {
  agentId?: string
  userId?: string
  role?: string
  injectGroupHistory?: boolean
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl()
  const hasBody = options?.body !== undefined
  const headers: HeadersInit = {
    ...(hasBody && { 'Content-Type': 'application/json' }),
    ...options?.headers,
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
    // 禁用缓存，确保每次请求都获取最新数据
    cache: 'no-store',
  })

  const data = await response.json()
  return data
}

// ACP 工具信息类型
export interface AcpToolInfo {
  id: string
  name: string
  description: string
  installed: boolean
  version?: string
  localConfigAvailable?: boolean
  localConfigPath?: string
  localConfigLabel?: string
}

export const acpToolsApi = {
  // 获取 ACP/SDK 工具列表及安装状态
  async getAll(): Promise<ApiResponse<AcpToolInfo[]>> {
    return request<AcpToolInfo[]>('/acp-tools')
  },
}

export const chatRoomApi = {
  // 获取所有群组
  async getAll(): Promise<ApiResponse<ChatRoom[]>> {
    return request<ChatRoom[]>('/chatrooms')
  },

  // 获取单个群组
  async getById(id: string): Promise<ApiResponse<ChatRoom>> {
    return request<ChatRoom>(`/chatrooms/${id}`)
  },

  // 创建群组
  async create(data: CreateChatRoomRequest): Promise<ApiResponse<ChatRoom>> {
    return request<ChatRoom>('/chatrooms', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // 删除群组
  async delete(id: string): Promise<ApiResponse<void>> {
    return request<void>(`/chatrooms/${id}`, {
      method: 'DELETE',
    })
  },

  // 更新群组
  async update(id: string, data: { name?: string; avatar?: string; avatarColor?: string; description?: string; rules?: string; workDir?: string | null; defaultAgentId?: string | null; agentTriggerMode?: 'auto' | 'manual' }): Promise<ApiResponse<ChatRoom>> {
    return request<ChatRoom>(`/chatrooms/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  // 添加助手到群组
  async addAgent(chatRoomId: string, data: AddAgentToChatRoomRequest): Promise<ApiResponse<ChatRoomAgent>> {
    return request<ChatRoomAgent>(`/chatrooms/${chatRoomId}/agents`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // 从群组移除助手
  async removeAgent(chatRoomId: string, agentId: string): Promise<ApiResponse<void>> {
    return request<void>(`/chatrooms/${chatRoomId}/agents/${agentId}`, {
      method: 'DELETE',
    })
  },

  // 更新群聊中助手的设置
  async updateAgentSettings(
    chatRoomId: string,
    agentId: string,
    data: { injectGroupHistory?: boolean }
  ): Promise<ApiResponse<ChatRoomAgent>> {
    return request<ChatRoomAgent>(`/chatrooms/${chatRoomId}/agents/${agentId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  // 清空群聊中助手的对话上下文
  async clearAgentContext(
    chatRoomId: string,
    agentId: string
  ): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return request<{ success: boolean; message: string }>(
      `/chatrooms/${chatRoomId}/agents/${agentId}/clear-context`,
      {
        method: 'POST',
      }
    )
  },

  // 获取群聊中助手的对话上下文
  async getAgentContext(
    chatRoomId: string,
    chatRoomAgentId: string
  ): Promise<ApiResponse<AgentContextInfo>> {
    return request<AgentContextInfo>(
      `/chatrooms/${chatRoomId}/agents/${chatRoomAgentId}/context`
    )
  },

  // 获取群聊中助手的任务队列
  async getAgentTasks(
    chatRoomId: string,
    agentId: string
  ): Promise<ApiResponse<AgentTask[]>> {
    return request<AgentTask[]>(
      `/chatrooms/${chatRoomId}/agents/${agentId}/tasks`
    )
  },

  // 获取群聊中所有助手的任务看板
  async getTaskBoard(
    chatRoomId: string,
    take = 50
  ): Promise<ApiResponse<ChatTaskBoard>> {
    return request<ChatTaskBoard>(
      `/chatrooms/${chatRoomId}/tasks/board?take=${take}`
    )
  },

  // 标记群聊已读（HTTP API 备用，主要通过 Socket 实现）
  async markAsRead(chatRoomId: string): Promise<ApiResponse<{ chatRoomId: string; count: number }>> {
    return request<{ chatRoomId: string; count: number }>(`/chatrooms/${chatRoomId}/mark-read`, {
      method: 'POST',
    })
  },

  // 获取未读数（HTTP API 备用，主要通过 Socket 实现）
  async getUnreadCounts(): Promise<ApiResponse<Record<string, number>>> {
    return request<Record<string, number>>('/chatrooms/unread-counts')
  },

  // 置顶群聊
  async pin(chatRoomId: string): Promise<ApiResponse<ChatRoom>> {
    return request<ChatRoom>(`/chatrooms/${chatRoomId}/pin`, {
      method: 'PATCH',
    })
  },

  // 取消置顶群聊
  async unpin(chatRoomId: string): Promise<ApiResponse<ChatRoom>> {
    return request<ChatRoom>(`/chatrooms/${chatRoomId}/unpin`, {
      method: 'PATCH',
    })
  },
}

// 消息附件类型
export interface Attachment {
  id: string
  type: 'image' | 'audio' | 'file'
  filename: string
  mimeType: string
  size: number
  url: string
  width: number | null
  height: number | null
  durationMs?: number | null
  transcript?: string | null
  waveform?: string | null
  createdAt: string
}

// 消息相关类型
export interface Message {
  id: string
  type: 'MESSAGE' | 'REPLY'
  content: string
  time: string
  userId: string | null
  agentId: string | null
  chatRoomId: string
  replyMessageId: string | null
  isHuman: boolean
  executionRecordId?: string | null  // 关联的执行记录 ID
  executionDuration?: number | null  // 执行耗时（毫秒）
  totalTokens?: number | null        // 消息消耗的 token 数
  cacheReadTokens?: number | null    // 缓存读取 token 数
  avatar?: string | null
  avatarColor?: string | null
  createdAt: string
  updatedAt: string
  user: {
    id: string
    socketId: string
    username: string
    avatar: string | null
  } | null
  agent: {
    id: string
    name: string
    avatar: string | null
    avatarColor: string | null
  } | null
  attachments?: Attachment[]  // 消息附件（图片等）
}

// Agent 调试信息类型
export interface AgentDebugInfo {
  name: string
  systemPrompt: string
  lastContext: string | null
  lastInvokeResult: string | null
  lastHistory: { content: string; senderName: string; isHuman: boolean }[] | null
  threadId: string
  chatRoomId: string
  injectGroupHistory: boolean
  chatRoomAgents: string[]
}

// Checkpoint 消息类型
export interface CheckpointMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp?: number
}

// Checkpoint 详情
export interface CheckpointDetail {
  checkpointId: string
  messages: CheckpointMessage[]
  createdAt?: string
}

// Agent 上下文信息类型（用于持久化查看）
export interface AgentContextInfo {
  agentName: string
  agentType: string
  latestExecution: {
    context: string | null
    systemPrompt: string
    thinking: string | null
    toolCalls: ToolCall[]
    triggerMessage: string
    triggerUser: string | null
    duration: number | null
    createdAt: string
  } | null
  checkpointStats: {
    count: number
    threadId: string
  }
  checkpointMessages: CheckpointDetail[]
  realtimeInfo: {
    threadId: string
    injectGroupHistory: boolean
    chatRoomAgents: string[]
  } | null
}

// Agent 任务队列类型
export interface AgentTask {
  id: string
  messageId: string
  messageContent: string
  createdAt: string
}

export interface ChatTaskBoardItem {
  id: string
  kind: 'task' | 'execution'
  agentId: string
  agentName: string
  messageId: string | null
  messageContent: string
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | string
  createdAt: string
  duration?: number | null
  errorMessage?: string | null
  executionRecordId?: string | null
}

export interface ChatTaskBoard {
  completed: ChatTaskBoardItem[]
  failed: ChatTaskBoardItem[]
  executing: ChatTaskBoardItem[]
  pending: ChatTaskBoardItem[]
  cancelled: ChatTaskBoardItem[]
}

// 执行事件类型
export type ExecutionEventType = 'thinking' | 'tool_call' | 'output';

// 执行事件接口
export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: number;
  data: {
    // thinking
    content?: string;
    // tool_call
    name?: string;
    input?: Record<string, unknown>;
    output?: string | Record<string, unknown>;
    status?: 'in_progress' | 'completed' | 'error';
    toolCallId?: string;
    // output
    type?: string;  // action type
    target?: string;
  };
}

// Agent 执行动作类型
export interface AgentAction {
  type: 'message'
  content: string
  target?: string
  timestamp?: number  // 执行时间戳
}

// 工具调用类型
export interface ToolCall {
  name: string
  input: Record<string, unknown>
  toolCallId?: string
  output?: string | Record<string, unknown>
  status?: 'in_progress' | 'completed' | 'error'
  timestamp?: number  // 执行时间戳
}

// 思考过程类型
export interface ThinkingRecord {
  content: string
  timestamp: number
}

// 执行记录类型
export interface ExecutionRecord {
  id: string
  chatRoomId: string
  agentId: string
  agentName: string
  triggerMessage: string
  triggerUser: string | null
  events: ExecutionEvent[]  // 新的统一事件数组
  context: string | null
  systemPrompt: string
  status: 'completed' | 'failed' | 'cancelled'
  errorMessage: string | null
  duration: number | null
  createdAt: string
  // Token 使用字段
  llmProviderId: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  // 兼容旧接口的字段（从 events 中提取）
  actions: AgentAction[]
  toolCalls: ToolCall[]
  thinking?: ThinkingRecord | string | null
  invokeResult: Record<string, unknown> | null
}

export const messageApi = {
  // 获取消息列表
  async getAll(chatRoomId?: string): Promise<ApiResponse<Message[]>> {
    const url = chatRoomId ? `/messages?chatRoomId=${chatRoomId}` : '/messages'
    return request<Message[]>(url)
  },

  // 获取单条消息
  async getById(id: string): Promise<ApiResponse<Message>> {
    return request<Message>(`/messages/${id}`)
  },

  // 删除单条消息
  async delete(id: string): Promise<ApiResponse<void>> {
    return request<void>(`/messages/${id}`, {
      method: 'DELETE',
    })
  },

  // 清空群组消息
  async clearByChatRoomId(chatRoomId: string): Promise<ApiResponse<void>> {
    return request<void>(`/messages/chatroom/${chatRoomId}`, {
      method: 'DELETE',
    })
  },

  // 获取消息的执行记录
  async getExecutionRecord(messageId: string): Promise<ApiResponse<ExecutionRecord>> {
    return request<ExecutionRecord>(`/messages/${messageId}/execution`)
  },
}

export const debugApi = {
  // 获取 Agent 调试信息
  async getAgentDebugInfo(chatRoomId: string, agentName: string): Promise<ApiResponse<AgentDebugInfo>> {
    return request<AgentDebugInfo>(`/chatrooms/${chatRoomId}/agents/${encodeURIComponent(agentName)}/debug`)
  },
  // 获取 Agent 执行记录列表
  async getExecutionRecords(chatRoomId: string, agentId: string, take?: number): Promise<ApiResponse<ExecutionRecord[]>> {
    const url = take ? `/chatrooms/${chatRoomId}/agents/${agentId}/executions?take=${take}` : `/chatrooms/${chatRoomId}/agents/${agentId}/executions`
    return request<ExecutionRecord[]>(url)
  },
}

// 分类 API
export const categoryApi = {
  // 获取所有分类
  async getAll(): Promise<ApiResponse<AgentCategory[]>> {
    return request<AgentCategory[]>('/categories')
  },

  // 获取单个分类（包含助手）
  async getById(id: string): Promise<ApiResponse<AgentCategory & { agents: Agent[] }>> {
    return request<AgentCategory & { agents: Agent[] }>(`/categories/${id}`)
  },

  // 创建分类
  async create(data: CreateCategoryRequest): Promise<ApiResponse<AgentCategory>> {
    return request<AgentCategory>('/categories', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // 更新分类
  async update(id: string, data: UpdateCategoryRequest): Promise<ApiResponse<AgentCategory>> {
    return request<AgentCategory>(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  // 删除分类
  async delete(id: string): Promise<ApiResponse<AgentCategory & { deletedAgentsCount: number }>> {
    return request<AgentCategory & { deletedAgentsCount: number }>(`/categories/${id}`, {
      method: 'DELETE',
    })
  },
}

// 分组显示类型
export interface AgentsGrouped {
  categories: {
    category: AgentCategory
    agents: Agent[]
  }[]
  uncategorized: Agent[]
}

// 扩展 agentApi
export const agentApi = {
  // 获取所有助手列表
  async getAll(): Promise<ApiResponse<Agent[]>> {
    return request<Agent[]>('/agents')
  },

  // 获取活跃助手列表
  async getActive(): Promise<ApiResponse<Agent[]>> {
    return request<Agent[]>('/agents/active')
  },

  // 获取按分类分组的助手列表
  async getGrouped(): Promise<ApiResponse<AgentsGrouped>> {
    return request<AgentsGrouped>('/agents/grouped')
  },

  // 获取单个助手
  async getById(id: string): Promise<ApiResponse<Agent>> {
    return request<Agent>(`/agents/${id}`)
  },

  // 创建助手
  async create(data: CreateAgentRequest): Promise<ApiResponse<Agent>> {
    return request<Agent>('/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // 更新助手
  async update(id: string, data: UpdateAgentRequest): Promise<ApiResponse<Agent>> {
    return request<Agent>(`/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  // 删除助手
  async delete(id: string): Promise<ApiResponse<Agent>> {
    return request<Agent>(`/agents/${id}`, {
      method: 'DELETE',
    })
  },

  // 更新助手状态（激活/停用）
  async updateStatus(id: string, isActive: boolean): Promise<ApiResponse<Agent>> {
    return request<Agent>(`/agents/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    })
  },

  // 批量更新助手排序
  async updateSortOrder(items: { id: string; sortOrder: number; categoryId?: string | null }[]): Promise<ApiResponse<void>> {
    return request<void>('/agents/sort-order', {
      method: 'PUT',
      body: JSON.stringify({ items }),
    })
  },

  // 创建快速对话
  async createQuickChat(agentId: string, userId: string, workDir?: string): Promise<ApiResponse<ChatRoom>> {
    return request<ChatRoom>('/agents/quick-chat', {
      method: 'POST',
      body: JSON.stringify({ agentId, userId, workDir }),
    })
  },

  // 获取快速对话历史会话
  async getQuickChatRooms(agentId: string, userId: string): Promise<ApiResponse<QuickChatSession[]>> {
    return request<QuickChatSession[]>(`/agents/${agentId}/quick-chat-rooms?userId=${userId}`)
  },

  // 获取快速对话群聊数量
  async getQuickChatCount(agentId: string, userId: string): Promise<ApiResponse<number>> {
    return request<number>(`/agents/${agentId}/quick-chat-count?userId=${userId}`)
  },

  // 获取 chatRoom 的快速对话会话信息
  async getQuickChatSession(chatRoomId: string): Promise<ApiResponse<QuickChatSession | null>> {
    return request<QuickChatSession | null>(`/chatrooms/${chatRoomId}/quick-chat-session`)
  },
}

// 快速对话会话类型
export interface QuickChatSession {
  id: string
  agentId: string
  chatRoomId: string
  sessionId: string
  workDir: string
  status: 'active' | 'archived'
  createdAt: string
  archivedAt: string | null
  chatRoom: {
    id: string
    name: string
    createdAt: string
    chatRoomAgents: Array<{
      id: string
      userId: string | null
      agentId: string | null
    }>
  }
}

// 上传结果类型
export interface UploadResult {
  success: boolean
  data?: {
    type: 'image' | 'audio'
    filename: string
    mimeType: string
    size: number
    url: string
    width?: number
    height?: number
    durationMs?: number
    transcript?: string | null
  }
  error?: string
}

// 上传 API
export const uploadApi = {
  // 上传单张图片
  async uploadImage(file: File): Promise<UploadResult> {
    const baseUrl = await getApiBaseUrl()
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
    })

    return response.json()
  },

  async uploadAudio(file: File): Promise<UploadResult> {
    const baseUrl = await getApiBaseUrl()
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch(`${baseUrl}/upload/audio`, {
      method: 'POST',
      body: formData,
    })

    return response.json()
  },

  // 批量上传图片
  async uploadImages(files: File[]): Promise<{ success: boolean; data: UploadResult['data'][]; error?: string }> {
    const baseUrl = await getApiBaseUrl()
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))

    const response = await fetch(`${baseUrl}/upload/images`, {
      method: 'POST',
      body: formData,
    })

    return response.json()
  },
}
