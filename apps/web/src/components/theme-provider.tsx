import * as React from 'react'

type Theme = 'dark' | 'light' | 'system'

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

interface ThemeProviderState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(
  undefined
)

// 发送主题变化消息给 Flutter WebView
function notifyFlutterThemeChange(theme: string) {
  if (window.FlutterChannel) {
    try {
      window.FlutterChannel.postMessage(JSON.stringify({ type: 'themeChange', theme }))
    } catch (e) {
      // FlutterChannel 可能不存在（非 WebView 环境）
    }
  }
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'teamagentx-theme',
}: ThemeProviderProps) {
  const [theme, setTheme] = React.useState<Theme>(() => {
    // 从 localStorage 读取存储的主题
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey) as Theme
      if (stored && ['dark', 'light', 'system'].includes(stored)) {
        return stored
      }
    }
    return defaultTheme
  })

  React.useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
        .matches
        ? 'dark'
        : 'light'

      root.classList.add(systemTheme)
      notifyFlutterThemeChange(systemTheme)
      return
    }

    root.classList.add(theme)
    notifyFlutterThemeChange(theme)
  }, [theme])

  // 监听系统主题变化
  React.useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = (e: MediaQueryListEvent) => {
      const root = window.document.documentElement
      root.classList.remove('light', 'dark')
      const newTheme = e.matches ? 'dark' : 'light'
      root.classList.add(newTheme)
      notifyFlutterThemeChange(newTheme)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export function useTheme() {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }

  return context
}