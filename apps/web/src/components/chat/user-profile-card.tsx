import { UserAvatar, UserAvatarSelector } from '@/components/chat/user-avatar'
import { authApi } from '@/lib/auth-api'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

interface UserProfileCardProps {
  className?: string
  /** 是否显示卡片标题（弹框中由外层 header 提供标题时可关闭） */
  showTitle?: boolean
  /** 保存成功后的回调（如关闭弹框） */
  onSaved?: () => void
}

/**
 * 用户信息卡片：编辑用户名与头像
 * 同时用于设置页和头像弹框，避免逻辑重复
 */
export function UserProfileCard({ className, showTitle = true, onSaved }: UserProfileCardProps) {
  const { t } = useTranslation()
  const { user, token, setUser } = useAuthStore()
  const [username, setUsername] = useState(user?.username || '')
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar || '0')
  const [isUpdating, setIsUpdating] = useState(false)

  const handleUpdateProfile = async () => {
    if (!token || !user) return
    if (!username.trim()) {
      toast.error(t('settings.usernameRequired'))
      return
    }

    setIsUpdating(true)
    try {
      const response = await authApi.updateProfile(token, {
        username: username.trim(),
        avatar: selectedAvatar,
      })

      if (response.success && response.data) {
        setUser(response.data)
        toast.success(t('settings.profileUpdated'))
        onSaved?.()
      } else {
        toast.error(t('settings.profileUpdateFailed'))
      }
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)}>
      {showTitle && (
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('settings.userInfo')}</h2>
      )}

      {/* 用户名 */}
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium">{t('settings.username')}</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('settings.usernamePlaceholder')}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      {/* 头像选择 */}
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium">{t('settings.avatar')}</label>
        <UserAvatarSelector
          selectedAvatar={selectedAvatar}
          onSelect={setSelectedAvatar}
        />
      </div>

      {/* 预览 */}
      <div className="mb-4">
        <label className="mb-1.5 block text-sm font-medium">{t('settings.preview')}</label>
        <div className="flex items-center gap-3">
          <UserAvatar avatar={selectedAvatar} size="lg" />
          <span className="text-sm font-medium">{username || t('settings.previewUsername')}</span>
        </div>
      </div>

      {/* 更新按钮 */}
      <button
        onClick={handleUpdateProfile}
        disabled={isUpdating || (username === user?.username && selectedAvatar === (user?.avatar || '0'))}
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isUpdating ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            {t('settings.updating')}
          </span>
        ) : t('settings.saveChanges')}
      </button>
    </div>
  )
}
