import * as React from 'react'

type Theme = 'dark' | 'light' | 'system'
type BrandTheme = 'enterprise' | 'graphite' | 'violet' | 'emerald' | 'ruby'

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  defaultBrandTheme?: BrandTheme
  storageKey?: string
  brandStorageKey?: string
}

interface ThemeProviderState {
  theme: Theme
  brandTheme: BrandTheme
  setTheme: (theme: Theme) => void
  setBrandTheme: (brandTheme: BrandTheme) => void
}

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(
  undefined
)

// 发送主题变化消息给 Flutter WebView
function notifyFlutterThemeChange(theme: string, brandTheme: BrandTheme) {
  if (window.FlutterChannel) {
    try {
      window.FlutterChannel.postMessage(JSON.stringify({ type: 'themeChange', theme, brandTheme }))
    } catch (e) {
      // FlutterChannel 可能不存在（非 WebView 环境）
    }
  }
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  defaultBrandTheme = 'enterprise',
  storageKey = 'teamagentx-theme',
  brandStorageKey = 'teamagentx-brand-theme',
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
  const [brandTheme, setBrandTheme] = React.useState<BrandTheme>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(brandStorageKey) as BrandTheme
      if (stored && ['enterprise', 'graphite', 'violet', 'emerald', 'ruby'].includes(stored)) {
        return stored
      }
    }
    return defaultBrandTheme
  })

  React.useLayoutEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')
    root.dataset.brandTheme = brandTheme

    const resolvedTheme = theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : theme

    root.classList.add(resolvedTheme)
    root.dataset.theme = resolvedTheme
    root.style.colorScheme = resolvedTheme
    window.document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', resolvedTheme)
    window.document.querySelector('meta[name="theme-color"]')?.setAttribute(
      'content',
      resolvedTheme === 'dark' ? '#292D3E' : '#FAFAFC',
    )
    notifyFlutterThemeChange(resolvedTheme, brandTheme)
  }, [theme, brandTheme])

  // 监听系统主题变化
  React.useEffect(() => {
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = (e: MediaQueryListEvent) => {
      const root = window.document.documentElement
      root.classList.remove('light', 'dark')
      const newTheme = e.matches ? 'dark' : 'light'
      root.classList.add(newTheme)
      root.dataset.theme = newTheme
      root.style.colorScheme = newTheme
      window.document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', newTheme)
      window.document.querySelector('meta[name="theme-color"]')?.setAttribute(
        'content',
        newTheme === 'dark' ? '#292D3E' : '#FAFAFC',
      )
      notifyFlutterThemeChange(newTheme, brandTheme)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme, brandTheme])

  const value = {
    theme,
    brandTheme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
    setBrandTheme: (brandTheme: BrandTheme) => {
      localStorage.setItem(brandStorageKey, brandTheme)
      setBrandTheme(brandTheme)
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
