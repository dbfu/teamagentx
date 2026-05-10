import { useEffect, useState, useRef } from 'react'
import { Clock, Loader2, List, XCircle, RefreshCw, X } from 'lucide-react'
import { useSocketStore } from '@/stores/socket-store'
import { cn } from '@/lib/utils'

interface TaskItem {
  id: string
  messageId: string
  messageContent: string
  createdAt: string
  status: string  // pending | interrupted | cancelled
  agentId?: string
  agentName?: string
}

interface TaskQueuePanelProps {
  chatRoomId: string
  agentId: string
  agentStatus?: 'idle' | 'executing' | 'busy'
  onViewStream?: (messageId: string, agentId: string, agentName: string) => void
}

export function TaskQueuePanel({
  chatRoomId,
  agentId,
  agentStatus,
  onViewStream,
}: TaskQueuePanelProps) {
  const { requestAgentTaskQueue, onAgentTaskQueue, cancelTask, resumeTask, onAgentTaskCancelled, onAgentTaskResumed, requestInactiveTasks, onInactiveTasks } = useSocketStore()

  const [tasks, setTasks] = useState<TaskItem[]>([])  // pending 任务
  const [inactiveTasks, setInactiveTasks] = useState<TaskItem[]>([])  // interrupted + cancelled
  const [loading, setLoading] = useState(false)

  // 使用 ref 防止重复请求
  const requestedRef = useRef(false)

  // 监听任务队列响应（只返回 pending）
  useEffect(() => {
    const unsubscribe = onAgentTaskQueue((data) => {
      if (data.agentId === agentId && data.chatRoomId === chatRoomId) {
        setTasks(data.tasks)
        setLoading(false)
      }
    })

    // 初始请求
    if (!requestedRef.current) {
      requestedRef.current = true
      setLoading(true)
      requestAgentTaskQueue(chatRoomId, agentId)
      requestInactiveTasks(chatRoomId)
    }

    return unsubscribe
  }, [agentId, chatRoomId, onAgentTaskQueue, requestAgentTaskQueue, requestInactiveTasks])

  // 监听非活跃任务（interrupted + cancelled）
  useEffect(() => {
    const unsubscribe = onInactiveTasks((data) => {
      if (data.chatRoomId === chatRoomId) {
        setInactiveTasks(data.tasks)
      }
    })
    return unsubscribe
  }, [chatRoomId, onInactiveTasks])

  // 监听任务取消事件 - 从任务队列移到非活跃列表
  useEffect(() => {
    const unsubscribe = onAgentTaskCancelled((data) => {
      if (data.chatRoomId === chatRoomId && data.agentId === agentId) {
        // 从 tasks 中移除
        const cancelledTask = tasks.find(t => t.id === data.taskId)
        if (cancelledTask) {
          setTasks(prev => prev.filter(t => t.id !== data.taskId))
          // 添加到 inactiveTasks
          setInactiveTasks(prev => {
            // 防止重复添加
            if (prev.some(t => t.id === data.taskId)) return prev
            return [...prev, { ...cancelledTask, status: 'cancelled' }]
          })
        }
      }
    })
    return unsubscribe
  }, [chatRoomId, agentId, onAgentTaskCancelled, tasks])

  // 监听任务恢复事件 - 从非活跃列表移到任务队列
  useEffect(() => {
    const unsubscribe = onAgentTaskResumed((data) => {
      if (data.chatRoomId === chatRoomId && data.agentId === agentId) {
        // 从 inactiveTasks 中移除
        const resumedTask = inactiveTasks.find(t => t.id === data.taskId)
        if (resumedTask) {
          setInactiveTasks(prev => prev.filter(t => t.id !== data.taskId))
          // 添加到 tasks（状态为 pending）
          setTasks(prev => {
            // 防止重复添加
            if (prev.some(t => t.id === data.taskId)) return prev
            return [...prev, { ...resumedTask, status: 'pending' }]
          })
        }
      }
    })
    return unsubscribe
  }, [chatRoomId, agentId, onAgentTaskResumed, inactiveTasks])

  // 格式化时间
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  // 判断是否正在执行
  const isExecuting = agentStatus === 'executing' || agentStatus === 'busy'

  // 状态配置
  const statusConfig = {
    idle: { color: 'bg-muted', textColor: 'text-muted-foreground', label: '空闲' },
    executing: { color: 'bg-green-500', textColor: 'text-green-600', label: '正在执行' },
    busy: { color: 'bg-orange-500', textColor: 'text-orange-600', label: '繁忙' },
  }[agentStatus || 'idle']

  // 筛选当前 agent 的非活跃任务
  const agentInactiveTasks = inactiveTasks.filter(t => t.agentId === agentId)

  return (
    <div className="space-y-4">
      {/* 助手状态 */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">助手状态：</span>
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs',
          isExecuting ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'
        )}>
          {isExecuting && <Loader2 className="size-3 animate-spin" />}
          {statusConfig?.label}
        </span>
      </div>

      {/* 非活跃任务（interrupted + cancelled） */}
      {agentInactiveTasks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-orange-500">
            <XCircle className="size-3" />
            <span>待恢复的任务</span>
          </div>
          {agentInactiveTasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border',
                task.status === 'interrupted'
                  ? 'bg-orange-50 border-orange-200 dark:bg-orange-950/30 dark:border-orange-800'
                  : 'bg-muted border-border'
              )}
            >
              <XCircle className={cn(
                'size-4',
                task.status === 'interrupted' ? 'text-orange-500' : 'text-muted-foreground'
              )} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">
                  {task.messageContent || '(空消息)'}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn(
                    'text-xs',
                    task.status === 'interrupted' ? 'text-orange-500' : 'text-muted-foreground'
                  )}>
                    {task.status === 'interrupted' ? '服务中断' : '已取消'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(task.createdAt)}
                  </span>
                </div>
              </div>
              <button
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                onClick={() => resumeTask(chatRoomId, task.id)}
              >
                <RefreshCw className="size-3" />
                恢复
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 任务列表标题 */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <List className="size-3" />
        <span>等待执行的任务</span>
        {loading && <Loader2 className="size-3 animate-spin" />}
      </div>

      {/* 任务列表（只包含 pending） */}
      {loading && tasks.length === 0 ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-4">
          暂无等待执行的任务
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task, index) => {
            // pending 任务，第一个正在执行时显示绿色
            const isFirstExecuting = index === 0 && isExecuting

            return (
              <div
                key={task.id}
                className={cn(
                  'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                  isFirstExecuting
                    ? 'bg-green-50 border-green-200 cursor-pointer hover:bg-green-100 dark:bg-green-950/30 dark:border-green-800 dark:hover:bg-green-900/40'
                    : 'bg-muted border-border'
                )}
                onClick={() => {
                  if (isFirstExecuting && onViewStream && task.agentName) {
                    onViewStream(task.messageId, agentId, task.agentName)
                  }
                }}
                title={isFirstExecuting && onViewStream ? '点击查看执行过程' : undefined}
              >
                <div className="flex items-center gap-2">
                  {isFirstExecuting ? (
                    <Loader2 className="size-4 animate-spin text-green-500" />
                  ) : (
                    <Clock className="size-4 text-muted-foreground" />
                  )}
                  <span className={cn(
                    'font-mono text-sm font-medium',
                    isFirstExecuting ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
                  )}>
                    #{index + 1}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-foreground truncate">
                    {task.messageContent || '(空消息)'}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={cn(
                      'text-xs',
                      isFirstExecuting ? 'text-green-500' : 'text-muted-foreground'
                    )}>
                      {isFirstExecuting ? '正在执行' : '等待中'}
                    </span>
                    {isFirstExecuting && onViewStream && (
                      <span className="text-xs text-green-600 dark:text-green-400 underline">
                        查看详情
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatTime(task.createdAt)}
                    </span>
                  </div>
                </div>
                {/* 取消按钮（正在执行的不能取消） */}
                {!isFirstExecuting && (
                  <button
                    className="inline-flex items-center justify-center size-6 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      cancelTask(chatRoomId, task.id)
                    }}
                    title="取消任务"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer 提示 */}
      {tasks.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          任务队列按时间顺序执行，当前正在执行第一个待处理任务
        </p>
      )}
    </div>
  )
}