import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { messageApi, type ExecutionRecord, type Message } from '@/lib/agent-api'
import { formatDateTime } from '@/lib/utils'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { UserAvatar } from '@/components/chat/user-avatar'
import { MarkdownContent } from '@/components/chat/markdown-content'
import { RecordDetailPanel } from '@/components/chat/chat-side-panel/record-detail-panel'

// 3D 办公室右侧消息详情面板：展示完整内容，助手消息额外展示执行记录
export function OfficeMessageDetail({
  message,
  fallbackUserAvatar,
  onClose,
}: {
  message: Message
  fallbackUserAvatar?: string | number | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const name = message.isHuman ? message.user?.username || t('chat.user') : message.agent?.name || t('chat.assistant')
  const [record, setRecord] = useState<ExecutionRecord | null>(null)
  const [loading, setLoading] = useState(false)

  // 助手消息：按消息 id 拉取执行记录
  useEffect(() => {
    setRecord(null)
    if (message.isHuman) return
    let cancelled = false
    setLoading(true)
    messageApi.getExecutionRecord(message.id)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) setRecord(res.data)
      })
      .catch((err) => console.error('Failed to load message execution record:', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [message.id, message.isHuman])

  return (
    <div className="absolute right-4 top-16 bottom-24 z-50 flex w-96 flex-col overflow-hidden rounded-xl border border-amber-200 bg-amber-50/95 shadow-lg backdrop-blur">
      <div className="flex shrink-0 items-center justify-between border-b border-amber-100 px-4 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
          <MessageSquare className="h-4 w-4" /> {t('office.messageDetailTitle')}
        </span>
        <button
          onClick={onClose}
          className="rounded-md px-2 py-1 text-amber-700 hover:bg-amber-100"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* 发送者与时间 */}
        <div className="mb-3 flex items-center gap-2">
          {message.isHuman ? (
            <UserAvatar avatar={message.user?.avatar ?? message.avatar ?? fallbackUserAvatar} className="size-8 shrink-0" />
          ) : (
            <AgentAvatarImage avatar={message.agent?.avatar ?? message.avatar} className="size-8 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-amber-900">{name}</div>
            <div className="text-xs text-amber-700/60">{formatDateTime(message.time || message.createdAt)}</div>
          </div>
        </div>

        {/* 完整消息内容 */}
        <div className="rounded-lg border border-amber-100 bg-white/70 p-3 text-sm text-gray-700">
          {message.content
            ? <MarkdownContent content={message.content} />
            : <span className="text-gray-400">{message.attachments?.length ? t('office.imagePlaceholder') : t('office.emptyMessage')}</span>}
        </div>

        {/* 执行记录详情（助手消息） */}
        {!message.isHuman && (
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-amber-700/70">{t('office.executionDetail')}</div>
            {loading ? (
              <div className="py-4 text-center text-sm text-amber-700/70">{t('office.loadingMessages')}</div>
            ) : record ? (
              <RecordDetailPanel selectedRecord={record} />
            ) : (
              <div className="py-3 text-center text-sm text-amber-700/60">{t('office.noRecord')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
