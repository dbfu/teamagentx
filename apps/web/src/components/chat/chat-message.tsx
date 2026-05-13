import { Message } from '@/lib/agent-api'
import { tokenUsageApi } from '@/lib/token-usage-api'
import { cn, formatDateTime } from '@/lib/utils'
import { copyToClipboard } from '@/lib/copy-utils'
import { Bot, MessageSquareMore, Info, Copy, XCircle, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { remarkMentions, MENTION_MARKER_CLASS } from '@/lib/remark-mentions'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { ImageViewerModal } from './image-viewer-modal'
import type { StreamEvent } from '@/stores/socket-store'
import { AgentAvatar } from './agent-avatar'
import { UserAvatar } from './user-avatar'
import { useIsMobile } from '@/hooks/use-mobile'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// 格式化耗时显示（1m40s 格式，分钟为0时只显示秒）
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m${seconds}s`
}

interface TypingAgent {
  agentId: string
  agentName: string
  status?: 'pending' | 'executing' | 'cancelled'  // 新增状态字段
}

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

type CurrentUser = {
  username: string
  avatar?: string | null
} | null

interface ChatMessageProps {
  message: Message
  isRight?: boolean
  replyTo?: Message | null
  replyCount?: number
  typingAgents?: TypingAgent[]
  mentionAgents?: MentionAgent[]
  currentUser?: CurrentUser
  streamEvents?: Map<string, StreamEvent[]>
  onAgentAvatarClick?: (agentId: string, agentName: string) => void
  onTypingAgentClick?: (messageId: string, agentId: string, agentName: string) => void
  onMentionClick?: (agentId: string, agentName: string) => void
  onReplyClick?: (messageId: string) => void
  onExecutionDetailClick?: (messageId: string, executionRecordId: string) => void
  onMentionAgent?: (agentId: string, agentName: string) => void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
}

export function ChatMessage({ message, isRight, replyTo, replyCount, typingAgents, mentionAgents, currentUser, onAgentAvatarClick, onTypingAgentClick, onMentionClick, onReplyClick, onExecutionDetailClick, onMentionAgent, onDeleteMessage }: ChatMessageProps) {
  const isMobile = useIsMobile()
  const senderName = message.isHuman
    ? (message.user?.username ?? '用户')
    : (message.agent?.name ?? '助手')
  // 右键菜单状态
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // 助手名称 hover 状态
  const [isNameHovered, setIsNameHovered] = useState(false)

  // 图片查看器状态
  const [viewerImage, setViewerImage] = useState<{ url: string; name: string } | null>(null)

  // 处理右键菜单（桌面端）
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    e.preventDefault()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [isMobile])

  // 处理长按开始（移动端）
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const touch = e.touches[0]
    const timer = setTimeout(() => {
      setContextMenuPos({ x: touch.clientX, y: touch.clientY })
      setShowContextMenu(true)
    }, 500) // 500ms 长按触发
    setLongPressTimer(timer)
  }, [isMobile])

  // 处理长按结束
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  // 复制消息内容
  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(message.content)
    if (success) {
      toast.success('已复制到剪贴板')
    } else {
      toast.error('复制失败')
    }
    setShowContextMenu(false)
  }, [message.content])

  // 回复助手消息：等同于在输入框 @ 该助手，不创建回复关系
  const handleReplyToAgent = useCallback(() => {
    if (!message.isHuman && message.agentId && message.agent?.name) {
      onMentionAgent?.(message.agentId, message.agent.name)
    }
    setShowContextMenu(false)
  }, [message.isHuman, message.agentId, message.agent?.name, onMentionAgent])

  // 删除消息
  const handleDelete = useCallback(async () => {
    if (!onDeleteMessage) return
    setDeleting(true)
    try {
      await onDeleteMessage(message.id)
      toast.success('消息已删除')
      setDeleteDialogOpen(false)
    } catch (error) {
      console.error('Failed to delete message:', error)
      toast.error('删除失败')
    } finally {
      setDeleting(false)
    }
  }, [message.id, onDeleteMessage])

  const openDeleteDialog = useCallback(() => {
    setShowContextMenu(false)
    setDeleteDialogOpen(true)
  }, [])

  // 点击其他地方关闭菜单
  const handleClickOutside = useCallback(() => {
    setShowContextMenu(false)
  }, [])

  // 处理助手头像点击
  const handleAvatarClick = () => {
    if (!message.isHuman && message.agentId && message.agent?.name) {
      onAgentAvatarClick?.(message.agentId, message.agent.name)
    }
  }

  // 处理助手名称点击（自动 @）
  const handleNameClick = () => {
    if (!message.isHuman && message.agentId && message.agent?.name) {
      onMentionAgent?.(message.agentId, message.agent.name)
    }
  }

  const renderContent = (content: string) => {
    // 用户消息：普通文本展示，但 @助手 需要高亮
    if (message.isHuman) {
      // 如果没有 mentionAgents，直接显示纯文本
      if (!mentionAgents || mentionAgents.length === 0) {
        return <span className="whitespace-pre-wrap break-words">{content}</span>
      }

      // 处理 @mentions，将 @助手名 替换为高亮元素
      // 按名称长度降序排序，避免短名称匹配到长名称的一部分
      const sortedAgents = [...mentionAgents].sort((a, b) => b.name.length - a.name.length)
      const mentionPattern = /@([^\s@]+)/g
      const parts: React.ReactNode[] = []
      let lastIndex = 0
      let match

      while ((match = mentionPattern.exec(content)) !== null) {
        const mentionName = match[1]
        // 查找匹配的助手
        const matchedAgent = sortedAgents.find(agent => agent.name === mentionName)

        // 添加 @ 之前的文本
        if (match.index > lastIndex) {
          parts.push(content.slice(lastIndex, match.index))
        }

        if (matchedAgent) {
          // 渲染高亮的 @助手名
          parts.push(
            <span
              key={`mention-${match.index}`}
              className="text-primary cursor-pointer hover:text-primary/80 whitespace-nowrap"
              onClick={() => onMentionClick?.(matchedAgent.id, matchedAgent.name)}
              title={`点击查看 ${matchedAgent.name} 详情`}
            >
              @{mentionName}
            </span>
          )
        } else {
          // 不是有效的 @助手名，保持原样
          parts.push(`@${mentionName}`)
        }

        lastIndex = match.index + match[0].length
      }

      // 添加剩余的文本
      if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex))
      }

      return <span className="whitespace-pre-wrap break-words">{parts.length > 0 ? parts : content}</span>
    }

    // 助手消息：使用 markdown 渲染
    // 如果没有 mentionAgents，直接渲染 markdown（不处理 @mentions）
    if (!mentionAgents || mentionAgents.length === 0) {
      return (
        <div className="prose prose-sm break-words [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap [&_img]:max-w-[120px] [&_img]:max-h-[120px] [&_img]:rounded-lg [&_img]:object-cover [&_img]:cursor-pointer">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              img: ({ src, alt }) => (
                <img
                  src={src}
                  alt={alt || '图片'}
                  className="max-w-[120px] max-h-[120px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => src && setViewerImage({ url: src, name: alt || '图片' })}
                />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )
    }

    // 使用 remarkMentions 插件处理 @mentions，将有效的 @助手名 转换为 HTML span
    // 使用 rehypeRaw 来处理这些 HTML 节点
    // 在自定义 span 组件中识别我们的标记 class 并渲染为高亮元素
    return (
      <div className="prose prose-sm break-words [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap [&_img]:max-w-[120px] [&_img]:max-h-[120px] [&_img]:rounded-lg [&_img]:object-cover [&_img]:cursor-pointer">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMentions, { mentionAgents }]]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            img: ({ src, alt }) => (
              <img
                src={src}
                alt={alt || '图片'}
                className="max-w-[120px] max-h-[120px] rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => src && setViewerImage({ url: src, name: alt || '图片' })}
              />
            ),
            span: ({ className, children, ...props }) => {
              // 只处理带有我们唯一标记 class 的 span（由我们的 remark 插件插入）
              // 其他 span（包括助手消息中可能包含的其他 HTML span）保持原样
              if (className === MENTION_MARKER_CLASS) {
                // 从 props 中获取 agent 信息
                // rehype-raw 将 data-* 属性转换为 camelCase
                const agentId = (props as any).agentId || (props as any)['data-agent-id']
                const agentName = (props as any).agentName || (props as any)['data-agent-name']

                if (agentId && agentName) {
                  return (
                    <span
                      className="text-primary cursor-pointer hover:text-primary/80 whitespace-nowrap"
                      onClick={() => onMentionClick?.(agentId, agentName)}
                      title={`点击查看 ${agentName} 详情`}
                    >
                      {children}
                    </span>
                  )
                }
              }
              // 其他 span 保持原样渲染（显示为纯文本）
              return <span className={className} {...props}>{children}</span>
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  // 回复消息预览（飞书风格）
  const renderReplyPreview = () => {
    if (!replyTo) return null
    const replySenderName = replyTo.isHuman
      ? (replyTo.user?.username ?? '用户')
      : (replyTo.agent?.name ?? '助手')

    return (
      <div className="w-full select-text mb-1.5 flex items-center gap-2 rounded bg-primary/5 text-xs text-muted-foreground overflow-hidden">
        <div className="ml-2 h-3 w-0.5 shrink-0 self-center bg-primary/30" />
        <div className="w-0 flex-1 truncate py-1 pr-2">
          回复 {replySenderName}：<span className="ml-1">{replyTo.content}</span>
        </div>
      </div>
    )
  }

  // 回复数量显示
  const renderReplyCount = () => {
    if (!replyCount || replyCount === 0) return null
    return (
      <div
        className="mt-1 flex items-center gap-1 text-xs text-primary cursor-pointer hover:text-primary/80"
        onClick={() => onReplyClick?.(message.id)}
      >
        <MessageSquareMore className="size-3" />
        {replyCount} 条回复
      </div>
    )
  }

  // 渲染附件图片
  const renderAttachments = () => {
    if (!message.attachments || message.attachments.length === 0) return null

    return (
      <div className="flex flex-wrap gap-2 mt-1 mb-1">
        {message.attachments.map((attachment) => (
          <div key={attachment.id} className="relative">
            <img
              src={attachment.url}
              alt={attachment.filename}
              className="max-w-[120px] max-h-[120px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity object-cover"
              onClick={() => setViewerImage({ url: attachment.url, name: attachment.filename })}
              loading="lazy"
            />
          </div>
        ))}
      </div>
    )
  }

  // 正在处理的机器人标签
  const renderTypingAgents = () => {
    if (!typingAgents || typingAgents.length === 0) return null

    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {typingAgents.map((agent) => {
          // 新增：取消状态
          if (agent.status === 'cancelled') {
            return (
              <div
                key={agent.agentId}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                <XCircle className="size-3" />
                <span>{agent.agentName} 已停止</span>
              </div>
            )
          }

          return (
            <div
              key={agent.agentId}
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10"
              onClick={() => onTypingAgentClick?.(message.id, agent.agentId, agent.agentName)}
            >
              <span className="flex items-center h-5 justify-center font-bold leading-none">
                <span className="animate-[dot-appear_1.5s_infinite] -translate-y-0.5">.</span>
                <span className="animate-[dot-appear_1.5s_0.3s_infinite] -translate-y-0.5">.</span>
                <span className="animate-[dot-appear_1.5s_0.6s_infinite] -translate-y-0.5">.</span>
              </span>
              <span>{agent.agentName} 执行中</span>
            </div>
          )
        })}
      </div>
    )
  }

  // 执行详情按钮（仅助手消息显示）
  const renderExecutionDetailButton = () => {
    if (message.isHuman || !message.executionRecordId) return null

    return (
      <>
        <button
          onClick={() => onExecutionDetailClick?.(message.id, message.executionRecordId!)}
          className="inline-flex items-center gap-1 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-xs text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors"
          title="查看执行详情"
        >
          <Info className="size-3" />
          <span>查看执行详情</span>
        </button>
        {message.executionDuration && (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            耗时：{formatDuration(message.executionDuration)}
          </span>
        )}
        {message.totalTokens && (
          <span className="inline-flex items-center rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400">
            Token：{tokenUsageApi.formatTokens(Math.max(0, message.totalTokens - (message.cacheReadTokens ?? 0)))}
          </span>
        )}
      </>
    )
  }

  // 右键/长按菜单
  const renderContextMenu = () => {
    if (!showContextMenu) return null

    return (
      <div
        className="fixed z-50 min-w-[120px] rounded-lg bg-popover py-1 shadow-lg border border-border"
        style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleCopy}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
        >
          <Copy className="size-4" />
          复制内容
        </button>
        {!message.isHuman && message.agentId && message.agent?.name && (
          <button
            onClick={handleReplyToAgent}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
          >
            <MessageSquareMore className="size-4" />
            回复
          </button>
        )}
        {onDeleteMessage && (
          <button
            onClick={openDeleteDialog}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            <Trash2 className="size-4" />
            删除消息
          </button>
        )}
      </div>
    )
  }

  if (isRight) {
    return (
      <>
        {showContextMenu && (
          <div className="fixed inset-0 z-40" onClick={handleClickOutside} />
        )}
        {renderContextMenu()}
        <div className={cn("flex justify-end py-2", isMobile ? "px-2" : "px-6")}>
          <div className="flex flex-row-reverse items-start gap-3 w-0 min-w-0 flex-1 max-w-full">
            <UserAvatar avatar={currentUser?.avatar} size="md" />
            <div className="min-w-0 flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground translate-y-px">{formatDateTime(message.createdAt)}</span>
                <span className="font-medium text-foreground text-sm">{senderName}</span>
              </div>
              {renderReplyPreview()}
              <div
                className={cn(
                  "rounded-lg bg-primary/15 px-4 py-2 text-foreground overflow-x-auto cursor-text border border-primary/20 dark:bg-primary/20 dark:border-primary/30 w-fit max-w-full",
                  isMobile ? "select-none" : "select-text"
                )}
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {renderAttachments()}
                {renderContent(message.content)}
              </div>
              <div className="flex items-center gap-2">
                {renderTypingAgents()}
                {renderReplyCount()}
              </div>
            </div>
          </div>
        </div>

        {/* 图片查看器 */}
        <ImageViewerModal
          isOpen={viewerImage !== null}
          imageUrl={viewerImage?.url || ''}
          imageName={viewerImage?.name || 'image'}
          onClose={() => setViewerImage(null)}
        />
        {onDeleteMessage && (
          <ConfirmDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title="删除消息"
            description="确定要删除这条消息吗？此操作无法撤销。"
            confirmText="删除"
            onConfirm={handleDelete}
            loading={deleting}
            icon={Trash2}
          />
        )}
      </>
    )
  }

  return (
    <>
      {showContextMenu && (
        <div className="fixed inset-0 z-40" onClick={handleClickOutside} />
      )}
      {renderContextMenu()}
      <div className={cn("py-2", isMobile ? "px-2" : "px-6")}>
        <div className="flex items-start gap-3">
          {message.isHuman ? (
            <UserAvatar avatar={message.user?.avatar ?? currentUser?.avatar} size="md" />
          ) : (
            <div className="shrink-0 cursor-pointer" onClick={handleAvatarClick}>
              <AgentAvatar
                avatar={message.avatar ?? message.agent?.avatar ?? null}
                avatarColor={message.avatarColor ?? message.agent?.avatarColor}
                size="md"
                showSystemBadge={false}
              />
            </div>
          )}
          <div className="w-0 min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-medium text-foreground",
                  !message.isHuman && "cursor-pointer group"
                )}
                onMouseEnter={() => !message.isHuman && setIsNameHovered(true)}
                onMouseLeave={() => !message.isHuman && setIsNameHovered(false)}
                onClick={handleNameClick}
              >
                {!message.isHuman && (
                  <span className={cn(
                    "text-xs text-primary -ml-3 mr-px transition-opacity",
                    isNameHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}>
                    @
                  </span>
                )}
                {senderName}
              </span>
              {!message.isHuman && (
                <Bot className="size-4 text-primary" />
              )}
              <span className="text-xs text-muted-foreground">{formatDateTime(message.createdAt)}</span>
            </div>
            {renderReplyPreview()}
            <div
              className={cn(
                "rounded-lg bg-muted/50 px-4 py-3 text-foreground overflow-x-auto cursor-text border border-border/50 dark:bg-muted/40 dark:border-border max-w-full",
                isMobile ? "select-none" : "select-text"
              )}
              onContextMenu={handleContextMenu}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {renderAttachments()}
              {renderContent(message.content)}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {renderTypingAgents()}
              {renderReplyCount()}
              {renderExecutionDetailButton()}
            </div>
          </div>
        </div>
      </div>

      {/* 图片查看器 */}
      <ImageViewerModal
        isOpen={viewerImage !== null}
        imageUrl={viewerImage?.url || ''}
        imageName={viewerImage?.name || 'image'}
        onClose={() => setViewerImage(null)}
      />
      {onDeleteMessage && (
        <ConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="删除消息"
          description="确定要删除这条消息吗？此操作无法撤销。"
          confirmText="删除"
          onConfirm={handleDelete}
          loading={deleting}
          icon={Trash2}
        />
      )}
    </>
  )
}
