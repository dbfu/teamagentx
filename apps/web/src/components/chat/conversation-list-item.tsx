import { ChatRoom } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { cn, formatDateTime } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ConversationListItemProps {
  room: ChatRoom
  selected: boolean
  unreadCount: number
  isExecuting: boolean
  hasOwnerMention: boolean
  isMobile?: boolean
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, room: ChatRoom) => void
  itemRef?: (el: HTMLDivElement | null) => void
}

// 格式化未读数显示
function formatUnreadCount(count: number): string | null {
  if (count > 99) return '99+'
  if (count > 0) return count.toString()
  return null
}

/**
 * 群聊列表行（用于主列表和折叠分组共用）
 */
export function ConversationListItem({
  room,
  selected,
  unreadCount,
  isExecuting,
  hasOwnerMention,
  isMobile,
  onSelect,
  onContextMenu,
  itemRef,
}: ConversationListItemProps) {
  const { t } = useTranslation()
  const unreadDisplay = formatUnreadCount(unreadCount)

  return (
    <div
      ref={itemRef}
      onClick={() => onSelect(room.id)}
      onContextMenu={(e) => onContextMenu(e, room)}
      className={cn(
        'mx-2 flex cursor-pointer items-start gap-3 rounded-lg transition-colors',
        isMobile ? 'px-4 py-4' : 'px-3 py-3',
        selected ? 'bg-primary/10' : 'hover:bg-accent'
      )}
    >
      <div className="relative">
        {/* 快速对话群聊使用助手头像，普通群聊使用群聊头像 */}
        {room.isQuickChatRoom ? (
          <AgentAvatarImage avatar={room.avatar ?? null} className={cn("rounded-full", isMobile ? "size-12" : "size-10")} />
        ) : (
          <GroupAvatarImage avatar={room.avatar ?? null} className={cn("rounded-full", isMobile ? "size-12" : "size-10")} />
        )}
        {/* 未读数红点 */}
        {unreadDisplay && (
          <div className={cn("absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-red-500 font-medium text-white", isMobile ? "min-h-6 min-w-6 px-2 text-sm" : "min-h-5 min-w-5 px-1.5 text-xs")}>
            {unreadDisplay}
          </div>
        )}
        {/* 助手执行中标识 */}
        {isExecuting && (
          <div className={cn("absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-primary", isMobile ? "size-5" : "size-4")}>
            <Loader2 className={cn("animate-spin text-white", isMobile ? "size-4" : "size-3")} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-1.5">
          <span className={cn(
            "min-w-0 truncate font-medium",
            isMobile ? "text-base leading-6" : "text-sm leading-5",
            unreadCount > 0 ? "text-foreground" : "text-muted-foreground"
          )}>{room.name}</span>
          {room.lastMessage && (
            <span className={cn("shrink-0 text-muted-foreground/70 tabular-nums", isMobile ? "text-sm leading-6" : "text-xs leading-5")}>
              {formatDateTime(room.lastMessage.time)}
            </span>
          )}
        </div>
        <p className={cn(
          "mt-1 flex min-w-0 items-center gap-1 truncate",
          isMobile ? "text-sm" : "text-xs",
          unreadCount > 0 ? "text-muted-foreground" : "text-muted-foreground/70"
        )}>
          {hasOwnerMention && (
            <span className="shrink-0 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-medium text-orange-600">
              {t('chat.ownerMentionTag')}
            </span>
          )}
          {room.lastMessage ? (
            <span className="min-w-0 truncate">
              {room.lastMessage.isHuman ? (
                room.lastMessage.user?.username || t('chat.user')
              ) : (
                room.lastMessage.agent?.name || t('chat.assistant')
              )}：{room.lastMessage.content}
            </span>
          ) : (
            <span className="min-w-0 truncate">{t('chat.noMessages')}</span>
          )}
        </p>
      </div>
    </div>
  )
}

export { formatUnreadCount }
