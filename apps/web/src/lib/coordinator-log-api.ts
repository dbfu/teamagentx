import { getApiBaseUrl } from './config';

export interface CoordinatorLog {
  id: string;
  chatRoomId: string;
  triggerMessageId: string;
  decision: string;
  targetAgentIds: string[] | null;
  content: string | null;
  forwardVerbatim: boolean;
  reason: string | null;
  sourceAgentId: string | null;
  sourceIsHuman: boolean;
  sourceContent: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
  chatRoom: {
    id: string;
    name: string;
    avatar: string | null;
  };
  sourceAgent: {
    id: string;
    name: string;
  } | null;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(endpoint: string): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl();
  const token = localStorage.getItem('auth_token');
  const headers: HeadersInit = {
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  const response = await fetch(`${baseUrl}${endpoint}`, { headers });
  const data = await response.json();
  return data;
}

export const coordinatorLogApi = {
  async getAll(): Promise<ApiResponse<Record<string, CoordinatorLog[]>>> {
    return request<Record<string, CoordinatorLog[]>>('/coordinator-logs');
  },

  async getByChatRoom(chatRoomId: string): Promise<ApiResponse<CoordinatorLog[]>> {
    return request<CoordinatorLog[]>(`/coordinator-logs/${chatRoomId}`);
  },
};