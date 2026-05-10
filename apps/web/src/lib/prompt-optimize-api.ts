import { getApiBaseUrl } from './config'

interface OptimizePromptResponse {
  success: boolean
  data?: string
  error?: string
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
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

  return response.json()
}

export const promptOptimizeApi = {
  /**
   * 使用 AI 优化提示词（非流式）
   * @param prompt 原始提示词
   * @returns 优化后的提示词
   */
  async optimize(prompt: string): Promise<OptimizePromptResponse> {
    return request<OptimizePromptResponse>('/agents/optimize-prompt', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    })
  },

  /**
   * 使用 AI 优化提示词（流式输出）
   * @param prompt 原始提示词
   * @param onChunk 每次收到内容块的回调
   * @param onDone 完成时的回调
   * @param onError 错误时的回调
   */
  async optimizeStream(
    prompt: string,
    onChunk: (content: string) => void,
    onDone: () => void,
    onError: (error: string) => void
  ): Promise<void> {
    const baseUrl = await getApiBaseUrl()
    const response = await fetch(`${baseUrl}/agents/optimize-prompt-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })

    if (!response.ok) {
      onError('请求失败')
      return
    }

    const reader = response.body?.getReader()
    if (!reader) {
      onError('无法读取响应流')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 解析 SSE 数据
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))

              if (data.error) {
                onError(data.error)
                return
              }

              if (data.done) {
                onDone()
                return
              }

              if (data.content) {
                onChunk(data.content)
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } catch (error: any) {
      onError(error.message || '流式读取失败')
    }
  },
}
