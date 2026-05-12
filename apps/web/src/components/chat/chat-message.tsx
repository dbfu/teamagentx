import { Message } from '@/lib/agent-api'
import { tokenUsageApi } from '@/lib/token-usage-api'
import { cn, formatDateTime, agentBorder, agentText } from '@/lib/utils'
import { copyToClipboard } from '@/lib/copy-utils'
import { Bot, MessageSquareMore, Info, Copy, XCircle } from 'lucide-react'
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

// 格式化耗时显示
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m${seconds}s`
}

interface TypingAgent {
  agentId: string
  agentName: string
  status?: 'pending' | 'executing' | 'cancelled'
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
}

export function ChatMessage({ message, isRight, replyTo, replyCount, typingAgents, mentionAgents, currentUser, onAgentAvatarClick, onTypingAgentClick, onMentionClick, onReplyClick, onExecutionDetailClick, onMentionAgent }: ChatMessageProps) {
  const isMobile = useIsMobile()
  const senderName = message.isHuman
    ? (message.user?.username ?? '用户')
    : (message.agent?.name ?? '助手')

  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [isNameHovered, setIsNameHovered] = useState(false)
  const [viewerImage, setViewerImage] = useState<{ url: string; name: string } | null>(null)

  // Agent color for this message
  const borderColor = message.isHuman ? 'var(--primary)' : agentBorder(senderName)
  const textColor = message.isHuman ? 'var(--primary)' : agentText(senderName)
  const mentionClassName = message.isHuman
    ? 'inline-flex items-center rounded bg-white/15 px-1.5 py-0.5 font-semibold text-white transition-colors hover:bg-white/25'
    : 'inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary transition-colors hover:bg-primary/15 hover:text-primary/90'
  const markdownClassName = cn(
    'prose prose-sm max-w-none break-words leading-7 [&_a]:underline [&_a]:underline-offset-2 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-black/5 [&_pre]:bg-black/5 [&_pre]:px-3 [&_pre]:py-2.5 [&_code]:whitespace-pre-wrap [&_img]:max-w-[120px] [&_img]:max-h-[120px] [&_img]:rounded-xl [&_img]:object-cover [&_img]:cursor-pointer',
    message.isHuman && 'text-white prose-headings:text-white prose-p:text-white prose-strong:text-white prose-code:text-white prose-pre:text-white [&_pre]:border-white/10 [&_pre]:bg-black/15',
  )

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (isMobile) return
    e.preventDefault()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
    setShowContextMenu(true)
  }, [isMobile])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return
    const touch = e.touches[0]
    const timer = setTimeout(() => {
      setContextMenuPos({ x: touch.clientX, y: touch.clientY })
      setShowContextMenu(true)
    }, 500)
    setLongPressTimer(timer)
  }, [isMobile])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      setLongPressTimer(null)
    }
  }, [longPressTimer])

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(message.content)
    if (success) toast.success('已复制到剪贴板')
    else toast.error('复制失败')
    setShowContextMenu(false)
  }, [message.content])

  const handleReplyToAgent = useCallback(() => {
    if (!message.isHuman && message.agentId && message.agent?.name) {
      onMentionAgent?.(message.agentId, message.agent.name)
    }
    setShowContextMenu(false)
  }, [message.isHuman, message.agentId, message.agent?.name, onMentionAgent])

  const handleClickOutside = useCallback(() => setShowContextMenu(false), [])

  const handleAvatarClick = () => {
    if (!message.isHuman && message.agentId && message.agent?.name) {
      onAgentAvatarClick?.(message.agentId, message.agent.name)
    }
  }

  const handleNameClick = () => {
    if (!message.isHuman && message.agentId && message.agent?.name) {
      onMentionAgent?.(message.agentId, message.agent.name)
    }
  }

  const renderContent = (content: string) => {
    if (message.isHuman) {
      if (!mentionAgents || mentionAgents.length === 0) {
        return <span className="whitespace-pre-wrap break-words">{content}</span>
      }
      const sortedAgents = [...mentionAgents].sort((a, b) => b.name.length - a.name.length)
      const mentionPattern = /@([^\s@]+)/g
      const parts: React.ReactNode[] = []
      let lastIndex = 0
      let match
      while ((match = mentionPattern.exec(content)) !== null) {
        const mentionName = match[1]
        const matchedAgent = sortedAgents.find(agent => agent.name === mentionName)
        if (match.index > lastIndex) parts.push(content.slice(lastIndex, match.index))
        if (matchedAgent) {
          parts.push(
            <span key={`mention-${match.index}`} className={cn(mentionClassName, 'cursor-pointer whitespace-nowrap')} onClick={() => onMentionClick?.(matchedAgent.id, matchedAgent.name)}>
              @{mentionName}
            </span>
          )
        } else {
          parts.push(`@${mentionName}`)
        }
        lastIndex = match.index + match[0].length
      }
      if (lastIndex < content.length) parts.push(content.slice(lastIndex))
      return <span className="whitespace-pre-wrap break-words">{parts.length > 0 ? parts : content}</span>
    }

    if (!mentionAgents || mentionAgents.length === 0) {
        return (
        <div className={markdownClassName}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
            {content}
          </ReactMarkdown>
        </div>
      )
    }

    return (
      <div className={markdownClassName}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, [remarkMentions, { mentionAgents }]]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
            span: ({ className, children, ...props }) => {
              if (className === MENTION_MARKER_CLASS) {
                const agentId = (props as any).agentId || (props as any)['data-agent-id']
                const agentName = (props as any).agentName || (props as any)['data-agent-name']
                if (agentId && agentName) {
                  return <span className={cn(mentionClassName, 'cursor-pointer whitespace-nowrap')} onClick={() => onMentionClick?.(agentId, agentName)}>{children}</span>
                }
              }
              return <span className={className} {...props}>{children}</span>
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    )
  }

  const renderReplyPreview = () => {
    if (!replyTo) return null
    const replySenderName = replyTo.isHuman ? (replyTo.user?.username ?? '用户') : (replyTo.agent?.name ?? '助手')
    return (
      <div className="w-full select-text mb-1 flex items-center gap-2 rounded bg-primary/5 text-xs text-muted-foreground overflow-hidden">
        <div className="ml-2 h-3 w-0.5 shrink-0 self-center bg-primary/30" />
        <div className="w-0 flex-1 truncate py-1 pr-2">回复 {replySenderName}：<span className="ml-1">{replyTo.content}</span></div>
      </div>
    )
  }

  const renderReplyCount = () => {
    if (!replyCount || replyCount === 0) return null
    return (
      <div className="mt-1 flex items-center gap-1 text-xs text-primary cursor-pointer hover:text-primary/80" onClick={() => onReplyClick?.(message.id)}>
        <MessageSquareMore className="size-3" />{replyCount} 条回复
      </div>
    )
  }

  const renderAttachments = () => {
    if (!message.attachments || message.attachments.length === 0) return null
    return (
      <div className="flex flex-wrap gap-2 mt-1 mb-1">
        {message.attachments.map((attachment) => (
          <div key={attachment.id} className="relative">
            <img src={attachment.url} alt={attachment.filename} className="max-w-[120px] max-h-[120px] rounded-lg cursor-pointer hover:opacity-90 transition-opacity object-cover" onClick={() => setViewerImage({ url: attachment.url, name: attachment.filename })} loading="lazy" />
          </div>
        ))}
      </div>
    )
  }

  const renderTypingAgents = () => {
    if (!typingAgents || typingAgents.length === 0) return null
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {typingAgents.map((agent) => {
          if (agent.status === 'cancelled') {
            return (
              <div key={agent.agentId} className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                <XCircle className="size-3" /><span>{agent.agentName} 已停止</span>
              </div>
            )
          }
          return (
            <div key={agent.agentId} className="inline-flex cursor-pointer items-center gap-1 rounded bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10" onClick={() => onTypingAgentClick?.(message.id, agent.agentId, agent.agentName)}>
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

  const renderExecutionDetailButton = () => {
    if (message.isHuman || !message.executionRecordId) return null
    return (
      <>
        <button onClick={() => onExecutionDetailClick?.(message.id, message.executionRecordId!)} className="inline-flex items-center gap-1 rounded-sm bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-[11px] text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors">
          <Info className="size-3" />查看执行详情
        </button>
        {message.executionDuration && (
          <span className="inline-flex items-center rounded-sm bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            耗时：{formatDuration(message.executionDuration)}
          </span>
        )}
        {message.totalTokens && (
          <span className="inline-flex items-center rounded-sm bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[11px] text-blue-600 dark:text-blue-400">
            Token：{tokenUsageApi.formatTokens(Math.max(0, message.totalTokens - (message.cacheReadTokens ?? 0)))}
          </span>
        )}
      </>
    )
  }

  const renderContextMenu = () => {
    if (!showContextMenu) return null
    return (
      <div className="fixed z-50 min-w-[120px] overflow-hidden rounded-md border border-border bg-[var(--surface-raised)] py-1 shadow-lg" style={{ left: contextMenuPos.x, top: contextMenuPos.y }} onClick={(e) => e.stopPropagation()}>
        <button onClick={handleCopy} className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors">
          <Copy className="size-3.5" />复制内容
        </button>
        {!message.isHuman && message.agentId && message.agent?.name && (
          <button onClick={handleReplyToAgent} className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-foreground hover:bg-accent transition-colors">
            <MessageSquareMore className="size-3.5" />回复
          </button>
        )}
      </div>
    )
  }

  // === User message (right-aligned, accent bubble) ===
  if (isRight) {
    return (
      <>
        {showContextMenu && <div className="fixed inset-0 z-40" onClick={handleClickOutside} />}
        {renderContextMenu()}
        <div className={cn("msg-card-animate flex justify-end py-2", isMobile ? "px-2" : "px-4")}>
          <div className="max-w-[min(34rem,72vw)] flex flex-col items-end">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[11px] text-muted-foreground/60">{formatDateTime(message.createdAt)}</span>
              <span className="text-xs font-bold text-foreground">{senderName}</span>
            </div>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex flex-col items-end gap-1">
                <div
                  className={cn("overflow-x-auto rounded-md px-3 py-2 text-sm leading-relaxed text-white shadow-sm cursor-text", isMobile ? "select-none" : "select-text")}
                  style={{ background: 'var(--primary)' }}
                  onContextMenu={handleContextMenu} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
                >
                  {renderReplyPreview()}
                  {renderAttachments()}
                  {renderContent(message.content)}
                </div>
                <div className="flex items-center gap-2">
                  {renderTypingAgents()}
                  {renderReplyCount()}
                </div>
              </div>
              <UserAvatar avatar={currentUser?.avatar} size="sm" />
            </div>
          </div>
        </div>
        <ImageViewerModal isOpen={viewerImage !== null} imageUrl={viewerImage?.url || ''} imageName={viewerImage?.name || 'image'} onClose={() => setViewerImage(null)} />
      </>
    )
  }

  // === Agent/Left message (card with colored left border) ===
  return (
    <>
      {showContextMenu && <div className="fixed inset-0 z-40" onClick={handleClickOutside} />}
      {renderContextMenu()}
      <div className={cn("msg-card-animate flex items-start gap-2.5 py-2", isMobile ? "px-2" : "px-4")}>
        {message.isHuman ? (
          <UserAvatar avatar={message.user?.avatar ?? currentUser?.avatar} size="sm" />
        ) : (
          <div className="shrink-0 cursor-pointer mt-0.5" onClick={handleAvatarClick}>
            <AgentAvatar avatar={message.avatar ?? message.agent?.avatar ?? null} avatarColor={message.avatarColor ?? message.agent?.avatarColor} size="sm" showSystemBadge={false} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 mb-1">
            <span
              className={cn("text-xs font-bold", !message.isHuman && "cursor-pointer group")}
              style={{ color: textColor }}
              onMouseEnter={() => !message.isHuman && setIsNameHovered(true)}
              onMouseLeave={() => !message.isHuman && setIsNameHovered(false)}
              onClick={handleNameClick}
            >
              {!message.isHuman && (
                <span className={cn("text-primary -ml-3 mr-px transition-opacity text-xs", isNameHovered ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>@</span>
              )}
              {senderName}
            </span>
            {!message.isHuman && <Bot className="size-3 text-primary" />}
            <span className="text-[11px] text-muted-foreground/60">{formatDateTime(message.createdAt)}</span>
          </div>
          <div
            className={cn(
              "max-w-[min(38rem,78vw)] overflow-x-auto rounded-md border border-border/80 bg-[var(--surface-raised)] px-3 py-2.5 text-sm leading-relaxed shadow-[var(--control-shadow)] cursor-text",
              isMobile ? "select-none" : "select-text"
            )}
            style={{ borderLeft: `3px solid ${borderColor}` }}
            onContextMenu={handleContextMenu} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}
          >
            {renderReplyPreview()}
            {renderAttachments()}
            {renderContent(message.content)}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {renderTypingAgents()}
            {renderReplyCount()}
            {renderExecutionDetailButton()}
          </div>
        </div>
      </div>
      <ImageViewerModal isOpen={viewerImage !== null} imageUrl={viewerImage?.url || ''} imageName={viewerImage?.name || 'image'} onClose={() => setViewerImage(null)} />
    </>
  )
}
