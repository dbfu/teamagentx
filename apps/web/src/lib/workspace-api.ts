import { getApiBaseUrl } from './config'

export interface WorkspaceEntry {
  path: string
  name: string
  kind: 'file' | 'directory'
  depth: number
  size: number | null
}

export interface WorkspaceFilePreview {
  path: string
  name: string
  kind: 'text' | 'image' | 'unsupported'
  mimeType: string
  content: string
  size: number
}

export interface WorkspaceTree {
  root: string
  entries: WorkspaceEntry[]
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function request<T>(endpoint: string): Promise<ApiResponse<T>> {
  try {
    const baseUrl = await getApiBaseUrl()
    const token = localStorage.getItem('auth_token')
    const response = await fetch(`${baseUrl}${endpoint}`, {
      cache: 'no-store',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    return await response.json() as ApiResponse<T>
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : '网络请求失败' }
  }
}

export const workspaceApi = {
  async getTree(chatRoomId: string): Promise<ApiResponse<WorkspaceTree>> {
    return request<WorkspaceTree>(`/chatrooms/${encodeURIComponent(chatRoomId)}/workspace/tree`)
  },

  async getFile(chatRoomId: string, filePath: string): Promise<ApiResponse<{ file: WorkspaceFilePreview }>> {
    return request<{ file: WorkspaceFilePreview }>(
      `/chatrooms/${encodeURIComponent(chatRoomId)}/workspace/file?path=${encodeURIComponent(filePath)}`,
    )
  },
}
