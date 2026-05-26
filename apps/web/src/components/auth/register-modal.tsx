import { useState } from 'react'
import { UserAvatarSelector } from '@/components/chat/user-avatar'

interface RegisterModalProps {
  isOpen: boolean
  onRegister: (username: string, password: string, avatar: string) => Promise<{ success: boolean; error?: string }>
}

export function RegisterModal({ isOpen, onRegister }: RegisterModalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState('0')
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

    if (username.length < 2 || username.length > 20) {
      setError('用户名长度需要在 2-20 个字符之间')
      return
    }

    if (password.length < 6) {
      setError('密码长度至少需要 6 个字符')
      return
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    setLoading(true)
    try {
      const result = await onRegister(
        username.trim(),
        password,
        selectedAvatar,
      )

      if (!result.success) {
        setError(result.error || '注册失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-4">
          <div className="flex size-11 items-center justify-center overflow-hidden rounded-2xl border border-border bg-[var(--surface-raised)] shadow-sm">
            <img
              src={`${import.meta.env.BASE_URL}app-logo.png`}
              alt="TeamAgentX"
              className="size-full object-cover"
            />
          </div>
          <h2 className="text-lg font-semibold text-foreground">创建账号</h2>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="max-h-[60vh] overflow-y-auto p-6">
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
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
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
                placeholder="请输入密码（至少 6 位）"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* Confirm Password */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                确认密码 <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入密码"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* Avatar selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">头像</label>
              <UserAvatarSelector
                selectedAvatar={selectedAvatar}
                onSelect={setSelectedAvatar}
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
              className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
