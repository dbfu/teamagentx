
import { ChatRoom, chatRoomApi, templatePackageApi } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { cn, formatDateTime } from '@/lib/utils'
import { useSocketStore } from '@/stores/socket-store'
import { Copy, Download, Loader2, MessageSquare, Pin, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { GroupTemplateImportModal } from './group-template-import-modal'

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
  const todos = useSocketStore((s) => s.todos)
  const pendingOwnerMentionRoomIds = useMemo(() => new Set(
    todos
      .filter((todo) => todo.status === 'pending')
      .map((todo) => todo.chatRoomId),
  ), [todos])

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; room: ChatRoom } | null>(null)
  const [pinning, setPinning] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 删除确认对话框状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [exportingTemplate, setExportingTemplate] = useState(false)

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

  // 复制群聊
  const handleDuplicate = async () => {
    if (!contextMenu || duplicating) return
    const room = contextMenu.room
    setDuplicating(true)
    try {
      const response = await chatRoomApi.duplicate(room.id)
      if (response.success && response.data) {
        toast.success('群聊已复制')
        onRefresh?.()
        onSelect(response.data.id)
      } else {
        toast.error(response.error || '复制失败')
      }
    } catch (error) {
      toast.error('复制失败')
    } finally {
      setDuplicating(false)
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

  const handleExportTemplate = async (room: ChatRoom) => {
    if (exportingTemplate) return

    setExportingTemplate(true)
    try {
      const response = await templatePackageApi.export({
        chatRoomId: room.id,
        packageTitle: room.name,
        packageSummary: room.description || undefined,
      })

      if (!response.success || !response.data) {
        toast.error(response.error || '导出群组模板失败')
        return
      }

      const url = URL.createObjectURL(response.data.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = response.data.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 100)
      toast.success(`已导出群组模板：${room.name}`)
    } catch {
      toast.error('导出群组模板失败')
    } finally {
      setExportingTemplate(false)
      handleCloseContextMenu()
    }
  }

  return (
    <>
    <div className={cn("flex h-full select-none flex-col bg-background overflow-x-hidden", isMobile ? "w-full border-0" : "w-72 shrink-0 border-r border-border")}>
      {/* Header - 支持拖动 */}
      {!isMobile && (
        <div
          className={cn("flex items-center justify-between px-4 py-3", isElectron ? "mt-1" : "")}
          style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <div className="flex items-center gap-3">
            <MessageSquare className="size-5 text-muted-foreground" />
            <span className="text-xl font-semibold text-foreground">消息</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowImportModal(true)
              }}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="导入群组模板"
              style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
            >
              <Upload className="size-4" />
            </button>
              {onCreateChatRoom && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreateChatRoom()
                  }}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="创建群聊"
                  style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
                >
                  <Plus className="size-4" />
                </button>
              )}
              {onRefresh && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRefresh()
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  )}
                  title="刷新"
                  style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
                >
                  <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
                </button>
              )}
            </div>
        </div>
      )}

      {/* 置顶群聊区域 - 卡片形式，不参与滚动，移动端一行5个，桌面端一行3个 */}
      {chatRooms.some(room => room.isPinned) && (
        <div className={cn("mx-2 grid gap-1.5 px-1 py-1 pb-2", isMobile ? "grid-cols-5" : "grid-cols-3")}>
          {chatRooms.filter(room => room.isPinned).sort((a, b) => {
            // 置顶群聊按置顶时间倒序
            const aPinnedAt = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0
            const bPinnedAt = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0
            return bPinnedAt - aPinnedAt
          }).map((room) => {
            const unreadCount = unreadCounts[room.id] || 0
            const unreadDisplay = formatUnreadCount(unreadCount)
            const isExecuting = executingChatRooms.has(room.id)
            const hasOwnerMention = unreadCount > 0 && pendingOwnerMentionRoomIds.has(room.id)

            return (
              <div
                key={room.id}
                onClick={() => onSelect(room.id)}
                onContextMenu={(e) => handleContextMenu(e, room)}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-1 rounded-lg px-2 py-1 transition-colors',
                  selectedId === room.id
                    ? 'bg-primary/10 ring-1 ring-primary/20'
                    : 'bg-muted/50 hover:bg-accent'
                )}
              >
                <div className="relative shrink-0">
                  {/* 快速对话群聊使用助手头像，普通群聊使用群聊头像 */}
                  {room.isQuickChatRoom ? (
                    <AgentAvatarImage avatar={room.avatar ?? null} className="size-10 rounded-full" />
                  ) : (
                    <GroupAvatarImage avatar={room.avatar ?? null} className="size-10 rounded-full" />
                  )}
                  {/* 未读数红点 */}
                  {unreadDisplay && (
                    <div className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-medium text-white">
                      {unreadDisplay}
                    </div>
                  )}
                  {/* 助手执行中标识 */}
                  {isExecuting && (
                    <div className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary">
                      <Loader2 className="size-3 animate-spin text-white" />
                    </div>
                  )}
                </div>
                <span className={cn(
                  "max-w-16 truncate text-xs",
                  unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"
                )}>{room.name}</span>
                {hasOwnerMention && (
                  <span className="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-600">
                    @群主
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Conversation list - 不支持拖动 */}
      <div className="scrollbar-hover flex-1 overflow-y-auto pb-3">
        {chatRooms.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            暂无群聊，点击左上角 + 创建
          </div>
        ) : (
          (() => {
            // 显示所有群聊
            return (
              <>
                {[...chatRooms].sort((a, b) => {
                  const aTime = a.lastMessage?.time ? new Date(a.lastMessage.time).getTime() : new Date(a.updatedAt).getTime()
                  const bTime = b.lastMessage?.time ? new Date(b.lastMessage.time).getTime() : new Date(b.updatedAt).getTime()
                  return bTime - aTime
                }).map((room) => {
                  const unreadCount = unreadCounts[room.id] || 0
                  const unreadDisplay = formatUnreadCount(unreadCount)
                  const isExecuting = executingChatRooms.has(room.id)
                  const hasOwnerMention = unreadCount > 0 && pendingOwnerMentionRoomIds.has(room.id)

                  return (
                    <div
                      key={room.id}
                      onClick={() => onSelect(room.id)}
                      onContextMenu={(e) => handleContextMenu(e, room)}
                      className={cn(
                        'mx-2 flex cursor-pointer items-start gap-3 rounded-lg transition-colors',
                        isMobile ? 'px-4 py-4' : 'px-3 py-3',
                        selectedId === room.id
                          ? 'bg-primary/10'
                          : 'hover:bg-accent'
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
                              @群主
                            </span>
                          )}
                          {room.lastMessage ? (
                            <span className="min-w-0 truncate">
                              {room.lastMessage.isHuman ? (
                                room.lastMessage.user?.username || '用户'
                              ) : (
                                room.lastMessage.agent?.name || '助手'
                              )}：{room.lastMessage.content}
                            </span>
                          ) : (
                            <span className="min-w-0 truncate">暂无消息</span>
                          )}
                        </p>
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
            className="fixed z-50 min-w-[120px] rounded-lg bg-popover py-1 shadow-lg border border-border"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleTogglePin}
              disabled={pinning}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              <Pin className="size-4" />
              {contextMenu.room.isPinned ? '取消置顶' : '置顶'}
            </button>
            <button
              onClick={handleDuplicate}
              disabled={duplicating}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              {duplicating ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
              复制群聊
            </button>
            <button
              onClick={() => handleExportTemplate(contextMenu.room)}
              disabled={exportingTemplate}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              {exportingTemplate ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              导出群组模板
            </button>
            <button
              onClick={handleDeleteClick}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="size-4" />
              删除群聊
            </button>
          </div>
        </>
      )}

      {/* 删除确认对话框 */}
      {showDeleteConfirm && contextMenu && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={handleCancelDelete} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6 shadow-lg border border-border w-80">
            <h3 className="text-lg font-semibold text-foreground mb-2">确认删除</h3>
            <p className="text-sm text-muted-foreground mb-4">
              确定要删除群聊「{contextMenu.room.name}」吗？此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
    <GroupTemplateImportModal
      isOpen={showImportModal}
      onClose={() => setShowImportModal(false)}
      onImported={async (chatRoomId) => {
        setShowImportModal(false)
        onRefresh?.()
        onSelect(chatRoomId)
      }}
    />
    </>
  )
}
