import { useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '@/stores'
import { useSocketStore } from '@/stores/socket-store'
import { useAuthStore } from '@/stores/auth-store'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { UserAvatar } from '@/components/chat/user-avatar'

const EMPTY: never[] = []

// 格式化消息时间为 HH:mm
function formatTime(time: string): string {
  const d = new Date(time)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// 3D 办公室左下角群聊历史浮层：复用群聊消息数据，每段对话最多三行
export function OfficeChatHistory({
  chatRoomId,
  selectedMessageId,
  onSelectMessage,
  onClose,
}: {
  chatRoomId: string
  selectedMessageId?: string | null
  onSelectMessage?: (message: import('@/lib/agent-api').Message) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const messages = useChatStore((s) => (chatRoomId ? s.messagesByRoom[chatRoomId] ?? EMPTY : EMPTY))
  const loading = useChatStore((s) => (chatRoomId ? s.loadingByRoom[chatRoomId] ?? false : false))
  const loadMessages = useChatStore((s) => s.loadMessages)
  const addMessage = useChatStore((s) => s.addMessage)
  const isConnected = useSocketStore((s) => s.isConnected)
  const onMessage = useSocketStore((s) => s.onMessage)
  const currentUser = useAuthStore((s) => s.user)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 首次打开时加载历史消息
  useEffect(() => {
    if (chatRoomId && messages.length === 0) loadMessages(chatRoomId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRoomId])

  // 实时追加新消息到群聊历史（socket 消息结构需转换为 Message）
  useEffect(() => {
    if (!chatRoomId || !isConnected) return
    return onMessage((msg) => {
      if (msg.chatRoomId !== chatRoomId) return
      const now = new Date().toISOString()
      addMessage({
        id: msg.id,
        type: msg.type === 'reply' ? 'REPLY' : 'MESSAGE',
        content: msg.content,
        time: typeof msg.time === 'string' ? msg.time : new Date(msg.time).toISOString(),
        userId: msg.userId ?? null,
        agentId: msg.agentId ?? null,
        chatRoomId: msg.chatRoomId,
        replyMessageId: msg.replyMessageId ?? null,
        isHuman: msg.isHuman ?? true,
        avatar: msg.avatar ?? null,
        avatarColor: msg.avatarColor ?? null,
        createdAt: now,
        updatedAt: now,
        user: msg.isHuman
          ? {
              id: msg.userId ?? '',
              socketId: '',
              username: typeof msg.user === 'string' ? msg.user : (msg.user?.username ?? '用户'),
              avatar: (typeof msg.user === 'object' ? msg.user?.avatar : null) ?? msg.avatar ?? null,
            }
          : null,
        agent: msg.agentId && (msg.agentName || msg.agent?.name)
          ? {
              id: msg.agentId,
              name: msg.agent?.name ?? msg.agentName ?? '',
              avatar: msg.agent?.avatar ?? msg.avatar ?? null,
              avatarColor: msg.agent?.avatarColor ?? msg.avatarColor ?? null,
            }
          : null,
      })
    })
  }, [chatRoomId, isConnected, onMessage, addMessage])

  // 有新消息时滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <div className="absolute left-4 bottom-8 z-50 flex h-[80vh] max-h-[calc(100vh-100px)] w-80 flex-col overflow-hidden rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
      <div className="flex shrink-0 items-center justify-between border-b border-amber-100 px-4 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
          <MessageSquare className="h-4 w-4" /> {t('office.chatHistoryTitle')}
        </span>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
          title={t('office.closeTooltip')}
        >
          ✕
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {loading && messages.length === 0 ? (
          <div className="py-6 text-center text-sm text-amber-700/70">{t('office.loadingMessages')}</div>
        ) : messages.length === 0 ? (
          <div className="py-6 text-center text-sm text-amber-700/70">{t('office.noMessages')}</div>
        ) : (
          messages.map((msg) => {
            const isHuman = msg.isHuman
            const name = isHuman ? msg.user?.username || t('chat.user') : msg.agent?.name || t('chat.assistant')
            return (
              <button
                key={msg.id}
                onClick={() => onSelectMessage?.(msg)}
                className={`flex w-full items-start gap-2 rounded-lg p-1.5 transition-colors ${
                  isHuman ? 'flex-row-reverse text-right' : 'text-left'
                } ${selectedMessageId === msg.id ? 'bg-amber-100' : 'hover:bg-amber-100/60'}`}
              >
                {isHuman ? (
                  <UserAvatar
                    avatar={msg.user?.avatar ?? msg.avatar ?? currentUser?.avatar}
                    className="size-6 shrink-0"
                  />
                ) : (
                  <AgentAvatarImage avatar={msg.agent?.avatar} className="size-6 shrink-0" />
                )}
                <div className={`flex min-w-0 flex-1 flex-col ${isHuman ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-baseline gap-1.5 ${isHuman ? 'flex-row-reverse' : ''}`}>
                    <span className="truncate text-xs font-medium text-amber-900">{name}</span>
                    <span className="shrink-0 text-[10px] text-amber-700/60">{formatTime(msg.time || msg.createdAt)}</span>
                  </div>
                  {/* 用户消息蓝色气泡靠右，助手消息白色气泡靠左；每段最多三行 */}
                  <div
                    className={`mt-0.5 line-clamp-3 whitespace-pre-wrap break-words rounded-lg px-2 py-1 text-xs leading-snug ${
                      isHuman
                        ? 'border border-amber-100 bg-white text-green-500'
                        : 'border border-amber-100 bg-white text-amber-800/90'
                    }`}
                  >
                    {msg.content || (msg.attachments?.length ? t('office.imagePlaceholder') : '')}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
