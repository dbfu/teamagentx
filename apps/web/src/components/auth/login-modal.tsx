import { useState } from 'react'
import { Network } from 'lucide-react'

interface LoginModalProps {
  isOpen: boolean
  onLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  onSwitchToRegister: () => void
}

export function LoginModal({ isOpen, onLogin, onSwitchToRegister }: LoginModalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim()) {
      setError('请输入用户名')
      return
    }

    if (!password) {
      setError('请输入密码')
      return
    }

    setLoading(true)
    try {
      const result = await onLogin(username.trim(), password)

      if (!result.success) {
        setError(result.error || '登录失败')
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
          <div className="relative flex size-11 items-center justify-center rounded-2xl border border-blue-200/70 bg-blue-50 text-blue-600 shadow-sm shadow-blue-500/10">
            <div className="absolute inset-1.5 rounded-xl bg-white/80" />
            <Network className="relative z-10 size-5" strokeWidth={2.2} />
            <span className="absolute right-2 top-2 z-10 size-1.5 rounded-full bg-cyan-400 ring-2 ring-white" />
            <span className="absolute bottom-2 left-2 z-10 size-1.5 rounded-full bg-blue-500 ring-2 ring-white" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">登录账号</h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-6">
            {/* Username */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                用户名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* Password */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                密码 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
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
              {loading ? '登录中...' : '登录'}
            </button>
            <div className="mt-3 text-center text-sm text-muted-foreground">
              还没有账号？{' '}
              <button
                type="button"
                onClick={onSwitchToRegister}
                className="text-primary hover:text-primary/80"
              >
                立即注册
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
