import { getApiBaseUrl } from './config'

// 连接器（MCP server）传输类型
export type ConnectorTransport = 'stdio' | 'http'

// 连接器接口
export interface Connector {
  id: string
  name: string
  displayName: string
  description: string | null
  transport: ConnectorTransport
  command: string | null
  args: string | null // JSON 字符串
  env: string | null // JSON 字符串
  url: string | null
  headers: string | null // JSON 字符串
  enabled: boolean
  createdAt: string
  updatedAt: string
  _count?: {
    agents: number
  }
}

// 创建/更新连接器请求（args/env/headers 用对象，由后端序列化）
export interface ConnectorInput {
  name: string
  displayName: string
  description?: string | null
  transport?: ConnectorTransport
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  url?: string | null
  headers?: Record<string, string>
  enabled?: boolean
}

export interface ConnectorTestResult {
  connected: boolean
  message: string
  tools: { name: string; description?: string }[]
}

export interface AgentConnectorBinding {
  agentId: string
  connectorId: string
  enabled: boolean
  connector: Connector
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl()
  const token = localStorage.getItem('auth_token')
  const hasBody = options?.body !== undefined
  const headers: HeadersInit = {
    ...(hasBody && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options?.headers,
  }
  const response = await fetch(`${baseUrl}${endpoint}`, { ...options, headers })
  return response.json()
}

export interface McpConfig {
  mcpServers: Record<string, Record<string, unknown>>
}

export const connectorApi = {
  async getAll(): Promise<ApiResponse<Connector[]>> {
    return request<Connector[]>('/connectors')
  },

  // 读取全部连接器的标准 MCP JSON 配置
  async getConfig(): Promise<ApiResponse<McpConfig>> {
    return request<McpConfig>('/connectors/config')
  },

  // 用标准 MCP JSON 覆盖式同步连接器
  async saveConfig(mcpServers: Record<string, unknown>): Promise<ApiResponse<void>> {
    return request<void>('/connectors/config', {
      method: 'PUT',
      body: JSON.stringify({ mcpServers }),
    })
  },

  // 追加标准 MCP JSON 中的新连接器，不删除已有连接器，也不覆盖同名连接器
  async mergeConfig(mcpServers: Record<string, unknown>): Promise<ApiResponse<void>> {
    return request<void>('/connectors/config', {
      method: 'PATCH',
      body: JSON.stringify({ mcpServers }),
    })
  },

  async create(data: ConnectorInput): Promise<ApiResponse<Connector>> {
    return request<Connector>('/connectors', { method: 'POST', body: JSON.stringify(data) })
  },

  async update(id: string, data: Partial<ConnectorInput>): Promise<ApiResponse<Connector>> {
    return request<Connector>(`/connectors/${id}`, { method: 'PUT', body: JSON.stringify(data) })
  },

  async delete(id: string): Promise<ApiResponse<void>> {
    return request<void>(`/connectors/${id}`, { method: 'DELETE' })
  },

  async setStatus(id: string, enabled: boolean): Promise<ApiResponse<Connector>> {
    return request<Connector>(`/connectors/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    })
  },

  async test(data: ConnectorInput): Promise<ApiResponse<ConnectorTestResult>> {
    return request<ConnectorTestResult>('/connectors/test', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async getAgentConnectors(agentId: string): Promise<ApiResponse<AgentConnectorBinding[]>> {
    return request<AgentConnectorBinding[]>(`/agents/${agentId}/connectors`)
  },

  async setAgentConnectors(agentId: string, connectorIds: string[]): Promise<ApiResponse<void>> {
    return request<void>(`/agents/${agentId}/connectors`, {
      method: 'PUT',
      body: JSON.stringify({ connectorIds }),
    })
  },
}
