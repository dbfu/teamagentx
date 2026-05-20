import { chatRoomApi, type ChatRoom, type ChatTaskBoard, type ChatTaskBoardItem } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { cn } from '@/lib/utils'
import { useSocketStore } from '@/stores/socket-store'
import { useIsMobile } from '@/hooks/use-mobile'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Eye, EyeOff, Loader2, PlayCircle, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type BoardColumnKey = 'completed' | 'issues' | 'executing' | 'pending'

// localStorage key for hidden columns
const HIDDEN_COLUMNS_KEY = 'taskboard-hidden-columns'

interface TaskBoardPanelProps {
  chatRoom: ChatRoom
  onViewStream?: (messageId: string, agentId: string, agentName: string) => void
  onViewExecutionRecord?: (executionRecordId: string, agentId: string) => void
  onViewTaskQueue?: (agentId: string) => void
}

interface BoardColumnConfig {
  key: BoardColumnKey
  title: string
  icon: LucideIcon
  emptyText: string
  tone: string
  badgeClassName: string
  // 用于合并列时指定数据来源
  dataKeys?: ('failed' | 'cancelled')[]
}

const emptyBoard: ChatTaskBoard = {
  completed: [],
  failed: [],
  executing: [],
  pending: [],
  cancelled: [],
}

const columns: BoardColumnConfig[] = [
  {
    key: 'completed',
    title: '已完成',
    icon: CheckCircle2,
    emptyText: '暂无已完成任务',
    tone: 'text-green-600',
    badgeClassName: 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400',
  },
  {
    key: 'executing',
    title: '正在执行',
    icon: PlayCircle,
    emptyText: '暂无执行中的任务',
    tone: 'text-blue-600',
    badgeClassName: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
  },
  {
    key: 'pending',
    title: '待处理',
    icon: Clock3,
    emptyText: '暂无待处理任务',
    tone: 'text-orange-600',
    badgeClassName: 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400',
  },
  {
    key: 'issues',
    title: '失败/已取消',
    icon: XCircle,
    emptyText: '暂无失败或取消任务',
    tone: 'text-slate-600',
    badgeClassName: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    dataKeys: ['failed', 'cancelled'],
  },
]

