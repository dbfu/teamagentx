import { useEffect, useState } from 'react'
import { useSocketStore, TodoData } from '@/stores/socket-store'
import { X, Check, Trash2, Clock } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

interface TodoModalProps {
  isOpen: boolean
  onClose: () => void
  onTodoClick: (todo: TodoData) => void
}

export function TodoModal({ isOpen, onClose, onTodoClick }: TodoModalProps) {
  const { todos, requestTodos, onTodoList, onTodoCreated, completeTodo, dismissTodo, onTodoUpdated } = useSocketStore()
  const [localTodos, setLocalTodos] = useState<TodoData[]>([])

  // 初始化请求待办列表
  useEffect(() => {
    if (isOpen) {
      requestTodos()
    }
  }, [isOpen, requestTodos])

  // 监听待办列表返回
  useEffect(() => {
    const unsubList = onTodoList((data) => {
      setLocalTodos(data.todos)
    })
    return unsubList
  }, [onTodoList])

  // 监听新待办创建
  useEffect(() => {
    const unsubCreated = onTodoCreated((todo) => {
      setLocalTodos((prev) => {
        // 避免重复添加
        if (prev.some((t) => t.id === todo.id)) return prev
        return [todo, ...prev]
      })
    })
    return unsubCreated
  }, [onTodoCreated])

  // 监听待办状态更新
  useEffect(() => {
    const unsubUpdated = onTodoUpdated((data) => {
      setLocalTodos((prev) => prev.filter((t) => t.id !== data.todoId))
    })
    return unsubUpdated
  }, [onTodoUpdated])

  // 同步 store 中的 todos
  useEffect(() => {
    setLocalTodos(todos)
  }, [todos])

  const handleComplete = (todoId: string) => {
    completeTodo(todoId)
  }

  const handleDismiss = (todoId: string) => {
    dismissTodo(todoId)
  }

  const handleTodoClick = (todo: TodoData) => {
    onTodoClick(todo)
    onClose()
  }

  if (!isOpen) return null

  const pendingTodos = localTodos.filter((t) => t.status === 'pending')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-[400px] max-h-[500px] rounded-xl bg-card shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">待办事项</h3>
          <button
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-full hover:bg-accent"
          >
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[400px] overflow-y-auto">
          {pendingTodos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Clock className="size-8 mb-2" />
              <span className="text-sm">暂无待办事项</span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {pendingTodos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-accent cursor-pointer"
                  onClick={() => handleTodoClick(todo)}
                >
                  {/* 助手头像 */}
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <span className="text-xs font-medium text-primary">
                      {todo.triggerAgentName?.charAt(0) || 'A'}
                    </span>
                  </div>

                  {/* 内容区域 */}
                  <div className="min-w-0 flex-1">
                    {/* 助手名 */}
                    <div className="text-sm font-medium text-primary">
                      @{todo.triggerAgentName}
                    </div>

                    {/* 消息摘要 */}
                    <div className="mt-0.5 text-sm text-foreground line-clamp-2">
                      {todo.contentSummary}
                    </div>

                    {/* 群聊名和时间 */}
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{todo.chatRoomName}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(todo.createdAt)}</span>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleComplete(todo.id)
                      }}
                      className="flex size-6 items-center justify-center rounded-full hover:bg-green-500/10"
                      title="完成"
                    >
                      <Check className="size-4 text-green-500" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDismiss(todo.id)
                      }}
                      className="flex size-6 items-center justify-center rounded-full hover:bg-accent"
                      title="忽略"
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {pendingTodos.length > 0 && (
          <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground text-center">
            点击待办项跳转到对应消息
          </div>
        )}
      </div>
    </div>
  )
}