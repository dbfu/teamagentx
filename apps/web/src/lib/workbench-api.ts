import { getApiBaseUrl } from './config'

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export type WorkbenchTaskStatus =
  | 'draft'
  | 'dispatched'
  | 'in_progress'
  | 'waiting_review'
  | 'needs_input'
  | 'completed'
  | 'blocked'

export type WorkbenchTaskPriority = 'low' | 'medium' | 'high'

export interface WorkbenchTask {
  id: string
  title: string
  description: string | null
  chatRoomId: string
  status: WorkbenchTaskStatus
  priority: WorkbenchTaskPriority
  dueText: string | null
  expectedOutput: string | null
  note: string | null
  dispatchMessageId: string | null
  createdBy: string | null
  dispatchedAt: string | null
  completedAt: string | null
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
  chatRoom: {
    id: string
    name: string
    avatar: string | null
    avatarColor: string | null
  }
}

export interface CreateWorkbenchTaskRequest {
  title: string
  description?: string | null
  chatRoomId: string
  expectedOutput?: string | null
  note?: string | null
}

export type RecommendWorkbenchRoomRequest = Pick<
  CreateWorkbenchTaskRequest,
  'title' | 'description' | 'expectedOutput' | 'note'
>

export interface WorkbenchRoomRecommendation {
  chatRoomId: string | null
  reason: string
}

export type UpdateWorkbenchTaskRequest = Partial<CreateWorkbenchTaskRequest> & {
  status?: WorkbenchTaskStatus
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl()
  const hasBody = options?.body !== undefined
  const token = localStorage.getItem('auth_token')
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      ...(hasBody && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
    cache: 'no-store',
  })

  return response.json()
}

export const workbenchApi = {
  async recommendRoom(data: RecommendWorkbenchRoomRequest) {
    return request<WorkbenchRoomRecommendation>('/workbench/recommend-room', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async getToday(date?: string) {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return request<WorkbenchTask[]>(`/workbench/tasks${suffix}`)
  },

  async create(data: CreateWorkbenchTaskRequest) {
    return request<WorkbenchTask>('/workbench/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  async update(id: string, data: UpdateWorkbenchTaskRequest) {
    return request<WorkbenchTask>(`/workbench/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  async delete(id: string) {
    return request<void>(`/workbench/tasks/${id}`, {
      method: 'DELETE',
    })
  },

  async dispatch(id: string) {
    return request<WorkbenchTask>(`/workbench/tasks/${id}/dispatch`, {
      method: 'POST',
    })
  },

  async dispatchBatch(ids: string[]) {
    return request<WorkbenchTask[]>('/workbench/tasks/dispatch-batch', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
  },
}
