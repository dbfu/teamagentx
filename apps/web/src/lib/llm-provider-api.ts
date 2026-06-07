import { getApiBaseUrl } from './config'

// LLM 供应商类型 - 仅支持自定义
export type LlmProviderType = 'custom'
export type LlmModelType = 'text' | 'image' | 'video' | 'audio'
export type AudioUsage = 'tts' | 'stt' | 'both'
export type ImageGenApiType = 'sync' | 'async' | 'auto'

// LLM 供应商接口
export interface LlmProvider {
  id: string
  name: string
  type: LlmProviderType
  modelType: LlmModelType
  apiProtocol: 'anthropic' | 'openai'
  codexWireApi: 'responses' | 'chat'
  apiUrl: string | null
  apiKey: string
  model: string
  sttModel: string | null
  audioUsage: AudioUsage
  imageProvider: string | null
  imageApiType: ImageGenApiType | null
  isActive: boolean
  isDefault: boolean
  createdAt: string
  updatedAt: string
  _count?: {
    agents: number
  }
}

// 创建 LLM 供应商请求
export interface CreateLlmProviderRequest {
  name: string
  type?: LlmProviderType
  modelType?: LlmModelType
  apiProtocol?: 'anthropic' | 'openai'
  codexWireApi?: 'responses' | 'chat'
  apiUrl?: string
  apiKey: string
  model: string
  sttModel?: string | null
  audioUsage?: AudioUsage
  imageProvider?: string | null
  imageApiType?: ImageGenApiType | null
  isActive?: boolean
  isDefault?: boolean
}

// 更新 LLM 供应商请求
export interface UpdateLlmProviderRequest {
  name?: string
  type?: LlmProviderType
  modelType?: LlmModelType
  apiProtocol?: 'anthropic' | 'openai'
  codexWireApi?: 'responses' | 'chat'
  apiUrl?: string
  apiKey?: string
  model?: string
  sttModel?: string | null
  audioUsage?: AudioUsage
  imageProvider?: string | null
  imageApiType?: ImageGenApiType | null
  isActive?: boolean
  isDefault?: boolean
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
  const token = localStorage.getItem('auth_token')
  const hasBody = options?.body !== undefined
  const headers: HeadersInit = {
    ...(hasBody && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options?.headers,
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  })

  const data = await response.json()
  return data
}

// LLM 供应商 API
export const llmProviderApi = {
  // 获取所有供应商
  async getAll(): Promise<ApiResponse<LlmProvider[]>> {
    return request<LlmProvider[]>('/llm-providers')
  },

  // 获取单个供应商
  async getById(id: string): Promise<ApiResponse<LlmProvider>> {
    return request<LlmProvider>(`/llm-providers/${id}`)
  },

  // 创建供应商
  async create(data: CreateLlmProviderRequest): Promise<ApiResponse<LlmProvider>> {
    return request<LlmProvider>('/llm-providers', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // 更新供应商
  async update(id: string, data: UpdateLlmProviderRequest): Promise<ApiResponse<LlmProvider>> {
    return request<LlmProvider>(`/llm-providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  // 删除供应商
  async delete(id: string): Promise<ApiResponse<LlmProvider>> {
    return request<LlmProvider>(`/llm-providers/${id}`, {
      method: 'DELETE',
    })
  },

  // 激活/停用供应商
  async setStatus(id: string, isActive: boolean): Promise<ApiResponse<LlmProvider>> {
    return request<LlmProvider>(`/llm-providers/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    })
  },

  // 设为默认供应商
  async setDefault(id: string): Promise<ApiResponse<LlmProvider>> {
    return request<LlmProvider>(`/llm-providers/${id}/default`, {
      method: 'PATCH',
    })
  },

  // 测试连接
  async testConnection(id: string): Promise<ApiResponse<{ connected: boolean; message: string; model: string }>> {
    return request<{ connected: boolean; message: string; model: string }>(`/llm-providers/${id}/test`, {
      method: 'POST',
    })
  },

  // 导出供应商（返回完整 API Key）
  async exportProviders(ids?: string[]): Promise<ApiResponse<LlmProvider[]>> {
    return request<LlmProvider[]>('/llm-providers/export', {
      method: 'POST',
      body: JSON.stringify({ ids: ids ?? [] }),
    })
  },

  // AI 解析模型配置描述
  async parseConfig(description: string): Promise<ApiResponse<ParsedModelConfig>> {
    return request<ParsedModelConfig>('/llm-providers/parse-config', {
      method: 'POST',
      body: JSON.stringify({ description }),
    })
  },
}

// AI 解析后的模型配置
export interface ParsedModelConfig {
  name: string | null
  apiUrl: string | null
  apiKey: string | null
  model: string | null
  apiProtocol: 'anthropic' | 'openai' | null
}
