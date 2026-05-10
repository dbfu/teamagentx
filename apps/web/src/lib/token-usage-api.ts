import { getApiBaseUrl } from './config'

// Token 使用统计接口
export interface TokenUsageStats {
  llmProviderId: string
  llmProviderName: string
  llmProviderType: string
  llmProviderModel: string
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  executionCount: number
}

export interface TokenUsageByProvider {
  provider: {
    id: string
    name: string
    type: string
    model: string
  }
  stats: TokenUsageStats
}

export interface DailyTokenUsage {
  date: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  executionCount: number
}

export interface AgentTokenUsage {
  agentId: string
  agentName: string
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  executionCount: number
}

export interface ProviderDetail {
  provider: {
    id: string
    name: string
    type: string
    model: string
  }
  totalStats: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    executionCount: number
  }
  agentBreakdown: AgentTokenUsage[]
  recentExecutions: Array<{
    id: string
    agentName: string
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    createdAt: string
  }>
}

// API 响应接口
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

// 请求函数
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
  })

  const data = await response.json()
  return data
}

// Token 使用统计 API
export const tokenUsageApi = {
  // 获取所有 Provider 的 token 使用统计
  async getByProvider(startDate?: string, endDate?: string): Promise<ApiResponse<TokenUsageByProvider[]>> {
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    return request<TokenUsageByProvider[]>(`/token-usage/by-provider?${params}`)
  },

  // 获取每日 token 使用趋势
  async getDaily(llmProviderId?: string, days?: number, startDate?: string, endDate?: string): Promise<ApiResponse<DailyTokenUsage[]>> {
    const params = new URLSearchParams()
    if (llmProviderId) params.set('llmProviderId', llmProviderId)
    if (days) params.set('days', String(days))
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    return request<DailyTokenUsage[]>(`/token-usage/daily?${params}`)
  },

  // 获取按 Agent 分组的 token 使用统计
  async getByAgent(llmProviderId?: string, startDate?: string, endDate?: string): Promise<ApiResponse<AgentTokenUsage[]>> {
    const params = new URLSearchParams()
    if (llmProviderId) params.set('llmProviderId', llmProviderId)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    return request<AgentTokenUsage[]>(`/token-usage/by-agent?${params}`)
  },

  // 获取单个 Provider 的详细使用情况
  async getProviderDetail(id: string, startDate?: string, endDate?: string): Promise<ApiResponse<ProviderDetail>> {
    const params = new URLSearchParams()
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)
    return request<ProviderDetail>(`/token-usage/provider/${id}/detail?${params}`)
  },

  // 格式化 token 数量（用于显示）
  formatTokens(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return String(num)
  },
}