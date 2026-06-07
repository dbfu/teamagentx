import { getApiBaseUrl } from './config'

export type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq'

export interface BridgePlatformConfigFieldDefinition {
  key: string
  label: string
  description?: string
  secret?: boolean
  optional?: boolean
}

export interface BridgePlatformDefinition {
  key: Platform
  label: string
  emoji: string
  color: string
  groupIdHint: string
  supportsBindCode: boolean
  supportsManualChannelCreate: boolean
  configFields: BridgePlatformConfigFieldDefinition[]
  /** Whether this platform requires a public webhook URL to receive events */
  requiresPublicWebhook?: boolean
}

export interface BridgeBot {
  id: string
  platform: Platform
  name: string
  chatRoomId: string | null
  chatRoom: { id: string; name: string } | null
  botToken?: string
  defaultAgentId?: string
  defaultAgent?: { id: string; name: string; avatar?: string | null; avatarColor?: string | null }
  config?: string
  hasConfig?: boolean
  configValues?: Record<string, string>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateBridgeBotRequest {
  platform: Platform
  name: string
  botToken?: string
  defaultAgentId?: string
  config?: Record<string, unknown>
  chatRoomId?: string
}

export interface UpdateBridgeBotRequest {
  name?: string
  botToken?: string
  defaultAgentId?: string
  config?: Record<string, unknown> | null
  enabled?: boolean
}

export type WebhookUrls = Partial<Record<Platform, string>>

export interface BridgeEvent {
  id: string
  platform: Platform
  externalId: string
  direction: 'inbound' | 'outbound'
  status: 'success' | 'failed'
  messageId?: string
  contentPreview?: string
  agentName?: string
  errorMsg?: string
  createdAt: string
}

export interface BridgePlatformPlaybook {
  platform: Platform
  title: string
  consoleName: string
  prerequisites: string[]
  requiredCredentials: { key: string; label: string; howToGet: string; secret?: boolean }[]
  consoleSteps: string[]
  bindSteps: string[]
  notes: string[]
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; message?: string; error?: string }> {
  const baseUrl = await getApiBaseUrl()
  const token = localStorage.getItem('auth_token')
  const hasBody = options?.body !== undefined
  const headers: HeadersInit = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options?.headers,
  }

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers,
      cache: 'no-store',
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({})) as { message?: string; error?: string }
      throw new Error(err.message ?? err.error ?? `HTTP ${response.status}`)
    }

    if (response.status === 204) {
      return { success: true as const }
    }

    const data = await response.json() as { success: boolean; data?: T; message?: string; error?: string }
    return data
  } catch (err) {
    console.error('[bridge-api] 请求失败', err)
    return { success: false as const, error: err instanceof Error ? err.message : '网络错误' }
  }
}

export const bridgeApi = {
  listPlatforms: async (): Promise<BridgePlatformDefinition[]> => {
    const res = await request<BridgePlatformDefinition[]>('/api/bridge/platforms')
    if (!res.success || !res.data) throw new Error(res.error || '获取平台列表失败')
    return res.data
  },

  listBots: async (platform?: Platform): Promise<BridgeBot[]> => {
    const query = platform ? `?platform=${platform}` : ''
    const res = await request<BridgeBot[]>(`/api/bridge/bots${query}`)
    if (!res.success || !res.data) throw new Error(res.error || '获取机器人列表失败')
    return res.data
  },

  createBot: async (data: CreateBridgeBotRequest): Promise<BridgeBot> => {
    const res = await request<BridgeBot>('/api/bridge/bots', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (!res.success || !res.data) throw new Error(res.error || '创建失败')
    return res.data
  },

  updateBot: async (id: string, data: UpdateBridgeBotRequest): Promise<BridgeBot> => {
    const res = await request<BridgeBot>(`/api/bridge/bots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    if (!res.success || !res.data) throw new Error(res.error || '更新失败')
    return res.data
  },

  deleteBot: async (id: string): Promise<void> => {
    const res = await request<void>(`/api/bridge/bots/${id}`, { method: 'DELETE' })
    if (!res.success) throw new Error(res.error || '删除失败')
  },

  bindBot: async (id: string, chatRoomId: string, forceRebind = false): Promise<BridgeBot> => {
    const res = await request<BridgeBot>(`/api/bridge/bots/${id}/bind`, {
      method: 'POST',
      body: JSON.stringify({ chatRoomId, forceRebind }),
    })
    if (!res.success || !res.data) throw new Error(res.error || '绑定失败')
    return res.data
  },

  unbindBot: async (id: string): Promise<BridgeBot> => {
    const res = await request<BridgeBot>(`/api/bridge/bots/${id}/unbind`, {
      method: 'POST',
    })
    if (!res.success || !res.data) throw new Error(res.error || '解绑失败')
    return res.data
  },

  getBindCode: async (botId: string, chatRoomId: string): Promise<{ code: string; expiresIn: number }> => {
    const res = await request<{ code: string; expiresIn: number }>(`/api/bridge/bots/${botId}/bind-code`, {
      method: 'POST',
      body: JSON.stringify({ chatRoomId }),
    })
    if (!res.success || !res.data) throw new Error(res.error || '生成绑定码失败')
    return res.data
  },

  getBotWebhookUrl: async (botId: string): Promise<{ webhookUrl: string }> => {
    const res = await request<{ webhookUrl: string }>(`/api/bridge/bots/${botId}/webhook-url`)
    if (!res.success || !res.data) throw new Error(res.error || '获取 webhook 地址失败')
    return res.data
  },

  getWebhookUrls: async (): Promise<WebhookUrls> => {
    const res = await request<WebhookUrls>('/api/bridge/webhook-url')
    if (!res.success || !res.data) throw new Error(res.error || '获取 Webhook 地址失败')
    return res.data
  },

  getSystemConfig: async (): Promise<{ baseUrl: string }> => {
    const res = await request<{ baseUrl: string }>('/api/bridge/system-config')
    if (!res.success || !res.data) throw new Error(res.error || '获取系统配置失败')
    return res.data
  },

  setSystemConfig: async (baseUrl: string): Promise<{ baseUrl: string }> => {
    const res = await request<{ baseUrl: string }>('/api/bridge/system-config', {
      method: 'PUT',
      body: JSON.stringify({ baseUrl }),
    })
    if (!res.success || !res.data) throw new Error(res.error || '保存失败')
    return res.data
  },

  getPlaybook: async (platform: Platform): Promise<BridgePlatformPlaybook | null> => {
    const res = await request<BridgePlatformPlaybook>(`/api/bridge/playbooks/${platform}`)
    if (!res.success || !res.data) throw new Error(res.error || '获取接入说明失败')
    return res.data
  },

  listEvents: async (platform?: Platform, limit = 20): Promise<BridgeEvent[]> => {
    const params = new URLSearchParams()
    if (platform) params.set('platform', platform)
    params.set('limit', String(limit))
    const res = await request<BridgeEvent[]>(`/api/bridge/events?${params.toString()}`)
    if (!res.success || !res.data) throw new Error(res.error || '获取事件列表失败')
    return res.data
  },
}
