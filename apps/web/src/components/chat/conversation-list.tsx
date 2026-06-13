
import { ChatRoom, chatRoomApi, templatePackageApi } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { useSocketStore } from '@/stores/socket-store'
import { Archive, ChevronDown, ChevronRight, Copy, Download, Loader2, MessageSquare, Pin, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { GroupTemplateImportModal } from './group-template-import-modal'
import { ConversationListItem, formatUnreadCount } from './conversation-list-item'
import { ConversationPinnedGrid } from './conversation-pinned-grid'
import { FloatingMenu } from '@/components/ui/floating-menu'

interface ConversationListProps {
  chatRooms: ChatRoom[]
  selectedId: string | null
  onSelect: (id: string) => void
  unreadCounts?: Record<string, number>  // chatRoomId -> unread count
  executingChatRooms?: Set<string>  // 有助手正在执行的群聊 ID
  onRefresh?: () => void  // 刷新回调
  isRefreshing?: boolean  // 是否正在刷新
  isLoading?: boolean  // 是否正在加载群聊列表
  onDeleteChatRoom?: (chatRoomId: string) => void  // 删除群聊回调
  onCreateChatRoom?: () => void  // 创建群聊回调
  isMobile?: boolean  // 是否移动端
}

export function ConversationList({ chatRooms, selectedId, onSelect, unreadCounts = {}, executingChatRooms = new Set(), onRefresh, isRefreshing, isLoading = false, onDeleteChatRoom, onCreateChatRoom, isMobile }: ConversationListProps) {
  const { t } = useTranslation()
  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false
  const todos = useSocketStore((s) => s.todos)
  const pendingOwnerMentionRoomIds = useMemo(() => new Set(
    todos
      .filter((todo) => todo.status === 'pending')
      .map((todo) => todo.chatRoomId),
  ), [todos])

  // 滚动容器 ref
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // 群聊项 ref 映射
  const roomItemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; room: ChatRoom } | null>(null)
  const [pinning, setPinning] = useState(false)
  const [collapsing, setCollapsing] = useState(false)
  // 折叠群聊分组是否展开
  const [collapsedExpanded, setCollapsedExpanded] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 删除确认对话框状态
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // 待删除的群聊（点击删除时从右键菜单捕获，避免对话框依赖右键菜单状态）
  const [roomToDelete, setRoomToDelete] = useState<ChatRoom | null>(null)
  // 群模板导入弹框状态
  const [showImportModal, setShowImportModal] = useState(false)
  const [exportingTemplate, setExportingTemplate] = useState(false)

  // 当选中群聊变化时，自动滚动到该群聊位置
  useEffect(() => {
    if (!selectedId || !scrollContainerRef.current) return

    // 尝试滚动到选中的群聊，使用 requestAnimationFrame 确保 DOM 已渲染
    const scrollToSelected = () => {
      const roomElement = roomItemRefs.current.get(selectedId)
      if (roomElement) {
        roomElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }

    // 立即尝试一次
    scrollToSelected()

    // 如果第一次没找到元素，延迟再试（等待列表刷新和渲染）
    const timer = requestAnimationFrame(() => {
      scrollToSelected()
      // 再延迟一次确保
      requestAnimationFrame(scrollToSelected)
    })

    return () => cancelAnimationFrame(timer)
  }, [selectedId, chatRooms])

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
        toast.success(room.isPinned ? t('chat.unpinned') : t('chat.pinned'))
        onRefresh?.()
      } else {
        toast.error(t('common.operationFailed'))
      }
    } catch (error) {
      toast.error(t('common.operationFailed'))
    } finally {
      setPinning(false)
      handleCloseContextMenu()
    }
  }

  // 折叠/取消折叠
  const handleToggleCollapse = async () => {
    if (!contextMenu || collapsing) return
    const room = contextMenu.room
    setCollapsing(true)
    try {
      const response = room.isCollapsed
        ? await chatRoomApi.uncollapse(room.id)
        : await chatRoomApi.collapse(room.id)
      if (response.success) {
        toast.success(room.isCollapsed ? t('chat.uncollapsed') : t('chat.collapsed'))
        onRefresh?.()
      } else {
        toast.error(t('common.operationFailed'))
      }
    } catch (error) {
      toast.error(t('common.operationFailed'))
    } finally {
      setCollapsing(false)
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
        toast.success(t('chat.groupDuplicated'))
        // 等待刷新完成后再选中新群聊，确保列表已更新
        await onRefresh?.()
        onSelect(response.data.id)
      } else {
        toast.error(t('chat.duplicateFailed'))
      }
    } catch (error) {
      toast.error(t('chat.duplicateFailed'))
    } finally {
      setDuplicating(false)
      handleCloseContextMenu()
    }
  }

  // 点击删除按钮
  const handleDeleteClick = () => {
    if (!contextMenu) return
    // 捕获要删除的群聊，并隐藏右键菜单
    setRoomToDelete(contextMenu.room)
    setShowDeleteConfirm(true)
    handleCloseContextMenu()
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
        toast.error(t('toast.templateExportFailed'))
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
      toast.success(t('toast.templateExportSuccess') + `：${room.name}`)
    } catch {
      toast.error(t('toast.templateExportFailed'))
    } finally {
      setExportingTemplate(false)
      handleCloseContextMenu()
    }
  }

  // 取消删除
  const handleCancelDelete = () => {
    setShowDeleteConfirm(false)
    setRoomToDelete(null)
    handleCloseContextMenu()
  }

  // 确认删除群聊
  const handleConfirmDelete = async () => {
    if (!roomToDelete || deleting) return
    const room = roomToDelete
    setDeleting(true)
    try {
      let response: Awaited<ReturnType<typeof chatRoomApi.delete>>
      try {
        response = await chatRoomApi.delete(room.id)
      } catch (error) {
        toast.error(t('common.deleteFailed'))
        return
      }

      if (!response.success) {
        toast.error(t('common.deleteFailed'))
        return
      }

      toast.success(t('toast.roomDeleted'))
      // 如果删除的是当前选中的群聊，清除选中状态
      if (selectedId === room.id) {
        try {
          onSelect('')  // 传入空字符串清除选中
        } catch (error) {
          console.error('Failed to clear selected chat room after delete:', error)
        }
      }

      void Promise.resolve(onRefresh?.()).catch((error) => {
        console.error('Failed to refresh chat rooms after delete:', error)
      })

      try {
        onDeleteChatRoom?.(room.id)
      } catch (error) {
        console.error('Failed to update chat room state after delete:', error)
      }
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
      setRoomToDelete(null)
      handleCloseContextMenu()
    }
  }

  // 按最后消息时间倒序
  const sortByLastMessage = (a: ChatRoom, b: ChatRoom) => {
    const aTime = a.lastMessage?.time ? new Date(a.lastMessage.time).getTime() : new Date(a.updatedAt).getTime()
    const bTime = b.lastMessage?.time ? new Date(b.lastMessage.time).getTime() : new Date(b.updatedAt).getTime()
    return bTime - aTime
  }
  // 主列表只显示未折叠的群聊；折叠的群聊收纳到底部固定入口
  const collapsedRooms = chatRooms.filter(room => room.isCollapsed).sort(sortByLastMessage)
  const visibleRooms = chatRooms.filter(room => !room.isCollapsed).sort(sortByLastMessage)
  // 折叠群聊未读数汇总
  const collapsedUnread = collapsedRooms.reduce((sum, room) => sum + (unreadCounts[room.id] || 0), 0)
  const collapsedUnreadDisplay = formatUnreadCount(collapsedUnread)

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
            <span className="text-xl font-semibold text-foreground">{t('nav.messages')}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowImportModal(true)
              }}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t('chat.importTemplate')}
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
                title={t('chat.createGroup')}
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
                title={t('common.refresh')}
                style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
              >
                <RefreshCw className={cn("size-4", isRefreshing && "animate-spin")} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 置顶群聊区域 */}
      <ConversationPinnedGrid
        rooms={chatRooms}
        selectedId={selectedId}
        unreadCounts={unreadCounts}
        executingChatRooms={executingChatRooms}
        pendingOwnerMentionRoomIds={pendingOwnerMentionRoomIds}
        isMobile={isMobile}
        onSelect={onSelect}
        onContextMenu={handleContextMenu}
      />

      {/* Conversation list - 不支持拖动 */}
      <div ref={scrollContainerRef} className="scrollbar-hover flex-1 overflow-y-auto pb-3">
        {isLoading && chatRooms.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : chatRooms.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            {t('chat.noChatRooms')}
          </div>
        ) : (
          visibleRooms.map((room) => (
            <ConversationListItem
              key={room.id}
              room={room}
              selected={selectedId === room.id}
              unreadCount={unreadCounts[room.id] || 0}
              isExecuting={executingChatRooms.has(room.id)}
              hasOwnerMention={(unreadCounts[room.id] || 0) > 0 && pendingOwnerMentionRoomIds.has(room.id)}
              isMobile={isMobile}
              onSelect={onSelect}
              onContextMenu={handleContextMenu}
              itemRef={(el) => {
                if (el) {
                  roomItemRefs.current.set(room.id, el)
                } else {
                  roomItemRefs.current.delete(room.id)
                }
              }}
            />
          ))
        )}
      </div>

      {/* 折叠的群聊入口 - 固定在底部，不参与上方列表滚动 */}
      {collapsedRooms.length > 0 && (
        <div className="shrink-0 border-t border-border">
          {/* 展开后显示折叠的群聊（自身可滚动，避免过长撑高） */}
          {collapsedExpanded && (
            <div className="scrollbar-hover max-h-[50vh] overflow-y-auto bg-muted/30 py-1">
              {collapsedRooms.map((room) => (
                <ConversationListItem
                  key={room.id}
                  room={room}
                  selected={selectedId === room.id}
                  unreadCount={unreadCounts[room.id] || 0}
                  isExecuting={executingChatRooms.has(room.id)}
                  hasOwnerMention={(unreadCounts[room.id] || 0) > 0 && pendingOwnerMentionRoomIds.has(room.id)}
                  isMobile={isMobile}
                  onSelect={onSelect}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          )}
          <button
            onClick={() => setCollapsedExpanded((v) => !v)}
            className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Archive className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
              {t('chat.collapsedRooms')}
            </span>
            {!collapsedExpanded && collapsedUnreadDisplay && (
              <span className="flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                {collapsedUnreadDisplay}
              </span>
            )}
            {collapsedExpanded
              ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/60" />
              : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" />}
          </button>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <FloatingMenu
          open
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
            <button
              onClick={handleTogglePin}
              disabled={pinning}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              <Pin className="size-4" />
              {contextMenu.room.isPinned ? t('common.unpin') : t('common.pin')}
            </button>
            <button
              onClick={handleToggleCollapse}
              disabled={collapsing}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              <Archive className="size-4" />
              {contextMenu.room.isCollapsed ? t('chat.uncollapseRoom') : t('chat.collapseRoom')}
            </button>
            <button
              onClick={handleDuplicate}
              disabled={duplicating}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              {duplicating ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
              {t('floatingMenu.duplicate')}
            </button>
            <button
              onClick={() => handleExportTemplate(contextMenu.room)}
              disabled={exportingTemplate}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent disabled:opacity-50"
            >
              {exportingTemplate ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {t('chat.exportGroupTemplate')}
            </button>
            <button
              onClick={handleDeleteClick}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="size-4" />
              {t('chat.deleteGroup')}
            </button>
        </FloatingMenu>
      )}

      {/* 删除确认对话框 */}
      {showDeleteConfirm && roomToDelete && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={handleCancelDelete} />
          <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6 shadow-lg border border-border w-80">
            <h3 className="text-lg font-semibold text-foreground mb-2">{t('chat.confirmDelete')}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t('chat.deleteRoomConfirm', { name: roomToDelete.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? t('common.deleting') : t('chat.confirmDelete')}
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
        // 导入成功后刷新群聊列表，并自动选中新导入的群聊
        await onRefresh?.()
        onSelect(chatRoomId)
      }}
    />
    </>
  )
}
