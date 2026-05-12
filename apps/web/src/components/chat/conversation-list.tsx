
import { ChatRoom, chatRoomApi } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { cn, formatDateTime } from '@/lib/utils'
import { Loader2, Pin, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface ConversationListProps {
  chatRooms: ChatRoom[]
  selectedId: string | null
  onSelect: (id: string) => void
  unreadCounts?: Record<string, number>  // chatRoomId -> unread count
  executingChatRooms?: Set<string>  // 有助手正在执行的群聊 ID
  onRefresh?: () => void  // 刷新回调
  isRefreshing?: boolean  // 是否正在刷新
  onDeleteChatRoom?: (chatRoomId: string) => void  // 删除群聊回调
  onCreateChatRoom?: () => void  // 创建群聊回调
  isMobile?: boolean  // 是否移动端
}

export function ConversationList({ chatRooms, selectedId, onSelect, unreadCounts = {}, executingChatRooms = new Set(), onRefresh, isRefreshing, onDeleteChatRoom, onCreateChatRoom, isMobile }: ConversationListProps) {
  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; room: ChatRoom } | null>(null)
  const [pinning, setPinning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 删除确认对话框状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // 格式化未读数显示
  const formatUnreadCount = (count: number) => {
    if (count > 99) return '99+'
    if (count > 0) return count.toString()
    return null
  }

  // 处理右键菜单
  const handleContextMenu = (e: React.MouseEvent, room: ChatRoom) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, room })
  }

  // 关闭右键菜单
  const handleCloseContextMenu = () => {
    setContextMenu(null)
  }

  // 置顶/取消置顶
  const handleTogglePin = async () => {
    if (!contextMenu || pinning) return
    const room = contextMenu.room
    setPinning(true)
    try {
      const response = room.isPinned
        ? await chatRoomApi.unpin(room.id)
        : await chatRoomApi.pin(room.id)
      if (response.success) {
        toast.success(room.isPinned ? '已取消置顶' : '已置顶')
        onRefresh?.()
      } else {
        toast.error(response.error || '操作失败')
      }
    } catch (error) {
      toast.error('操作失败')
    } finally {
      setPinning(false)
      handleCloseContextMenu()
    }
  }

  // 点击删除按钮
  const handleDeleteClick = () => {
    setShowDeleteConfirm(true)
  }

  // 取消删除
  const handleCancelDelete = () => {
    setShowDeleteConfirm(false)
    handleCloseContextMenu()
  }

  // 确认删除群聊
  const handleConfirmDelete = async () => {
    if (!contextMenu || deleting) return
    const room = contextMenu.room
    setDeleting(true)
    try {
      const response = await chatRoomApi.delete(room.id)
      if (response.success) {
        toast.success('群聊已删除')
        // 如果删除的是当前选中的群聊，清除选中状态
        if (selectedId === room.id) {
          onSelect('')  // 传入空字符串清除选中
        }
        onRefresh?.()
        onDeleteChatRoom?.(room.id)
      } else {
        toast.error(response.error || '删除失败')
      }
    } catch (error) {
      toast.error('删除失败')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
      handleCloseContextMenu()
    }
  }

  return (
    <div className={cn("flex h-full select-none flex-col bg-[var(--surface)] overflow-x-hidden", isMobile ? "w-full border-0" : "w-60 shrink-0 border-r border-border")}>
      {/* Header */}
      {!isMobile && (
        <div
          className={cn("flex flex-col border-b border-border/50 bg-[var(--surface-raised)]", isElectron ? "mt-1" : "")}
          style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
            <span className="text-sm font-bold text-foreground">消息</span>
            <div className="flex items-center gap-0.5">
              {onCreateChatRoom && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreateChatRoom()
                  }}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="创建群聊"
                  style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
                >
                  <Plus className="size-3.5" />
                </button>
              )}
              {onRefresh && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRefresh()
                  }}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="刷新"
                  style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
                >
                  <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 置顶群聊区域 */}
      {chatRooms.some(room => room.isPinned) && (
        <div className="flex flex-wrap gap-1 px-2 py-1.5">
          {chatRooms.filter(room => room.isPinned).sort((a, b) => {
            const aPinnedAt = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
            const bPinnedAt = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
            return bPinnedAt - aPinnedAt
          }).map((room) => {
            const unreadCount = unreadCounts[room.id] || 0
            const unreadDisplay = formatUnreadCount(unreadCount)
            const isExecuting = executingChatRooms.has(room.id)

            return (
              <div
                key={room.id}
                onClick={() => onSelect(room.id)}
                onContextMenu={(e) => handleContextMenu(e, room)}
                className={cn(
                  'flex shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded-md px-1.5 py-1 transition-colors',
                  selectedId === room.id
                    ? 'bg-[var(--brand-soft)] ring-1 ring-[var(--nav-active-border)]'
                    : 'bg-[var(--surface-raised)] hover:bg-[var(--surface-subtle)]'
                )}
              >
                <div className="relative shrink-0">
                  {room.isQuickChatRoom ? (
                    <AgentAvatarImage avatar={room.avatar ?? null} className="size-8 rounded-full" />
                  ) : (
                    <GroupAvatarImage avatar={room.avatar ?? null} className="size-8 rounded-full" />
                  )}
                  {unreadDisplay && (
                    <div className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {unreadDisplay}
                    </div>
                  )}
                  {isExecuting && (
                    <div className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-primary">
                      <Loader2 className="size-2 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <span className="max-w-12 truncate text-[10px] text-muted-foreground">{room.name}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {chatRooms.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            暂无群聊，点击左上角 + 创建
          </div>
        ) : (
          (() => {
            return (
              <>
                {[...chatRooms].sort((a, b) => {
                  const aTime = a.lastMessage?.time ? new Date(a.lastMessage.time).getTime() : new Date(a.createdAt).getTime()
                  const bTime = b.lastMessage?.time ? new Date(b.lastMessage.time).getTime() : new Date(b.createdAt).getTime()
                  return bTime - aTime
                }).map((room) => {
                  const unreadCount = unreadCounts[room.id] || 0
                  const unreadDisplay = formatUnreadCount(unreadCount)
                  const isExecuting = executingChatRooms.has(room.id)
                  const isSelected = selectedId === room.id

                  return (
                    <div
                      key={room.id}
                      onClick={() => onSelect(room.id)}
                      onContextMenu={(e) => handleContextMenu(e, room)}
                      className={cn(
                        'flex cursor-pointer items-start gap-2 border-b border-border/30 px-3 py-2 transition-all duration-100',
                        isMobile ? 'px-4 py-3' : '',
                        isSelected
                          ? 'bg-[var(--brand-soft)] border-l-2 border-l-primary'
                          : 'border-l-2 border-l-transparent hover:bg-[var(--surface-raised)]'
                      )}
                    >
                      <div className="relative shrink-0">
                        {room.isQuickChatRoom ? (
                          <AgentAvatarImage avatar={room.avatar ?? null} className={cn("rounded-full", isMobile ? "size-11" : "size-9")} />
                        ) : (
                          <GroupAvatarImage avatar={room.avatar ?? null} className={cn("rounded-full", isMobile ? "size-11" : "size-9")} />
                        )}
                        {unreadDisplay && (
                          <div className={cn("absolute -right-1 -top-1 flex items-center justify-center rounded-full bg-red-500 font-bold text-white", isMobile ? "min-h-5 min-w-5 px-1 text-xs" : "min-h-4 min-w-4 px-0.5 text-[10px]")}>
                            {unreadDisplay}
                          </div>
                        )}
                        {isExecuting && (
                          <div className={cn("absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-primary", isMobile ? "size-4" : "size-3")}>
                            <Loader2 className={cn("animate-spin text-white", isMobile ? "size-3" : "size-2")} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-1">
                          <span className={cn(
                            "min-w-0 truncate",
                            isMobile ? "text-sm font-semibold" : "text-[13px] font-semibold",
                            unreadCount > 0 ? "text-foreground" : "text-muted-foreground"
                          )}>{room.name}</span>
                          {room.lastMessage && (
                            <span className={cn("shrink-0 text-[11px] tabular-nums text-muted-foreground/60")}>
                              {formatDateTime(room.lastMessage.time)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <p className={cn(
                            "min-w-0 flex-1 truncate",
                            isMobile ? "text-sm" : "text-xs",
                            unreadCount > 0 ? "text-muted-foreground" : "text-muted-foreground/60"
                          )}>
                            {room.lastMessage ? (
                              <>
                                {room.lastMessage.isHuman ? (
                                  room.lastMessage.user?.username || '用户'
                                ) : (
                                  room.lastMessage.agent?.name || '助手'
                                )}：{room.lastMessage.content}
                              </>
                            ) : (
                              '暂无消息'
                            )}
                          </p>
                          {/* Show thinking dots for executing rooms without unread */}
                          {isExecuting && !unreadDisplay && (
                            <div className="thinking-dots flex shrink-0 gap-0.5 text-primary">
                              <span /><span /><span />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </>
            )
          })()
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={handleCloseContextMenu} />
          <div
            className="fixed z-50 min-w-[140px] overflow-hidden rounded-md border border-border bg-[var(--surface-raised)] py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleTogglePin}
              disabled={pinning}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Pin className="size-3.5" />
              {contextMenu.room.isPinned ? '取消置顶' : '置顶'}
            </button>
            <button
              onClick={handleDeleteClick}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="size-3.5" />
              删除群聊
            </button>
          </div>
        </>
      )}

      {/* 删除确认对话框 */}
      {showDeleteConfirm && contextMenu && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" onClick={handleCancelDelete} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-[var(--surface-raised)] p-5 shadow-xl w-72">
            <h3 className="text-sm font-semibold text-foreground mb-1.5">确认删除</h3>
            <p className="text-xs text-muted-foreground mb-4">
              确定要删除群聊「{contextMenu.room.name}」吗？此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="rounded px-3 py-1.5 text-xs border border-border text-muted-foreground hover:bg-accent transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="rounded px-3 py-1.5 text-xs bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
