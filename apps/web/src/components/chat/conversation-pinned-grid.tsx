import { ChatRoom } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { formatUnreadCount } from './conversation-list-item'

interface ConversationPinnedGridProps {
  rooms: ChatRoom[]
  selectedId: string | null
  contextMenuRoomId?: string | null
  unreadCounts: Record<string, number>
  executingChatRooms: Set<string>
  pendingOwnerMentionRoomIds: Set<string>
  isMobile?: boolean
  onSelect: (id: string) => void
  onContextMenu: (e: React.MouseEvent, room: ChatRoom) => void
}

/**
 * 置顶群聊区域 - 卡片形式，不参与滚动，移动端一行5个，桌面端一行4个
 */
export function ConversationPinnedGrid({
  rooms,
  selectedId,
  contextMenuRoomId,
  unreadCounts,
  pendingOwnerMentionRoomIds,
  isMobile,
  onSelect,
  onContextMenu,
}: ConversationPinnedGridProps) {
  const { t } = useTranslation()
  const pinnedRooms = rooms
    .filter(room => room.isPinned && !room.isCollapsed)
    .sort((a, b) => {
      // 置顶群聊按置顶时间倒序
      const aPinnedAt = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
      const bPinnedAt = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
      return bPinnedAt - aPinnedAt
    })

  if (pinnedRooms.length === 0) return null

  return (
    <div className={cn("mx-2 grid gap-1 px-1 py-1 pb-2", isMobile ? "grid-cols-5" : "grid-cols-4")}>
      {pinnedRooms.map((room) => {
        const unreadCount = unreadCounts[room.id] || 0
        const unreadDisplay = formatUnreadCount(unreadCount)
        const hasOwnerMention = unreadCount > 0 && pendingOwnerMentionRoomIds.has(room.id)

        return (
          <div
            key={room.id}
            onClick={() => onSelect(room.id)}
            onContextMenu={(e) => onContextMenu(e, room)}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-lg px-2 py-1 transition-colors',
              selectedId === room.id
                ? 'bg-primary/10 ring-1 ring-primary/20'
                : contextMenuRoomId === room.id
                  ? 'bg-accent'
                  : 'bg-muted/50 hover:bg-accent'
            )}
          >
            <div className={cn("relative shrink-0", isMobile ? "" : "scale-90")}>
              {/* 快速对话群聊使用助手头像，普通群聊使用群聊头像 */}
              {room.isQuickChatRoom ? (
                <AgentAvatarImage avatar={room.avatar ?? null} className="size-10 rounded-full" />
              ) : (
                <GroupAvatarImage avatar={room.avatar ?? null} className="size-10 rounded-full" />
              )}
              {/* 未读数红点 */}
              {unreadDisplay && (
                <div className={cn("absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-red-500 font-medium text-white", isMobile ? "min-h-5 min-w-5 px-1.5 text-xs" : "min-h-4 min-w-4 px-1 text-[10px]")}>
                  {unreadDisplay}
                </div>
              )}
            </div>
            <span className={cn(
              "truncate text-xs",
              isMobile ? "max-w-16" : "max-w-14",
              unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"
            )}>{room.name}</span>
            {hasOwnerMention && (
              <span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600">
                {t('chat.ownerMentionTag')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
