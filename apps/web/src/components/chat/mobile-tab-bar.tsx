import { cn } from '@/lib/utils'
import { MessageSquare, User } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

interface MobileTabBarProps {
  messageBadge?: number
}

export function MobileTabBar({ messageBadge }: MobileTabBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()

  // 在聊天详情页隐藏 TabBar
  if (location.pathname.startsWith('/chat/')) {
    return null
  }

  // 确定当前激活的 Tab
  const getActiveTab = () => {
    if (location.pathname.startsWith('/assistant')) {
      return 'assistant'
    }
    if (location.pathname.startsWith('/settings')) {
      return 'me'
    }
    // 消息页面包括 / 和 /chat/:roomId
    if (location.pathname === '/' || location.pathname.startsWith('/chat/')) {
      return 'message'
    }
    return 'message'
  }

  const activeTab = getActiveTab()

  const handleTabChange = (tab: 'message' | 'assistant' | 'me') => {
    if (tab === 'message') {
      navigate('/')
    } else if (tab === 'assistant') {
      navigate('/assistant')
    } else {
      navigate('/settings')
    }
  }

  const tabs = [
    {
      id: 'message' as const,
      label: t('nav.messages'),
      icon: MessageSquare,
    },
    {
      id: 'me' as const,
      label: t('nav.me'),
      icon: User,
    },
  ]

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-border bg-background pt-3 pb-1">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        const badge = tab.id === 'message' ? messageBadge : undefined
        const showBadge = badge !== undefined && badge > 0

        return (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <div className="relative">
              <Icon className="size-6" />
              {showBadge && (
                <span className={cn(
                  'absolute -right-2 -top-1.5 flex size-5 items-center justify-center rounded-full text-[11px] font-medium text-white',
                  'bg-red-500'
                )}>
                  {badge! > 99 ? '99+' : badge}
                </span>
              )}
            </div>
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
