import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, User } from '@/lib/auth-api'

// 声明 FlutterChannel 类型
declare global {
  interface Window {
    FlutterChannel?: { postMessage: (msg: string) => void }
  }
}

const TOKEN_KEY = 'auth_token'

function consumeQrLoginToken() {
  if (typeof window === 'undefined') return null

  const currentUrl = new URL(window.location.href)
  if (currentUrl.searchParams.get('qrLogin') !== '1') return null

  const qrToken = currentUrl.searchParams.get('token')
  currentUrl.searchParams.delete('qrLogin')
  currentUrl.searchParams.delete('token')
  currentUrl.searchParams.delete('username')
  window.history.replaceState({}, document.title, `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`)

  if (qrToken) {
    localStorage.setItem(TOKEN_KEY, qrToken)
  }
  return qrToken
}

export type AuthState = 'checking' | 'unauthenticated' | 'authenticated'

interface AuthStore {
  state: AuthState
  user: User | null
  token: string | null
  isFirstUse: boolean
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (username: string, password: string, avatar?: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  checkAuth: () => Promise<void>
  setUser: (user: User) => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, _get) => ({
      state: 'checking',
      user: null,
      token: null,
      isFirstUse: false,

      checkAuth: async () => {
        // 移动端 WebView 需要等待 token 注入
        // 检测是否在移动端 WebView 中（通过 UserAgent 或 FlutterChannel）
        const isMobileWebView = typeof window !== 'undefined' &&
          (window.navigator.userAgent.includes('Flutter') ||
           'FlutterChannel' in window);

        if (isMobileWebView) {
          // 等待 Flutter 注入 token
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        const storedToken = consumeQrLoginToken() || localStorage.getItem(TOKEN_KEY)

        if (storedToken) {
          // Validate token with server
          const response = await authApi.me(storedToken)
          if (response.success && response.data) {
            set({
              user: response.data,
              token: storedToken,
              state: 'authenticated',
            })
            localStorage.setItem('auth_user', JSON.stringify(response.data))
          } else {
            // Token invalid, clear storage
            localStorage.removeItem(TOKEN_KEY)
            localStorage.removeItem('auth_user')
            set({
              token: null,
              user: null,
              state: 'unauthenticated',
            })
          }
        } else {
          // No token, check if first use
          const firstUseResponse = await authApi.checkFirstUse()
          if (firstUseResponse.success && firstUseResponse.data) {
            set({ isFirstUse: firstUseResponse.data.isFirstUse })
          }
          set({ state: 'unauthenticated' })
        }
      },

      login: async (username: string, password: string) => {
        const response = await authApi.login({ username, password })
        if (response.success && response.data) {
          localStorage.setItem(TOKEN_KEY, response.data.token)
          localStorage.setItem('auth_user', JSON.stringify(response.data.user))
          set({
            token: response.data.token,
            user: response.data.user,
            state: 'authenticated',
          })
          return { success: true }
        }
        return { success: false, error: response.error || 'Login failed' }
      },

      register: async (
        username: string,
        password: string,
        avatar?: string,
      ) => {
        const response = await authApi.register({
          username,
          password,
          avatar,
        })
        if (response.success && response.data) {
          localStorage.setItem(TOKEN_KEY, response.data.token)
          localStorage.setItem('auth_user', JSON.stringify(response.data.user))
          set({
            token: response.data.token,
            user: response.data.user,
            state: 'authenticated',
          })
          return { success: true }
        }
        return { success: false, error: response.error || 'Registration failed' }
      },

      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem('auth_user')
        set({
          token: null,
          user: null,
          state: 'unauthenticated',
        })
        // 通知移动端退出登录
        if (typeof window !== 'undefined') {
          // Flutter webview_flutter 的 JavaScriptChannel 直接挂在全局
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(window as any).FlutterChannel?.postMessage(JSON.stringify({ type: 'logout' }))
          } catch {
            // FlutterChannel 可能未定义
          }
        }
      },

      setUser: (user: User) => {
        set({ user })
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        // Only persist user info, not sensitive token in zustand persist
        // Token is handled separately via localStorage for auth header
        user: state.user,
      }),
    }
  )
)