function formatTime(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(duration?: number | null) {
  if (!duration) return null

  const totalSeconds = Math.max(1, Math.round(duration / 1000))
  if (totalSeconds < 60) return `${totalSeconds}秒`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`
}

function getStatusLabel(item: ChatTaskBoardItem) {
  if (item.status === 'completed') return '已完成'
  if (item.status === 'failed') return '失败'
  if (item.status === 'executing') return '执行中'
  if (item.status === 'cancelled') return item.executionRecordId ? '已停止' : '已取消'
  if (item.status === 'interrupted') return '待恢复'
  return '等待中'
}

export function TaskBoardPanel({ chatRoom, onViewStream, onViewExecutionRecord, onViewTaskQueue }: TaskBoardPanelProps) {
  const {
    onAgentDone,
    onAgentStatus,
    onAgentTaskCancelled,
    onAgentTaskQueue,
    onAgentTaskResumed,
    onAgentTyping,
  } = useSocketStore()

  const isMobile = useIsMobile()
  const [board, setBoard] = useState<ChatTaskBoard>(emptyBoard)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 移动端当前选中的 tab
  const [activeTab, setActiveTab] = useState<BoardColumnKey>('executing')
  const [hiddenColumns, setHiddenColumns] = useState<Set<BoardColumnKey>>(() => {
    // 从 localStorage 读取隐藏列配置
    try {
      const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as BoardColumnKey[]
        return new Set(parsed)
      }
    } catch {
      // ignore
    }
    return new Set()
  })
  const [showDropdown, setShowDropdown] = useState(false)
  const [showColumnSettings, setShowColumnSettings] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const columnSettingsRef = useRef<HTMLDivElement>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 点击外部关闭移动端下拉菜单
  useEffect(() => {
    if (!showDropdown) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showDropdown])

  // 点击外部关闭桌面端列配置下拉菜单
  useEffect(() => {
    if (!showColumnSettings) return

    const handleClickOutside = (event: MouseEvent) => {
      if (columnSettingsRef.current && !columnSettingsRef.current.contains(event.target as Node)) {
        setShowColumnSettings(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColumnSettings])

  // 保存隐藏列配置到 localStorage
  useEffect(() => {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(Array.from(hiddenColumns)))
  }, [hiddenColumns])

  const toggleColumn = useCallback((key: BoardColumnKey) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const visibleColumns = useMemo(() => {
    return columns.filter((col) => !hiddenColumns.has(col.key))
  }, [hiddenColumns])

  const agentMap = useMemo(() => {
    const map = new Map<string, NonNullable<ChatRoom['chatRoomAgents'][number]['agent']>>()
    for (const roomAgent of chatRoom.chatRoomAgents ?? []) {
      if (roomAgent.agent) {
        map.set(roomAgent.agent.id, roomAgent.agent)
      }
    }
    return map
  }, [chatRoom.chatRoomAgents])

  const loadBoard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)

    try {
      const response = await chatRoomApi.getTaskBoard(chatRoom.id)
      if (response.success && response.data) {
        setBoard(response.data)
      } else {
        setError(response.error || '任务看板加载失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务看板加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [chatRoom.id])

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }

    refreshTimerRef.current = setTimeout(() => {
      void loadBoard(true)
      refreshTimerRef.current = null
    }, 160)
  }, [loadBoard])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  useEffect(() => {
    const unsubscribers = [
      onAgentTaskQueue((data) => {
        if (data.chatRoomId === chatRoom.id) scheduleRefresh()
      }),
      onAgentTaskCancelled((data) => {
        if (data.chatRoomId === chatRoom.id) scheduleRefresh()
      }),
      onAgentTaskResumed((data) => {
        if (data.chatRoomId === chatRoom.id) scheduleRefresh()
      }),
      onAgentStatus((data) => {
        if (data.chatRoomId === chatRoom.id) scheduleRefresh()
      }),
      onAgentTyping(() => scheduleRefresh()),
      onAgentDone(() => scheduleRefresh()),
    ]

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [
    chatRoom.id,
    onAgentDone,
    onAgentStatus,
    onAgentTaskCancelled,
    onAgentTaskQueue,
    onAgentTaskResumed,
    onAgentTyping,
    scheduleRefresh,
  ])

  // 获取列的任务数据，处理合并列的情况
  const getColumnTasks = useCallback((column: BoardColumnConfig): ChatTaskBoardItem[] => {
    if (column.dataKeys) {
      // 合并列：把多个数据源的数组合并
      return column.dataKeys.flatMap((key) => board[key])
    }
    // 单一列：直接取对应 key 的数据
    if (column.key === 'completed') return board.completed
    if (column.key === 'executing') return board.executing
    if (column.key === 'pending') return board.pending
    return []
  }, [board])

  const totalCount = board.completed.length + board.failed.length + board.executing.length + board.pending.length + board.cancelled.length
  const visibleCount = visibleColumns.length

  // 移动端：当前选中的列
  const activeColumn = visibleColumns.find(col => col.key === activeTab) || visibleColumns[0]

  // 当 visibleColumns 变化时，确保 activeTab 有效
  useEffect(() => {
    if (isMobile && visibleColumns.length > 0 && !visibleColumns.some(col => col.key === activeTab)) {
      setActiveTab(visibleColumns[0].key)
    }
  }, [isMobile, visibleColumns, activeTab])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 移动端下拉选择器 */}
      {isMobile && visibleCount > 0 && activeColumn && (
        <div ref={dropdownRef} className="relative shrink-0">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm',
              'bg-background hover:bg-accent transition-colors'
            )}
          >
            <div className="flex items-center gap-2">
              <activeColumn.icon className={cn('size-4', activeColumn.tone)} />
              <span className="font-medium">{activeColumn.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('rounded-full px-1.5 py-0.5 text-xs font-medium', activeColumn.badgeClassName)}>
                {getColumnTasks(activeColumn).length}
              </span>
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', showDropdown && 'rotate-180')} />
            </div>
          </button>

          {showDropdown && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-lg border border-border bg-card p-1.5 shadow-lg">
              {visibleColumns.map((column) => {
                const Icon = column.icon
                const isActive = activeTab === column.key
                const taskCount = getColumnTasks(column).length
                return (
                  <button
                    key={column.key}
                    onClick={() => {
                      setActiveTab(column.key)
                      setShowDropdown(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={cn('size-4', column.tone)} />
                      <span>{column.title}</span>
                    </div>
                    <span className={cn('rounded-full px-1.5 py-0.5 text-xs', isActive ? column.badgeClassName : 'bg-muted')}>
                      {taskCount}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* 桌面端工具栏 */}
      {!isMobile && (
        <div className="flex shrink-0 items-center justify-between">
          <div ref={columnSettingsRef} className="relative">
            {showColumnSettings && (
              <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-border bg-card p-2 shadow-lg">
                <div className="mb-2 text-xs text-muted-foreground">显示/隐藏列</div>
                {columns.map((column) => {
                  const Icon = column.icon
                  const isHidden = hiddenColumns.has(column.key)
                  return (
                    <button
                      key={column.key}
                      onClick={() => toggleColumn(column.key)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                        isHidden
                          ? 'text-muted-foreground hover:bg-accent'
                          : 'text-foreground bg-accent/50 hover:bg-accent'
                      )}
                    >
                      <Icon className={cn('size-4', column.tone)} />
                      <span className="flex-1">{column.title}</span>
                      {isHidden ? (
                        <EyeOff className="size-4 text-muted-foreground" />
                      ) : (
                        <Eye className="size-4 text-primary" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          <AlertCircle className="size-4" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
        </div>
      )}

      {loading && totalCount === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          <span className="text-sm">加载任务看板...</span>
        </div>
      ) : visibleCount === 0 ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <span className="text-sm">所有列已隐藏</span>
        </div>
      ) : isMobile ? (
        // 移动端：只显示当前选中的列
        activeColumn && (
          <div className="flex min-h-0 flex-1 flex-col">
            <TaskBoardColumn
              key={activeColumn.key}
              column={activeColumn}
              tasks={getColumnTasks(activeColumn)}
              agentMap={agentMap}
              onViewStream={onViewStream}
              onViewExecutionRecord={onViewExecutionRecord}
              onViewTaskQueue={onViewTaskQueue}
            />
          </div>
        )
      ) : (
        // 桌面端：并排显示所有列
        <div
          className="grid min-h-0 flex-1 gap-1.5"
          style={{ gridTemplateColumns: `repeat(${visibleCount}, minmax(0, 1fr))` }}
        >
          {visibleColumns.map((column) => (
            <TaskBoardColumn
              key={column.key}
              column={column}
              tasks={getColumnTasks(column)}
              agentMap={agentMap}
              onViewStream={onViewStream}
              onViewExecutionRecord={onViewExecutionRecord}
              onViewTaskQueue={onViewTaskQueue}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskBoardColumn({
  column,
  tasks,
  agentMap,
  onViewStream,
  onViewExecutionRecord,
  onViewTaskQueue,
}: {
  column: BoardColumnConfig
  tasks: ChatTaskBoardItem[]
  agentMap: Map<string, NonNullable<ChatRoom['chatRoomAgents'][number]['agent']>>
  onViewStream?: (messageId: string, agentId: string, agentName: string) => void
  onViewExecutionRecord?: (executionRecordId: string, agentId: string) => void
  onViewTaskQueue?: (agentId: string) => void
}) {
  const Icon = column.icon

  return (
    <section className="flex min-h-0 flex-col rounded-lg border border-border bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className={cn('size-4', column.tone)} />
          <span className="truncate text-sm font-medium text-foreground">{column.title}</span>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', column.badgeClassName)}>
          {tasks.length}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
        {tasks.length === 0 ? (
          <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
            {column.emptyText}
          </div>
        ) : (
          tasks.map((task) => (
            <TaskBoardCard
              key={`${task.kind}-${task.id}`}
              task={task}
              agent={agentMap.get(task.agentId)}
              onViewStream={onViewStream}
              onViewExecutionRecord={onViewExecutionRecord}
              onViewTaskQueue={onViewTaskQueue}
            />
          ))
        )}
      </div>
    </section>
  )
}

function TaskBoardCard({
  task,
  agent,
  onViewStream,
  onViewExecutionRecord,
  onViewTaskQueue,
}: {
  task: ChatTaskBoardItem
  agent?: NonNullable<ChatRoom['chatRoomAgents'][number]['agent']>
  onViewStream?: (messageId: string, agentId: string, agentName: string) => void
  onViewExecutionRecord?: (executionRecordId: string, agentId: string) => void
  onViewTaskQueue?: (agentId: string) => void
}) {
  const duration = formatDuration(task.duration)
  const canViewStream = task.status === 'executing' && !!task.messageId && !!onViewStream
  const canViewRecord = (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && !!task.executionRecordId && !!onViewExecutionRecord
  const canViewQueue = (task.status === 'pending' || task.status === 'cancelled' || task.status === 'interrupted') && !task.executionRecordId && !!onViewTaskQueue
  const canOpenDetail = canViewStream || canViewRecord || canViewQueue

  const handleOpenDetail = () => {
    if (canViewStream && task.messageId) {
      onViewStream(task.messageId, task.agentId, task.agentName)
      return
    }

    if (canViewRecord && task.executionRecordId) {
      onViewExecutionRecord(task.executionRecordId, task.agentId)
      return
    }

    if (canViewQueue) {
      onViewTaskQueue(task.agentId)
    }
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-3 shadow-xs transition-colors',
        canOpenDetail && 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
      )}
      onClick={canOpenDetail ? handleOpenDetail : undefined}
      role={canOpenDetail ? 'button' : undefined}
      tabIndex={canOpenDetail ? 0 : undefined}
      onKeyDown={(event) => {
        if (!canOpenDetail) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleOpenDetail()
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <AgentAvatarImage avatar={agent?.avatar ?? null} className="size-6 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">
            {agent?.name || task.agentName}
          </div>
          <div className="text-xs text-muted-foreground">{formatTime(task.createdAt)}</div>
        </div>
        {task.status === 'failed' && <AlertCircle className="size-4 shrink-0 text-red-500" />}
        {task.status === 'executing' && <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" />}
        {(task.status === 'cancelled' || task.status === 'interrupted') && <XCircle className="size-4 shrink-0 text-muted-foreground" />}
      </div>

      <div className="line-clamp-4 break-words text-sm leading-5 text-foreground">
        {task.messageContent || '(空消息)'}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted-foreground">
          <span>{getStatusLabel(task)}</span>
          {duration && <span className="ml-2">{duration}</span>}
        </div>

        {canOpenDetail && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs text-blue-600 dark:text-blue-400">
            <Eye className="size-3" />
            详情
          </span>
        )}
      </div>

      {task.errorMessage && (
        <div className="mt-2 line-clamp-2 break-words text-xs text-red-500">
          {task.errorMessage}
        </div>
      )}
    </div>
  )
}
