import { getApiBaseUrl } from './config';

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  const hasBody = options?.body !== undefined;
  const token = localStorage.getItem('auth_token');
  const headers: HeadersInit = {
    ...(hasBody && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options?.headers,
  };

  const response = await fetch(url, { ...options, headers });
  return response.json();
}

export interface ChatRoomCommand {
  id: string;
  chatRoomId: string;
  name: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface CreateChatRoomCommandData {
  name: string;
  content: string;
  sortOrder?: number;
}

export interface UpdateChatRoomCommandData {
  name?: string;
  content?: string;
  sortOrder?: number;
}

export const chatRoomCommandApi = {
  async list(chatRoomId: string): Promise<ChatRoomCommand[]> {
    const response = await request<ChatRoomCommand[]>(
      `/chatrooms/${chatRoomId}/commands`
    );
    return response.data ?? [];
  },

  async create(
    chatRoomId: string,
    data: CreateChatRoomCommandData
  ): Promise<ApiResponse<ChatRoomCommand>> {
    return request<ChatRoomCommand>(`/chatrooms/${chatRoomId}/commands`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(
    commandId: string,
    data: UpdateChatRoomCommandData
  ): Promise<ApiResponse<ChatRoomCommand>> {
    return request<ChatRoomCommand>(`/commands/${commandId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async remove(commandId: string): Promise<void> {
    await request<void>(`/commands/${commandId}`, { method: 'DELETE' });
  },
};
