import { useEffect, useMemo } from 'react'
import { Clock3, Inbox, MessageSquareText, X } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { TodoData, useSocketStore } from '@/stores/socket-store'

interface TodoModalProps {
  isOpen: boolean
  onClose: () => void
  onTodoClick: (todo: TodoData) => void
}

export function TodoModal({ isOpen, onClose, onTodoClick }: TodoModalProps) {
  const todos = useSocketStore((s) => s.todos)
  const requestTodos = useSocketStore((s) => s.requestTodos)
  const completeTodo = useSocketStore((s) => s.completeTodo)

  const openAndCompleteTodo = (todo: TodoData) => {
    completeTodo(todo.id)
    onTodoClick(todo)
    onClose()
  }

  useEffect(() => {
    if (isOpen) {
      requestTodos()
    }
  }, [isOpen, requestTodos])

  const pendingTodos = useMemo(
    () => todos.filter((todo) => todo.status === 'pending'),
    [todos],
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pb-6 pt-[10vh]">
      <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 flex max-h-[min(760px,86vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border bg-muted/30 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm shadow-blue-500/20">
                  <Inbox className="size-4" />
                </div>
                <h3 className="text-base font-semibold text-foreground">待办事项</h3>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border bg-background px-2 py-0.5">
                  {pendingTodos.length} 个待处理
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
              title="关闭"
              aria-label="关闭"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/35">
          {pendingTodos.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
              <div className="flex size-12 items-center justify-center rounded-2xl border border-dashed border-border bg-card">
                <Clock3 className="size-6" />
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">暂无待办事项</div>
                <div className="mt-1 text-xs">当前没有需要处理的提醒</div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border bg-card">
              {pendingTodos.map((todo) => (
                <div
                  key={todo.id}
                  role="button"
                  tabIndex={0}
                  className="group flex w-full cursor-pointer items-start gap-3 px-5 py-4 text-left outline-none transition-colors hover:bg-blue-50/70 focus:bg-blue-50/70 dark:hover:bg-blue-950/20 dark:focus:bg-blue-950/20"
                  onClick={() => openAndCompleteTodo(todo)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openAndCompleteTodo(todo)
                    }
                  }}
                >
                  <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-sm font-semibold text-blue-600 shadow-sm dark:border-blue-900/70 dark:bg-blue-950/30 dark:text-blue-300">
                    {todo.triggerAgentName?.charAt(0) || 'A'}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        @{todo.triggerAgentName}
                      </span>
                      <span className="shrink-0 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[11px] font-medium text-orange-600 dark:text-orange-300">
                        待处理
                      </span>
                    </div>

                    <div className="mt-1.5 line-clamp-2 text-sm leading-6 text-foreground/85">
                      {todo.contentSummary}
                    </div>

                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex min-w-0 items-center gap-1">
                        <MessageSquareText className="size-3.5 shrink-0" />
                        <span className="truncate">{todo.chatRoomName}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock3 className="size-3.5" />
                        {formatRelativeTime(todo.createdAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
