import { Message } from '@/lib/agent-api'
import { tokenUsageApi } from '@/lib/token-usage-api'
import { cn, formatDateTime } from '@/lib/utils'
import { copyToClipboard } from '@/lib/copy-utils'
import { Bot, CheckSquare, MessageSquareMore, Info, Copy, XCircle, Trash2, Volume2, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { memo, useEffect, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { ImageViewerModal } from './image-viewer-modal'
import { AudioMessagePlayer } from './audio-message-player'
import { AgentAvatar } from './agent-avatar'
import { UserAvatar } from './user-avatar'
import { useIsMobile } from '@/hooks/use-mobile'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useChatStore, VOICE_MESSAGE_PLACEHOLDER } from '@/stores/chat-store'
import { toVoicePanelConfig } from '@/lib/agent-speech'
import { normalizeSpeechText, prewarmTts, speakText, stopSpeechPlayback, supportsSpeechPlayback } from '@/lib/browser-speech'
import { resolveAssetUrl } from '@/lib/asset-url'
import { MarkdownContent } from './markdown-content'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'

function logManualVoice(event: string, details: Record<string, unknown>): void {
  console.debug(`[voice-manual] ${event}`, details)
  void window.electronAPI?.appendDebugLog?.(`[voice-manual] ${event}`, details)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m${seconds}s`
}

function getAttachmentType(attachment: NonNullable<Message['attachments']>[number]): 'image' | 'audio' | 'file' {
  if (attachment.type) return attachment.type
  if (attachment.mimeType.startsWith('audio/')) return 'audio'
  if (attachment.mimeType.startsWith('image/')) return 'image'
  return 'file'
}

interface TypingAgent {
  agentId: string
  agentName: string
  status?: 'pending' | 'executing' | 'cancelled'  // 新增状态字段
  startedAt?: number
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

const LARGE_MESSAGE_CHAR_THRESHOLD = 1200
const LARGE_MESSAGE_LINE_THRESHOLD = 18
const COLLAPSED_PREVIEW_CHAR_LIMIT = 1200
const COLLAPSED_PREVIEW_LINE_LIMIT = 18

function isLargeMessageContent(content: string): boolean {
  if (content.length > LARGE_MESSAGE_CHAR_THRESHOLD) return true
  return content.split(/\r\n|\r|\n/).length > LARGE_MESSAGE_LINE_THRESHOLD
}

function getCollapsedPreviewContent(content: string): string {
  const limitedByChars = content.length > COLLAPSED_PREVIEW_CHAR_LIMIT
    ? content.slice(0, COLLAPSED_PREVIEW_CHAR_LIMIT)
    : content
  const lines = limitedByChars.split(/\r\n|\r|\n/)
  const limitedByLines = lines.length > COLLAPSED_PREVIEW_LINE_LIMIT
    ? lines.slice(0, COLLAPSED_PREVIEW_LINE_LIMIT).join('\n')
    : limitedByChars
  return limitedByLines.length < content.length ? `${limitedByLines.trimEnd()}\n\n...` : limitedByLines
}

interface ChatMessageProps {
  message: Message
  isVoicePlayed?: boolean
  isRight?: boolean
  replyTo?: Message | null
  replyCount?: number
  showSpeechButton?: boolean
  typingAgents?: TypingAgent[]
  mentionAgents?: MentionAgent[]
  currentUser?: CurrentUser
  onMarkPlayed?: () => void
  onAgentAvatarClick?: (agentId: string, agentName: string) => void
  onTypingAgentClick?: (messageId: string, agentId: string, agentName: string) => void
  onMentionClick?: (agentId: string, agentName: string) => void
  onReplyClick?: (messageId: string) => void
  onExecutionDetailClick?: (messageId: string, executionRecordId: string) => void
  onMentionAgent?: (agentId: string, agentName: string) => void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onStartMultiSelect?: (messageId: string) => void
  onToggleSelection?: (messageId: string) => void
  selectionMode?: boolean
  isSelected?: boolean
  disableContentCollapse?: boolean
  onStopSpeak?: (messageId: string) => void
  onStartManualSpeak?: (messageId: string) => void
  onCompleteManualSpeak?: (messageId: string) => void
}

export const ChatMessage = memo(function ChatMessage({ message, isVoicePlayed = true, isRight, replyTo, replyCount, showSpeechButton = true, typingAgents, mentionAgents, currentUser, onMarkPlayed, onAgentAvatarClick, onTypingAgentClick, onMentionClick, onReplyClick, onExecutionDetailClick, onMentionAgent, onDeleteMessage, onStartMultiSelect, onToggleSelection, selectionMode, isSelected, disableContentCollapse = false, onStopSpeak, onStartManualSpeak, onCompleteManualSpeak }: ChatMessageProps) {
  const isMobile = useIsMobile()
  const allAgents = useChatStore((s) => s.allAgents)
  const isCurrentlyPlaying = useChatStore((s) => s.playingVoiceMessageId === message.id)
  const setPlayingVoiceMessageId = useChatStore((s) => s.setPlayingVoiceMessageId)
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId)
  const senderName = message.isHuman
    ? (message.user?.username ?? '用户')
    : (message.agent?.name ?? '助手')
  const currentAgent = message.agentId ? allAgents.find((agent) => agent.id === message.agentId) : null
  const voiceConfig = useMemo(
    () => (currentAgent?.speechConfig ? toVoicePanelConfig(currentAgent.speechConfig) : null),
    [currentAgent?.speechConfig],
  )
  const normalizedContent = useMemo(
    () => normalizeSpeechText(message.content),
    [message.content],
  )
  const hasAudioAttachment = message.attachments?.some((attachment) => getAttachmentType(attachment) === 'audio') ?? false
  const shouldHideContent = hasAudioAttachment && message.content.trim() === VOICE_MESSAGE_PLACEHOLDER
  // 纯语音消息：只有音频附件、无文字内容，气泡样式退化为透明
  const isAudioOnly = hasAudioAttachment && shouldHideContent && (message.attachments?.every((att) => getAttachmentType(att) === 'audio') ?? false)
  // 右键菜单状态
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [isContentExpanded, setIsContentExpanded] = useState(false)

  // 助手名称 hover 状态
  const [isNameHovered, setIsNameHovered] = useState(false)

  // 图片查看器状态
  const [viewerImage, setViewerImage] = useState<{ url: string; name: string } | null>(null)
  const [durationTick, setDurationTick] = useState(0)
  const durationNow = useMemo(() => Date.now(), [durationTick])
  // isSpeaking = isCurrentlyPlaying（通过 store 统一管理，手动和自动播放图标一致）

  useEffect(() => {
    const hasExecutingAgent = typingAgents?.some((agent) => agent.status !== 'pending' && agent.status !== 'cancelled')
    if (!hasExecutingAgent) return

    const intervalId = window.setInterval(() => {
      setDurationTick((value) => value + 1)
    }, 1000)
    return () => window.clearInterval(intervalId)
  }, [typingAgents])

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

  const handleStartMultiSelect = useCallback(() => {
    setShowContextMenu(false)
    onStartMultiSelect?.(message.id)
  }, [message.id, onStartMultiSelect])

  const handleSelectionClickCapture = useCallback((e: React.MouseEvent) => {
    if (!selectionMode) return
    const target = e.target as HTMLElement
    if (target.closest('button,a,input,textarea')) return

    e.preventDefault()
    e.stopPropagation()
    onToggleSelection?.(message.id)
  }, [message.id, onToggleSelection, selectionMode])

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

  const handleSpeakMessage = useCallback(async () => {
    if (!voiceConfig?.enabled || !message.content.trim()) return

    if (isCurrentlyPlaying) {
      if (onStopSpeak) {
        onStopSpeak(message.id)
        return
      }
      stopSpeechPlayback()
      setPlayingVoiceMessageId(null)
      return
    }

    const speechText = normalizedContent
    if (!speechText) return

    logManualVoice('start', {
      messageId: message.id,
      chatRoomId: message.chatRoomId,
      provider: voiceConfig.provider,
    })
    onStartManualSpeak?.(message.id)
    setPlayingVoiceMessageId(message.id)
    try {
      await speakText({
        text: speechText,
        provider: voiceConfig.provider,
        model: voiceConfig.model,
        voiceId: voiceConfig.voiceId,
        fallbackProvider: voiceConfig.fallbackProvider,
        rate: voiceConfig.speed,
        volume: voiceConfig.volume,
        pitch: voiceConfig.pitch ?? undefined,
        emotion: voiceConfig.emotion,
        style: voiceConfig.style,
        format: voiceConfig.format,
        sampleRate: voiceConfig.sampleRate,
        temperature: voiceConfig.temperature,
        prompt: voiceConfig.prompt,
        agentId: message.agentId ?? undefined,
        chatRoomId: message.chatRoomId,
        messageId: message.id,
        onPlaybackStart: onMarkPlayed,
      })
    } catch (error) {
      // 用户主动停止不显示错误提示
      if (error instanceof Error && (error as Error & { cancelled?: boolean }).cancelled) return
      if (error instanceof Error && error.message === 'speech_interrupted') return
      logManualVoice('error', {
        messageId: message.id,
        chatRoomId: message.chatRoomId,
        error: error instanceof Error ? error.message : String(error),
      })
      console.error('语音播报失败:', error)
      toast.error(error instanceof Error ? error.message : '语音播报失败')
    } finally {
      if (useChatStore.getState().playingVoiceMessageId === message.id) {
        setPlayingVoiceMessageId(null)
      }
      logManualVoice('end', {
        messageId: message.id,
        chatRoomId: message.chatRoomId,
      })
      onCompleteManualSpeak?.(message.id)
    }
  }, [isCurrentlyPlaying, message.chatRoomId, message.content, message.id, message.agentId, normalizedContent, onCompleteManualSpeak, onMarkPlayed, onStartManualSpeak, onStopSpeak, setPlayingVoiceMessageId, voiceConfig])

  const handlePrewarm = useCallback(() => {
    if (isCurrentlyPlaying || voiceConfig?.provider !== 'openai-compatible-tts') return
    prewarmTts({
      text: message.content,
      provider: voiceConfig.provider,
      model: voiceConfig.model,
      voiceId: voiceConfig.voiceId,
      rate: voiceConfig.speed,
      format: voiceConfig.format ?? undefined,
      agentId: message.agentId ?? undefined,
      chatRoomId: message.chatRoomId,
    })
  }, [isCurrentlyPlaying, message.agentId, message.chatRoomId, message.content, voiceConfig])

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
          const blocksDetail = isSystemAssistantDetailBlocked(matchedAgent)
          // 渲染高亮的 @助手名
          parts.push(
            <span
              key={`mention-${match.index}`}
              className={cn(
                'text-primary whitespace-nowrap',
                blocksDetail ? 'cursor-default' : 'cursor-pointer hover:text-primary/80'
              )}
              onClick={() => {
                if (!blocksDetail) onMentionClick?.(matchedAgent.id, matchedAgent.name)
              }}
              title={blocksDetail ? undefined : `点击查看 ${matchedAgent.name} 详情`}
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
    return (
      <MarkdownContent
        content={content}
        mentionAgents={mentionAgents}
        onMentionClick={onMentionClick}
        onImageClick={setViewerImage}
      />
    )
  }

  // 回复消息预览（飞书风格）
  const renderReplyPreview = () => {
    if (!replyTo) return null
    const replySenderName = replyTo.isHuman
      ? (replyTo.user?.username ?? '用户')
      : (replyTo.agent?.name ?? '助手')
    const handleReplyPreviewClick = () => {
      setScrollToMessageId(replyTo.id)
    }

    return (
      <div
        role="button"
        tabIndex={0}
        className="mb-1.5 flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded bg-primary/5 text-xs text-muted-foreground hover:bg-primary/10"
        onClick={handleReplyPreviewClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          handleReplyPreviewClick()
        }}
      >
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
        {message.attachments.map((attachment) => {
          const attachmentType = getAttachmentType(attachment)

          if (attachmentType === 'image') {
            const imageUrl = resolveAssetUrl(attachment.url)
            return (
              <div key={attachment.id} className="relative">
                <img
                  src={imageUrl}
                  alt={attachment.filename}
                  className="max-h-[260px] w-auto max-w-[min(360px,70vw)] rounded-lg cursor-pointer object-contain transition-opacity hover:opacity-90"
                  onClick={() => imageUrl && setViewerImage({ url: imageUrl, name: attachment.filename })}
                  loading="lazy"
                />
              </div>
            )
          }

          if (attachmentType === 'audio') {
            return (
              <AudioMessagePlayer
                key={attachment.id}
                src={resolveAssetUrl(attachment.url) ?? attachment.url}
                mimeType={attachment.mimeType}
                title={attachment.filename}
                durationMs={attachment.durationMs}
                transcript={attachment.transcript && attachment.transcript !== message.content.trim() ? attachment.transcript : null}
              />
            )
          }

          return (
            <div key={attachment.id} className="max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
              <div className="truncate">{attachment.filename}</div>
            </div>
          )
        })}
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

          const isPending = agent.status === 'pending'
          const elapsedText = !isPending && agent.startedAt
            ? formatDuration(durationNow - agent.startedAt)
            : null
          return (
            <div
              key={agent.agentId}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                isPending
                  ? "bg-muted text-muted-foreground hover:bg-accent"
                  : "bg-primary/5 text-primary hover:bg-primary/10"
              )}
              onClick={() => onTypingAgentClick?.(message.id, agent.agentId, agent.agentName)}
            >
              {isPending && <Clock className="size-3" />}
              {!isPending && (
                <span className="flex items-center h-5 justify-center font-bold leading-none">
                  <span className="animate-[dot-appear_1.5s_infinite] -translate-y-0.5">.</span>
                  <span className="animate-[dot-appear_1.5s_0.3s_infinite] -translate-y-0.5">.</span>
                  <span className="animate-[dot-appear_1.5s_0.6s_infinite] -translate-y-0.5">.</span>
                </span>
              )}
              <span>
                {agent.agentName} {isPending ? '等待执行' : '执行中'}
                {elapsedText && ` 耗时：${elapsedText}`}
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  const renderSpeechButton = () => {
    if (message.isHuman || !showSpeechButton) return null
    if (!voiceConfig?.enabled || !normalizedContent || !supportsSpeechPlayback(voiceConfig)) return null
    const showUnplayedDot = !isCurrentlyPlaying && !isVoicePlayed

    return (
      <span className="relative inline-flex">
        <button
          onClick={handleSpeakMessage}
          onMouseEnter={handlePrewarm}
          onPointerDown={handlePrewarm}
          className={cn(
            "group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors",
            isCurrentlyPlaying
              ? "bg-primary/10 text-primary hover:bg-primary/15"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={isCurrentlyPlaying ? '停止播报' : '语音播报'}
          aria-label={isCurrentlyPlaying ? '停止播报' : '语音播报'}
        >
          <span
            className={cn(
              "flex size-3.5 items-center justify-center transition-colors",
              isCurrentlyPlaying
                ? "text-primary"
                : "text-muted-foreground group-hover:text-foreground"
            )}
          >
            {isCurrentlyPlaying ? (
              <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                <span className="w-[2px] rounded-full bg-current origin-bottom" style={{ height: '100%', animation: 'sound-bar 0.7s ease-in-out infinite', animationDelay: '0ms' }} />
                <span className="w-[2px] rounded-full bg-current origin-bottom" style={{ height: '78%', animation: 'sound-bar 0.7s ease-in-out infinite', animationDelay: '180ms' }} />
                <span className="w-[2px] rounded-full bg-current origin-bottom" style={{ height: '62%', animation: 'sound-bar 0.7s ease-in-out infinite', animationDelay: '360ms' }} />
              </span>
            ) : (
              <Volume2 className="size-3.5 transition-transform group-hover:scale-110" strokeWidth={2} />
            )}
          </span>
          <span className="transition-colors">
            {isCurrentlyPlaying ? '播放中' : '播报'}
          </span>
        </button>
        {showUnplayedDot && (
          <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-500 ring-2 ring-background" aria-hidden />
        )}
      </span>
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
        {onStartMultiSelect && (
          <button
            onClick={handleStartMultiSelect}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-popover-foreground hover:bg-accent"
          >
            <CheckSquare className="size-4" />
            多选
          </button>
        )}
      </div>
    )
  }

  const renderContextMenuLayer = () => {
    if (!showContextMenu) return null

    const layer = (
      <>
        <div className="fixed inset-0 z-40" onClick={handleClickOutside} />
        {renderContextMenu()}
      </>
    )

    return typeof document === 'undefined' ? layer : createPortal(layer, document.body)
  }

  const renderContentToggleButton = (isCollapsed: boolean) => (
    <button
      type="button"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-blue-500 transition-colors hover:text-blue-600",
        isCollapsed
          ? "h-24 w-full justify-center rounded-b-lg border-0 bg-gradient-to-t from-background via-background/95 to-transparent pt-12 pb-2 shadow-none hover:from-blue-50 hover:via-blue-50/95 dark:hover:from-blue-950/90 dark:hover:via-blue-950/60"
          : "rounded-full border border-gray-200 bg-background px-3 py-1.5 shadow-sm hover:bg-blue-50 dark:border-border dark:hover:bg-blue-950/30"
      )}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setIsContentExpanded((expanded) => !expanded)
      }}
    >
      {isCollapsed ? (
        <>
          <ChevronDown className="size-3.5" />
          <span>展开完整内容</span>
        </>
      ) : (
        <>
          <ChevronUp className="size-3.5" />
          <span>收起内容</span>
        </>
      )}
    </button>
  )

  const renderMessageBody = (bodyClassName: string) => {
    const shouldCollapse = !disableContentCollapse && isLargeMessageContent(message.content)
    const isCollapsed = shouldCollapse && !isContentExpanded
    const visibleContent = isCollapsed ? getCollapsedPreviewContent(message.content) : message.content

    return (
      <div className="relative overflow-hidden">
        <div className={bodyClassName}>
          {renderAttachments()}
          {!shouldHideContent && (
            <div
              className={cn(
                isCollapsed && (isMobile ? "max-h-[300px] overflow-hidden" : "max-h-[420px] overflow-hidden")
              )}
            >
              {renderContent(visibleContent)}
            </div>
          )}
          {!shouldHideContent && shouldCollapse && !isCollapsed && (
            <div className="mt-2 flex justify-center border-t border-border/60 pt-2">
              {renderContentToggleButton(false)}
            </div>
          )}
        </div>

        {!shouldHideContent && shouldCollapse && isCollapsed && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center">
            {renderContentToggleButton(true)}
          </div>
        )}
      </div>
    )
  }

  if (isRight) {
    return (
      <>
        {renderContextMenuLayer()}
        <div
          className={cn("flex justify-end py-2", isMobile ? "px-2" : "px-6")}
          onClickCapture={handleSelectionClickCapture}
        >
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
                  "text-foreground cursor-text w-fit max-w-full overflow-hidden",
                  isAudioOnly
                    ? ""
                    : "rounded-lg bg-primary/15 border border-primary/20 dark:bg-primary/20 dark:border-primary/30",
                  isMobile ? "select-none" : "select-text",
                  selectionMode && "cursor-pointer select-none",
                  isSelected && "ring-2 ring-blue-500 ring-offset-2 ring-offset-background"
                )}
                onContextMenu={handleContextMenu}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {renderMessageBody(isAudioOnly ? "" : "px-4 py-2")}
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
      {renderContextMenuLayer()}
      <div
        className={cn("py-2", isMobile ? "px-2" : "px-6")}
        onClickCapture={handleSelectionClickCapture}
      >
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
                "text-foreground cursor-text max-w-full overflow-hidden",
                isAudioOnly
                  ? ""
                  : "rounded-lg bg-muted/50 border border-border/50 dark:bg-muted/40 dark:border-border",
                isMobile ? "select-none" : "select-text",
                selectionMode && "cursor-pointer select-none",
                isSelected && "ring-2 ring-blue-500 ring-offset-2 ring-offset-background"
              )}
              onContextMenu={handleContextMenu}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {renderMessageBody(isAudioOnly ? "" : "px-4 py-3")}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {renderTypingAgents()}
              {renderReplyCount()}
              {renderSpeechButton()}
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
})
