import { getApiBaseUrl } from './config';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

async function request<T>(
  endpoint: string,
  options?: RequestInit & { params?: Record<string, any> }
): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl();

  // 处理查询参数
  let url = `${baseUrl}${endpoint}`;
  if (options?.params) {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        queryParams.append(key, String(value));
      }
    }
    url += `?${queryParams.toString()}`;
  }

  const hasBody = options?.body !== undefined;
  const headers: HeadersInit = {
    ...(hasBody && { 'Content-Type': 'application/json' }),
    ...options?.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json();
  return data;
}

export interface CronTask {
  id: string;
  chatRoomId: string;
  name: string;
  description: string | null;
  scheduleType: 'cron' | 'interval' | 'once';
  cronExpression: string | null;
  intervalMinutes: number | null;
  scheduledAt: string | null;
  payload: string;
  agentIds: string[] | null;  // 选中触发的助手 ID 列表，["*"] 表示所有助手；执行时逐个发送
  enabled: boolean;
  maxRetries: number;
  retryCount: number;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  chatRoom: {
    id: string;
    name: string;
  };
}

export interface CronTaskExecution {
  id: string;
  cronTaskId: string;
  triggeredAt: string;
  startedAt: string | null;
  completedAt: string | null;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  executionRecordId: string | null;
  errorMessage: string | null;
  duration: number | null;
  payloadSnapshot: string;
}

export interface CreateCronTaskData {
  name: string;
  description?: string;
  scheduleType: 'cron' | 'interval' | 'once';
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledAt?: string;
  payload: string;
  agentIds?: string[];  // 选中的助手 ID 列表，["*"] 表示所有助手；执行时逐个发送
  enabled?: boolean;
  maxRetries?: number;
}

export interface UpdateCronTaskData {
  name?: string;
  description?: string;
  scheduleType?: 'cron' | 'interval' | 'once';
  cronExpression?: string;
  intervalMinutes?: number;
  scheduledAt?: string;
  payload?: string;
  agentIds?: string[];
  enabled?: boolean;
  maxRetries?: number;
}

export const cronTaskApi = {
  // 获取群聊的定时任务列表
  async getByChatRoom(chatRoomId: string): Promise<CronTask[]> {
    const response = await request<CronTask[]>(
      `/chatrooms/${chatRoomId}/cron-tasks`
    );
    return response.data!;
  },

  // 创建定时任务
  async create(chatRoomId: string, data: CreateCronTaskData): Promise<CronTask> {
    const response = await request<CronTask>(
      `/chatrooms/${chatRoomId}/cron-tasks`,
      { method: 'POST', body: JSON.stringify(data) }
    );
    return response.data!;
  },

  // 获取单个定时任务
  async getById(taskId: string): Promise<CronTask> {
    const response = await request<CronTask>(
      `/cron-tasks/${taskId}`
    );
    return response.data!;
  },

  // 更新定时任务
  async update(taskId: string, data: UpdateCronTaskData): Promise<CronTask> {
    const response = await request<CronTask>(
      `/cron-tasks/${taskId}`,
      { method: 'PUT', body: JSON.stringify(data) }
    );
    return response.data!;
  },

  // 启用/禁用定时任务
  async setEnabled(taskId: string, enabled: boolean): Promise<CronTask> {
    const response = await request<CronTask>(
      `/cron-tasks/${taskId}/enable`,
      { method: 'PATCH', body: JSON.stringify({ enabled }) }
    );
    return response.data!;
  },

  // 删除定时任务
  async delete(taskId: string): Promise<void> {
    await request<void>(`/cron-tasks/${taskId}`, { method: 'DELETE' });
  },

  // 获取执行历史
  async getExecutions(taskId: string, limit?: number): Promise<CronTaskExecution[]> {
    const response = await request<CronTaskExecution[]>(
      `/cron-tasks/${taskId}/executions`,
      { params: { limit } }
    );
    return response.data!;
  },

  // 测试执行任务
  async testExecute(taskId: string): Promise<{ success: boolean; error?: string }> {
    const response = await request<{ success: boolean; error?: string }>(
      `/cron-tasks/${taskId}/test`,
      { method: 'POST' }
    );
    return response.data!;
  },
};
