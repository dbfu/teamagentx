import { useState, useEffect } from 'react'
import { MessageSquare, Loader2, Clock, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { agentApi, QuickChatSession } from '@/lib/agent-api'
import { useAuthStore, useChatRoomStore } from '@/stores'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTime } from '@/lib/utils'

interface AssistantHistoryTabProps {
  agentId: string
}

export function AssistantHistoryTab({ agentId }: AssistantHistoryTabProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const loadChatRooms = useChatRoomStore((s) => s.loadChatRooms)
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const [sessions, setSessions] = useState<QuickChatSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadSessions = async () => {
      if (!user?.id) {
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const res = await agentApi.getQuickChatRooms(agentId, user.id)
      if (res.success && res.data) {
        setSessions(res.data)
      } else {
        setError(t('common.loadingFailed'))
      }
      setLoading(false)
    }

    loadSessions()
  }, [agentId, user?.id, t])

  const handleOpenChatRoom = async (session: QuickChatSession) => {
    // 先刷新群聊列表，确保群聊已加载
    await loadChatRooms()
    // 选中该群聊
    selectRoom(session.chatRoom.id)
    // 导航到消息页
    navigate('/')
  }

  if (!user?.id) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <MessageSquare className="size-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">{t('auth.pleaseLoginFirst')}</h3>
        <p className="text-sm text-muted-foreground">{t('assistant.loginToViewSessions')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Loader2 className="size-8 animate-spin text-primary mb-4" />
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="size-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
          <MessageSquare className="size-8 text-red-400" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">{t('common.loadingFailed')}</h3>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">{t('assistant.quickChatSessions')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('assistant.quickChatSessionsDesc')}
        </p>
      </div>

      {/* Sessions List */}
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-muted/50 rounded-2xl border border-border">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <MessageSquare className="size-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">{t('assistant.noSessions')}</h3>
          <p className="text-sm text-muted-foreground">{t('assistant.noSessionsHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session, index) => (
            <div
              key={session.id}
              className="group bg-card rounded-xl border border-border p-5 hover:border-primary/20 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex items-center justify-between">
                {/* 左侧信息 */}
                <div className="flex items-center gap-4">
                  <div className="size-12 rounded-xl bg-primary/5 flex items-center justify-center">
                    <MessageSquare className="size-6 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-foreground">
                        {session.chatRoom.name || `${t('assistant.session')} #${index + 1}`}
                      </h4>
                      <Badge
                        variant={session.status === 'active' ? 'default' : 'secondary'}
                        className={cn(
                          'text-xs',
                          session.status === 'active'
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {session.status === 'active' ? t('assistant.sessionActive') : t('assistant.sessionArchived')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="size-3" />
                      {formatDateTime(session.createdAt)}
                    </div>
                  </div>
                </div>

                {/* 操作按钮 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenChatRoom(session)}
                  className="gap-2 opacity-60 group-hover:opacity-100 transition-opacity"
                >
                  <ExternalLink className="size-4" />
                  {t('common.open')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}