import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

interface LoginModalProps {
  isOpen: boolean
  onLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
}

export function LoginModal({ isOpen, onLogin }: LoginModalProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [userConfigPath, setUserConfigPath] = useState('')

  // Electron 环境：获取用户配置文件真实路径
  useEffect(() => {
    if (isOpen && window.electronAPI?.getUserConfigPath) {
      window.electronAPI.getUserConfigPath().then((path) => {
        setUserConfigPath(path)
      })
    }
  }, [isOpen])

  // Electron 环境：自动填充账号密码
  useEffect(() => {
    if (isOpen && window.electronAPI?.getLocalUserCredentials) {
      window.electronAPI.getLocalUserCredentials().then((result) => {
        if (result.success && result.data) {
          setUsername(result.data.username)
          setPassword(result.data.password)
        }
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim()) {
      setError(t('auth.usernameRequired'))
      return
    }

    if (!password) {
      setError(t('auth.passwordRequired'))
      return
    }

    setLoading(true)
    try {
      const result = await onLogin(username.trim(), password)

      if (!result.success) {
        setError(t('auth.loginFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="flex size-11 items-center justify-center overflow-hidden rounded-2xl border border-border bg-[var(--surface-raised)] shadow-sm">
            <img
              src={`${import.meta.env.BASE_URL}app-logo.png`}
              alt="TeamAgentX"
              className="size-full object-cover"
            />
          </div>
          <h2 className="text-lg font-semibold text-foreground">{t('auth.loginTitle')}</h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-6">
            {/* Username */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('auth.username')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('auth.usernamePlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* Password */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('auth.password')} <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
              {/* 仅 Electron 环境显示密码提示 */}
              {userConfigPath && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('auth.passwordHint')} {userConfigPath}
                </p>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="border-t border-border px-6 py-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('auth.loggingIn') : t('auth.login')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
