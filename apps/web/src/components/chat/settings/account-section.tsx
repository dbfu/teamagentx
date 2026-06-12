import { UserProfileCard } from '@/components/chat/user-profile-card'
import { useAuthStore } from '@/stores'
import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/**
 * 账户管理：个人信息编辑 + 退出登录
 */
export function AccountSection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { logout } = useAuthStore()

  const handleLogout = () => {
    // 如果在 React Native WebView 中，通知原生端退出登录
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'logout' }))
    }
    logout()
    navigate('/')
  }

  return (
    <>
      <UserProfileCard className="mb-6" />

      <button
        onClick={handleLogout}
        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-red-500 hover:bg-red-500/10"
      >
        <span className="flex items-center justify-center gap-2">
          <LogOut className="size-4" />
          {t('auth.logout')}
        </span>
      </button>
    </>
  )
}
