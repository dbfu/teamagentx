import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn, coerceThinkingText, truncateToolName } from '@/lib/utils';
import type { StreamEvent } from '@/stores/socket-store';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { Bot, CheckCircle, ChevronDown, ChevronRight, Clock, Square } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../markdown-content';
import { CodeEditToolContent, CodeReadToolOutput, isCodeEditTool, isCodeReadTool, renderToolValue } from './tool-call-content';

// 格式化开始时间（显示时分秒）
function formatStartTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

// 格式化持续时间（1m40s 格式，分钟为0时只显示秒）
function formatDuration(timestamp: number, endTime?: number): string {
  const end = endTime || Date.now()
  const diffMs = end - timestamp
  const totalSeconds = Math.ceil(diffMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m${seconds}s`
}

// 内部任务清单状态图标和颜色
function getTodoStatusIcon(status: string, t: (key: string) => string): { icon: React.ReactNode; color: string; label: string } {
  switch (status) {
    case 'completed':
      return { icon: <CheckCircle className="size-3.5" />, color: 'text-green-500', label: t('chat.taskCompleted') }
    case 'in_progress':
      return { icon: null, color: 'text-blue-500', label: t('chat.taskInProgress') }
    case 'pending':
      return { icon: <div className="size-3.5 rounded-full border-2 border-muted-foreground/40" />, color: 'text-muted-foreground', label: t('chat.taskPending') }
    default:
      return { icon: <div className="size-3.5 rounded-full border-2 border-muted-foreground/40" />, color: 'text-muted-foreground', label: status }
  }
}

// 时间指示器组件
function TimeIndicator({ event, isCompleted }: { event: StreamEvent; isCompleted?: boolean }) {
  const isFinal = Boolean(isCompleted || event.endTime)
  const [now, setNow] = useState(() => Date.now())

  // 正在执行的事件需要定时更新持续时间
  useEffect(() => {
    if (isFinal) return // 已完成，不需要定时更新

    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000) // 每秒更新一次

    return () => clearInterval(timer)
  }, [isFinal])

  const durationEndTime = event.endTime ?? (isFinal ? undefined : now)

  return (
    <div className="flex items-center gap-1 text-muted-foreground whitespace-nowrap ml-auto shrink-0">
      <Clock className="size-3 shrink-0" />
      <span>{formatStartTime(event.timestamp)}</span>
      <span className="text-muted-foreground/50">·</span>
      <span className={isCompleted ? 'text-green-500' : ''}>{formatDuration(event.timestamp, durationEndTime)}</span>
    </div>
  )
}

function TotalTimeIndicator({ events, isRunning, startTime }: { events: StreamEvent[]; isRunning: boolean; startTime?: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!isRunning) return

    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [isRunning])

  if (!startTime && events.length === 0) return null

  const firstEventTime = events.length > 0
    ? Math.min(...events.map(event => event.timestamp))
    : undefined
  const totalStartTime = startTime ?? firstEventTime
  if (!totalStartTime) return null

  const completedEndTime = events.length > 0
    ? Math.max(...events.map(event => event.endTime ?? event.timestamp))
    : totalStartTime
  const endTime = isRunning ? now : completedEndTime

  return (
    <span className="text-muted-foreground tabular-nums">
      · 耗时 {formatDuration(totalStartTime, endTime)}
    </span>
  )
}

function ProcessingIndicator({ label }: { label: string }) {
  const [dotCount, setDotCount] = useState(3)
  const baseLabel = label.replace(/[.\u2026。]+$/u, '')

  useEffect(() => {
    const timer = setInterval(() => {
      setDotCount((count) => count % 3 + 1)
    }, 500)

    return () => clearInterval(timer)
  }, [])

  return (
    <span className="text-primary">
      {baseLabel}
      <span className="inline-block w-3 text-left">{'.'.repeat(dotCount)}</span>
    </span>
  )
}

function CollapsibleStateIcon({ className }: { className?: string }) {
  return (
    <>
      <ChevronRight className={cn('size-3 text-muted-foreground group-data-[state=open]:hidden', className)} />
      <ChevronDown className={cn('hidden size-3 text-muted-foreground group-data-[state=open]:block', className)} />
    </>
  )
}

function OverlayScrollArea({
  className,
  viewportClassName,
  scrollbarClassName,
  viewportRef,
  children,
}: {
  className?: string
  viewportClassName?: string
  scrollbarClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}) {
  return (
    <ScrollAreaPrimitive.Root type="hover" className={cn('relative overflow-hidden', className)}>
      {/* Radix 默认把内容包裹在 display:table 容器里，会按最宽内容撑开宽度，
          导致 pre 等内容无法按面板宽度换行而溢出屏幕。强制内层为 block 以占满宽度并正常换行。 */}
      <ScrollAreaPrimitive.Viewport ref={viewportRef} className={cn('h-full w-full [&>div]:!block [&>div]:!min-w-0', viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className={cn('absolute right-0 top-0 z-10 flex h-full w-1.5 touch-none select-none p-px transition-opacity data-[state=hidden]:opacity-0 data-[state=visible]:opacity-100', scrollbarClassName)}
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border/80" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

interface StreamPanelProps {
  streamingViewAgent: { messageId: string; agentId: string; name: string } | null
  messageStartTime?: number
  completedAgents: Set<string>
  streamEvents: Map<string, StreamEvent[]>
  chatRoomId?: string
  onStop?: (agentId: string, messageId?: string) => void
}

// 单个事件项：抽成 memo 组件，流式高频重渲染时跳过内容未变化的已完成事件，
// 避免每个 token 都把整段事件列表（含 Markdown 解析）全部重渲染。
const StreamEventItem = memo(function StreamEventItem({
  event,
  t,
}: {
  event: StreamEvent
  t: (key: string) => string
}) {
  // 思考过程
  if (event.type === 'thinking') {
    return (
      <Collapsible defaultOpen className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs">
        <CollapsibleTrigger asChild>
          <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80 min-w-0">
            <CollapsibleStateIcon />
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 font-medium">
              🧠 {t('chat.thinkingProcess')}
            </span>
            <TimeIndicator event={event} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <MarkdownContent
            content={coerceThinkingText(event.content)}
            disableMermaid
            className="px-3 pb-3 dark:prose-invert [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs"
          />
        </CollapsibleContent>
      </Collapsible>
    )
  }

  // 工具调用
  if (event.type === 'tool_call' && event.toolCall) {
    const tool = event.toolCall
    const isToolCompleted = tool.status === 'completed' || tool.status === 'error'

    // 普通工具调用
    return (
      <Collapsible className={cn(
        'rounded border text-xs',
        tool.status === 'error' ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800' :
        tool.status === 'completed' ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800' :
        'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800'
      )}>
        <CollapsibleTrigger asChild>
          <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80 min-w-0">
            <CollapsibleStateIcon className="shrink-0" />
            <div className="flex-1 w-0 min-w-0">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium truncate max-w-full"
                title={tool.name || t('chat.toolCall')}
              >
                🔧 {truncateToolName(tool.name)}
              </span>
            </div>
            {tool.status === 'in_progress' && (
              <span className="text-purple-600 dark:text-purple-400 whitespace-nowrap shrink-0">
                <span>{t('chat.executing')}</span>
              </span>
            )}
            {tool.status === 'completed' && (
              <span className="text-green-600 dark:text-green-400 whitespace-nowrap shrink-0">{t('chat.toolCompleted')}</span>
            )}
            {tool.status === 'error' && (
              <span className="text-red-600 dark:text-red-400 whitespace-nowrap shrink-0">{t('chat.toolError')}</span>
            )}
            <TimeIndicator event={event} isCompleted={isToolCompleted} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2 pb-2 space-y-2">
            {tool.input && Object.keys(tool.input).length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t('chat.toolInput')}</div>
                {isCodeEditTool(tool) ? (
                  <CodeEditToolContent tool={tool} />
                ) : (
                  <div className="font-mono text-muted-foreground bg-muted/50 rounded p-2 overflow-hidden">
                    <pre className="whitespace-pre-wrap text-xs break-all">{JSON.stringify(tool.input, null, 2)}</pre>
                  </div>
                )}
              </div>
            )}
            {tool.output && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t('chat.toolOutput')}</div>
                {isCodeReadTool(tool) && typeof tool.output === 'string' ? (
                  <CodeReadToolOutput tool={tool} />
                ) : (
                  <div className="font-mono text-muted-foreground bg-muted/50 rounded p-2 overflow-hidden">
                    <pre className="whitespace-pre-wrap text-xs break-all">
                      {renderToolValue(tool.output)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  // 输出内容
  if (event.type === 'output') {
    return (
      <Collapsible defaultOpen className="rounded border border-primary/20 bg-primary/5 text-xs">
          <CollapsibleTrigger asChild>
            <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80 min-w-0">
              <CollapsibleStateIcon />
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
              📤 {t('chat.outputContent')}
            </span>
            <TimeIndicator event={event} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <MarkdownContent
            content={coerceThinkingText(event.content)}
            disableMermaid
            className="px-3 pb-3 dark:prose-invert [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs"
          />
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return null
})

export function StreamPanel({
  streamingViewAgent,
  messageStartTime,
  completedAgents,
  streamEvents,
  chatRoomId,
  onStop,
}: StreamPanelProps) {
  const { t } = useTranslation()
  const prevTotalContentRef = useRef('')
  const [showNewMessageHint, setShowNewMessageHint] = useState(false)  // 显示新消息提示
  const scrollThreshold = 50  // 判断是否在底部的阈值（像素）

  // 贴底意图 ref：是否停留在底部（用于控制自动滚动）。
  // 用 ref 而非 state，渲染只依赖 showNewMessageHint，异步回调也能读到最新值。
  const isAtBottomRef = useRef(true)
  // 标记下一次 scroll 事件由程序自动滚动触发，需被 handleScroll 忽略，
  // 否则流式内容在「设置 scrollTop」到「scroll 事件触发」之间继续变长，会被误判为离开底部
  const autoScrollingRef = useRef(false)

  const setAtBottom = (value: boolean) => {
    isAtBottomRef.current = value
  }

  // 程序滚动到底部（仅在位置真正变化时标记忽略本次 scroll 事件，
  // 否则不会派发 scroll 事件，标记会残留并误吞用户的下一次滚动）
  const stickToBottom = (container: HTMLDivElement) => {
    // scrollTop 会被浏览器钳制到 scrollHeight - clientHeight，按此判断是否已在底部
    const maxScrollTop = container.scrollHeight - container.clientHeight
    if (container.scrollTop >= maxScrollTop) return
    autoScrollingRef.current = true
    container.scrollTop = container.scrollHeight
  }

  // 内部滚动容器 ref
  const internalScrollRef = useRef<HTMLDivElement>(null)
  // 滚动区域内部内容 ref（用于监听折叠/展开导致的高度变化）
  const scrollContentRef = useRef<HTMLDivElement>(null)
  // todos 容器 ref（用于滚动到正在执行的任务）
  const todosContainerRef = useRef<HTMLDivElement>(null)
  // 记录上一个正在执行的任务索引，避免重复滚动
  const prevInProgressKeyRef = useRef('')

  // 滚动到底部
  const scrollToBottom = () => {
    if (internalScrollRef.current) {
      stickToBottom(internalScrollRef.current)
      setAtBottom(true)
      setShowNewMessageHint(false)
    }
  }

  // 判断是否正在执行（按 messageId_agentId）
  const completedKey = streamingViewAgent ? `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}` : ''
  const isExecuting = streamingViewAgent && !completedAgents.has(completedKey)

  // 获取当前 messageId_agentId 的 events
  const streamKey = streamingViewAgent ? `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}` : ''
  const events = streamingViewAgent ? (streamEvents.get(streamKey) || []) : []

  // 提取 todo 工具数据（用于底部固定显示）
  const todosEvent = events.find(e => e.type === 'tool_call' && e.toolCall?.name && ['write_todos', 'TodoWrite'].includes(e.toolCall.name))
  const todosData = todosEvent?.toolCall?.input as { todos?: Array<{ content: string; status: string }> } | undefined
  const todos = todosData?.todos || []
  const todosStatus = todosEvent?.toolCall?.status

  // 查找正在执行的任务索引
  const inProgressIndex = todos.findIndex(t => t.status === 'in_progress')
  const inProgressTodo = inProgressIndex >= 0 ? todos[inProgressIndex] : null
  const inProgressKey = inProgressTodo
    ? `${streamKey}:${inProgressIndex}:${inProgressTodo.content}`
    : ''

  useEffect(() => {
    prevInProgressKeyRef.current = ''
    if (todosContainerRef.current) {
      todosContainerRef.current.scrollTop = 0
    }
  }, [streamKey])

  // 当正在执行的任务变化时，滚动到该任务使其可见
  useEffect(() => {
    if (inProgressIndex === -1 || !inProgressKey || inProgressKey === prevInProgressKeyRef.current) return

    const container = todosContainerRef.current
    if (!container) return

    // 找到正在执行的任务元素
    const todoElements = container.querySelectorAll('[data-todo-index]')
    const targetElement = todoElements[inProgressIndex] as HTMLElement

    if (targetElement) {
      const containerRect = container.getBoundingClientRect()
      const elementRect = targetElement.getBoundingClientRect()
      const padding = 4
      let nextScrollTop = container.scrollTop

      if (elementRect.top < containerRect.top) {
        nextScrollTop += elementRect.top - containerRect.top - padding
      } else if (elementRect.bottom > containerRect.bottom) {
        nextScrollTop += elementRect.bottom - containerRect.bottom + padding
      }

      if (nextScrollTop !== container.scrollTop) {
        container.scrollTo({
          top: Math.max(0, nextScrollTop),
          behavior: 'smooth'
        })
      }
      prevInProgressKeyRef.current = inProgressKey
    }
  }, [inProgressIndex, inProgressKey])

  // 过滤掉 todo 工具事件（单独显示在底部）
  const displayEvents = events.filter(e => !(e.type === 'tool_call' && e.toolCall?.name && ['write_todos', 'TodoWrite'].includes(e.toolCall.name)))

  // 计算所有内容的字符串（用于追踪变化，包括 tool_call 事件）
  // tool_call 事件没有 content，但有 toolCall 数据，需要纳入计算以触发滚动
  const totalContent = displayEvents.map(e => {
    if (e.type === 'tool_call' && e.toolCall) {
      // 使用 toolCall 的 id + status 作为变化标识
      return `${e.id}:${e.toolCall.status}`
    }
    return e.content || ''
  }).join('|') + `|todos:${todos.length}:${todos.map(t => t.status).join(',')}`

  // 监听用户滚动
  useEffect(() => {
    const container = internalScrollRef.current
    if (!container) return

    const handleScroll = () => {
      // 忽略程序自动滚动触发的事件，避免流式内容增长时被误判为离开底部
      if (autoScrollingRef.current) {
        autoScrollingRef.current = false
        return
      }
      const { scrollTop, scrollHeight, clientHeight } = container
      const atBottom = scrollTop + clientHeight >= scrollHeight - scrollThreshold
      setAtBottom(atBottom)
      // 用户滚动到底部时，隐藏新消息提示
      if (atBottom) {
        setShowNewMessageHint(false)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // 监听滚动区域内容高度变化（折叠/展开会改变 scrollHeight 但不触发 scroll 事件）。
  // 当内容收起、底部重新可见时，同步 isAtBottom 并清除新消息提示。
  useEffect(() => {
    const container = internalScrollRef.current
    const content = scrollContentRef.current
    if (!container || !content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      // 贴底意图存在时（前面内容变长/折叠展开等导致高度变化），持续保持贴底，
      // 不让"有新内容"提示在用户其实已在底部时误弹出
      if (isAtBottomRef.current) {
        stickToBottom(container)
        setShowNewMessageHint(false)
        return
      }
      const { scrollTop, scrollHeight, clientHeight } = container
      const atBottom = scrollTop + clientHeight >= scrollHeight - scrollThreshold
      if (atBottom) {
        setAtBottom(true)
        setShowNewMessageHint(false)
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  // 内容变化时的处理
  useEffect(() => {
    if (totalContent === prevTotalContentRef.current) return
    prevTotalContentRef.current = totalContent
    setTimeout(() => {
      const c = internalScrollRef.current
      if (!c) return
      // 读取 ref 拿到最新贴底意图，避免闭包里的 isAtBottom 为旧值
      if (isAtBottomRef.current) {
        // 用户在底部，自动滚动
        stickToBottom(c)
      } else {
        // 用户不在底部，显示新消息提示
        setShowNewMessageHint(true)
      }
    }, 0)
  }, [totalContent])

  return (
    <div className="flex flex-col h-full relative">
      {/* 固定区域：状态栏 + 任务清单 */}
      <div className="shrink-0 px-3 pt-3">
        {streamingViewAgent && completedAgents.has(completedKey) ? (
          <div className="flex items-center gap-2 text-xs text-green-500 mb-3">
            <Bot className="size-3" />
            <span>已完成</span>
          </div>
        ) : (
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-xs text-primary">
              <TotalTimeIndicator events={events} isRunning={Boolean(isExecuting)} startTime={messageStartTime} />
              <ProcessingIndicator label={t('common.processing')} />
            </div>
            {isExecuting && onStop && chatRoomId && (
              <button
                onClick={() => onStop(streamingViewAgent!.agentId, streamingViewAgent!.messageId)}
                className="flex items-center gap-1.5 rounded-lg bg-red-500 px-2.5 py-1.5 text-xs text-white hover:bg-red-600 transition-colors"
                title={t('chat.stopExecution')}
              >
                <Square className="size-3" />
                <span>{t('common.stop')}</span>
              </button>
            )}
          </div>
        )}

        {/* 任务清单 */}
        {todos.length > 0 && (
          <div className="mb-3 rounded-lg border bg-muted/30 text-xs">
            <div className="flex items-center gap-2 p-2 border-b bg-muted/50 rounded-t-lg">
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                📋 {t('chat.taskChecklist')}
              </span>
              <span className="text-muted-foreground">
                {t('chat.tasksCompleted', {completed: todos.filter(t => t.status === 'completed').length, total: todos.length})}
              </span>
              {todosStatus === 'completed' && todos.every(t => t.status === 'completed') && (
                <CheckCircle className="size-3 text-green-500" />
              )}
            </div>
            <OverlayScrollArea className="max-h-24" viewportClassName="max-h-24 pr-2" viewportRef={todosContainerRef}>
              <div className="space-y-1 p-2">
                {todos.map((todo, idx) => {
                  const { icon, color, label } = getTodoStatusIcon(todo.status, t)
                  return (
                    <div key={idx} data-todo-index={idx} className={cn('flex items-center gap-2 py-0.5', color)}>
                      <span className="w-5 shrink-0 text-right text-xs font-medium tabular-nums opacity-70">
                        {idx + 1}.
                      </span>
                      {icon}
                      <span className="flex-1 min-w-0 w-0 text-sm truncate">{todo.content}</span>
                      <span className="text-xs opacity-60 shrink-0">{label}</span>
                    </div>
                  )
                })}
              </div>
            </OverlayScrollArea>
          </div>
        )}
      </div>

      {/* 滚动区域：事件流 */}
      <OverlayScrollArea className="min-h-0 flex-1" scrollbarClassName="right-3" viewportRef={internalScrollRef}>
        <div ref={scrollContentRef} className="rounded-lg text-sm text-foreground pt-3 pb-3 pl-3 pr-3 space-y-3">
        {(() => {
          if (!streamingViewAgent) return t('chat.noContent')

          // 如果没有任何内容，显示等待状态
          if (displayEvents.length === 0 && todos.length === 0) {
            return (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <span>{t('chat.executing')}</span>
              </div>
            )
          }

          return displayEvents.map((event) => (
            <StreamEventItem key={event.id} event={event} t={t} />
          ))
        })()}
        </div>
      </OverlayScrollArea>

      {/* 新消息提示 */}
      {showNewMessageHint && (
        <button
          onClick={() => {
            scrollToBottom()
            setShowNewMessageHint(false)
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-1.5 text-sm text-white shadow-lg hover:bg-blue-600 transition-colors"
        >
          <span className="animate-bounce">↓</span>
          <span>{t('chat.newContent')}</span>
        </button>
      )}
    </div>
  )
}
