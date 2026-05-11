import { getApiBaseUrl } from './config'

export type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq'

export interface ExternalChannel {
  id: string
  platform: Platform
  externalId: string
  chatRoomId: string
  chatRoom: { id: string; name: string }
  botToken?: string
  webhookSecret?: string
  defaultAgentId?: string
  defaultAgent?: { id: string; name: string }
  config?: string
  enabled: boolean
  createdAt: string
}

export interface CreateChannelRequest {
  platform: Platform
  externalId: string
  chatRoomId: string
  botToken?: string
  webhookSecret?: string
  defaultAgentId?: string
  config?: string
}

export interface UpdateChannelRequest {
  botToken?: string
  webhookSecret?: string
  defaultAgentId?: string
  enabled?: boolean
}

export type WebhookUrls = Record<Platform, string>

export interface BridgeEvent {
  id: string
  platform: Platform
  externalId: string
  direction: 'inbound' | 'outbound'
  status: 'success' | 'failed'
  messageId?: string
  agentName?: string
  errorMsg?: string
  createdAt: string
}

export interface PlatformConfig {
  platform: Platform
  botToken: string  // 脱敏后的值，非空表示已配置
  hasConfig: boolean  // config 字段是否已设置
  defaultAgentId: string | null
  defaultAgent: { id: string; name: string } | null
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string }> {
  const baseUrl = await getApiBaseUrl()
  const hasBody = options?.body !== undefined
  const headers: HeadersInit = {
    ...(hasBody && { 'Content-Type': 'application/json' }),
    ...options?.headers,
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
    cache: 'no-store',
  })

  const data = await response.json()
  return data
}

export const bridgeApi = {
  listChannels: async (platform?: Platform): Promise<ExternalChannel[]> => {
    const query = platform ? `?platform=${platform}` : ''
    const res = await request<ExternalChannel[]>(`/api/bridge/channels${query}`)
    return res.success && res.data ? res.data : []
  },

  createChannel: async (data: CreateChannelRequest): Promise<ExternalChannel> => {
    const res = await request<ExternalChannel>('/api/bridge/channels', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    if (!res.success || !res.data) throw new Error(res.error || '创建失败')
    return res.data
  },

  updateChannel: async (id: string, data: UpdateChannelRequest): Promise<ExternalChannel> => {
    const res = await request<ExternalChannel>(`/api/bridge/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    if (!res.success || !res.data) throw new Error(res.error || '更新失败')
    return res.data
  },

  deleteChannel: async (id: string): Promise<void> => {
    await request<void>(`/api/bridge/channels/${id}`, { method: 'DELETE' })
  },

  getWebhookUrls: async (): Promise<WebhookUrls> => {
    const res = await request<WebhookUrls>('/api/bridge/webhook-url')
    if (!res.success || !res.data) throw new Error(res.error || '获取 Webhook 地址失败')
    return res.data
  },

  getPlatformConfig: async (platform: Platform): Promise<PlatformConfig> => {
    const res = await request<PlatformConfig>(`/api/bridge/platform-config/${platform}`)
    if (!res.success || !res.data) throw new Error(res.error || '获取配置失败')
    return res.data
  },

  setPlatformConfig: async (platform: Platform, data: { botToken?: string; defaultAgentId?: string | null; config?: Record<string, unknown> }): Promise<PlatformConfig> => {
    const res = await request<PlatformConfig>(`/api/bridge/platform-config/${platform}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
    if (!res.success || !res.data) throw new Error(res.error || '保存配置失败')
    return res.data
  },

  getBindCode: async (platform: Platform, chatRoomId: string): Promise<{ code: string; expiresIn: number }> => {
    const res = await request<{ code: string; expiresIn: number }>('/api/bridge/bind-code', {
      method: 'POST',
      body: JSON.stringify({ platform, chatRoomId }),
    })
    if (!res.success || !res.data) throw new Error(res.error || '生成绑定码失败')
    return res.data
  },

  listEvents: async (platform?: Platform, limit = 20): Promise<BridgeEvent[]> => {
    const params = new URLSearchParams()
    if (platform) params.set('platform', platform)
    params.set('limit', String(limit))
    const res = await request<BridgeEvent[]>(`/api/bridge/events?${params.toString()}`)
    return res.success && res.data ? res.data : []
  },
}
