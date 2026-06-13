import { UserProfileCard } from '@/components/chat/user-profile-card'
import { useAuthStore } from '@/stores'
import { LogOut, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface UserProfileModalProps {
  open: boolean
  onClose: () => void
}

/**
 * 用户信息弹框
 * 从侧边栏头像入口打开，仅保留个人资料编辑与退出登录
 */
export function UserProfileModal({ open, onClose }: UserProfileModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { logout } = useAuthStore()

  if (!open) return null

  const handleLogout = () => {
    // 如果在 React Native WebView 中，通知原生端退出登录
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'logout' }))
    }
    logout()
    onClose()
    navigate('/')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-[580px] max-w-full overflow-hidden rounded-2xl bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold text-foreground">{t('settings.userInfo')}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          <UserProfileCard className="border-0 bg-transparent p-0" showTitle={false} onSaved={onClose} />

          <button
            onClick={handleLogout}
            className="mt-4 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-red-500 hover:bg-red-500/10"
          >
            <span className="flex items-center justify-center gap-2">
              <LogOut className="size-4" />
              {t('auth.logout')}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
