import { getApiBaseUrl } from './config'

// 本地模型配置
export interface LocalModelConfig {
  id: string
  name: string
  apiUrl?: string
  apiKey?: string
}

// ACP 工具信息
export interface AcpToolInfo {
  id: string
  name: string
  description: string
  installed: boolean
  version?: string
  cliInstalled: boolean
  cliVersion?: string
  sdkInstalled: boolean
  sdkVersion?: string
  preferredRuntime?: 'sdk' | 'cli'
  localConfigAvailable?: boolean
  localConfigPath?: string
  localConfigLabel?: string
  localModels?: LocalModelConfig[]
}

// 引导状态
export interface SetupStatus {
  setupCompleted: boolean
  defaultAcpTool: string
  installedTools: AcpToolInfo[]
}

// 模型配置（引导阶段可选）
export interface SetupModelConfig {
  apiUrl?: string
  apiKey: string
  model: string
  apiProtocol: string
}

// 完成引导请求
export interface CompleteSetupRequest {
  username: string
  password: string
  avatar?: string
  defaultAcpTool: string
  modelConfig?: SetupModelConfig
}

// 完成引导响应
export interface CompleteSetupResponse {
  token: string
  userId: string
  username: string
  defaultChatRoomId: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = await getApiBaseUrl()
  const token = localStorage.getItem('auth_token')
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...options,
  })
  const json = await res.json()
  if (!json.success) {
    throw new Error(json.error || '请求失败')
  }
  return json.data as T
}

export const setupApi = {
  getStatus(): Promise<SetupStatus> {
    return request<SetupStatus>('/setup/status')
  },

  completeSetup(data: CompleteSetupRequest): Promise<CompleteSetupResponse> {
    return request<CompleteSetupResponse>('/setup/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  /**
   * 安装 ACP 工具，流式返回安装日志
   * @returns 最终退出码（0 = 成功）
   */
  async installTool(toolId: string, onLog: (text: string) => void): Promise<number> {
    const baseUrl = await getApiBaseUrl()
    const res = await fetch(`${baseUrl}/setup/install-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId }),
    })

    const reader = res.body?.getReader()
    if (!reader) throw new Error('无法读取安装输出')

    const decoder = new TextDecoder()
    let exitCode = 1

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value, { stream: true })

      // 检查退出码标记
      const exitMatch = text.match(/__EXIT_CODE__:(\d+)/)
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10)
      }

      // 过滤掉控制标记，其余输出给调用方
      const filtered = text.replace(/__EXIT_CODE__:\d+/g, '').replace(/__ERROR__:.+/g, '')
      if (filtered.trim()) {
        onLog(filtered)
      }
    }

    return exitCode
  },
}
