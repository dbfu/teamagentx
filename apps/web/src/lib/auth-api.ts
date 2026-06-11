import { getApiBaseUrl } from './config'

export interface User {
  id: string
  username: string
  avatar: string | null
  preferredLanguage?: string
  createdAt: string
}

export interface AuthResponse {
  user: User
  token: string
}

export interface RegisterRequest {
  username: string
  password: string
  avatar?: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface UpdateProfileRequest {
  username?: string
  avatar?: string
  preferredLanguage?: string
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl()
  const hasBody = options?.body !== undefined
  const token = localStorage.getItem('auth_token')
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

export const authApi = {
  // Check if this is first use (no users exist)
  async checkFirstUse(): Promise<ApiResponse<{ isFirstUse: boolean }>> {
    return request<{ isFirstUse: boolean }>('/auth/check-first-use')
  },

  // Register a new user
  async register(data: RegisterRequest): Promise<ApiResponse<AuthResponse>> {
    return request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // Login with username and password
  async login(data: LoginRequest): Promise<ApiResponse<AuthResponse>> {
    return request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  // Get current user info (requires token)
  async me(token: string): Promise<ApiResponse<User>> {
    return request<User>('/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  },

  // Update user profile (requires token)
  async updateProfile(token: string, data: UpdateProfileRequest): Promise<ApiResponse<User>> {
    return request<User>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
  },
}