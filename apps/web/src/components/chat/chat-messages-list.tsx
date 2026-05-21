import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Message } from '@/lib/agent-api'
import { ChatMessage } from './chat-message'
import { useChatStore } from '@/stores/chat-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { toVoicePanelConfig, type AgentVoicePanelConfig } from '@/lib/agent-speech'
import { deleteTtsCache, loadRoomTtsCache, normalizeSpeechText, prewarmTts, speakText, stopSpeechPlayback, supportsSpeechPlayback } from '@/lib/browser-speech'
import { buildTtsCacheKey, PREWARM_MAX_TEXT_LENGTH } from '@/speech/tts-prefetch-cache'
import { Check, CheckSquare, Loader2, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'

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
  avatarColor?: string | null
} | null

interface ChatMessagesListProps {
  chatRoomId: string  // 群聊 ID，用于保存滚动位置
  messages: Message[]
  loading: boolean
  loadingOlderMessages: boolean
  hasOlderMessages: boolean
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  typingAgents: Map<string, { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled' }[]>
  mentionAgents: MentionAgent[]
  onAgentAvatarClick: (agentId: string, agentName: string) => void
  onTypingAgentClick: (messageId: string, agentId: string, agentName: string) => void
  onMentionClick: (agentId: string, agentName: string) => void
  onReplyClick: (messageId: string) => void
  onExecutionDetailClick?: (messageId: string, executionRecordId: string) => void
  onMentionAgent?: (agentId: string, agentName: string) => void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onDeleteMessages?: (messageIds: string[]) => Promise<void> | void
  onLoadOlderMessages?: () => Promise<void> | void
  currentUser?: CurrentUser
}

interface MessageRowProps {
  chatRoomId: string
  message: Message
  isMultiSelectMode: boolean
  isSelected: boolean
  replyTo?: Message | null
  replyCount: number
  typingAgents?: { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled' }[]
  mentionAgents: MentionAgent[]
  currentUser?: CurrentUser
  hasBeenPlayed: boolean
  onSetMessageRef: (messageId: string, element: HTMLDivElement | null) => void
  onMarkVoiceMessagesPlayed: (chatRoomId: string, messageIds: string[]) => void
  onStopSpeak: (messageId: string) => void
  onAgentAvatarClick: (agentId: string, agentName: string) => void
  onTypingAgentClick: (messageId: string, agentId: string, agentName: string) => void
  onMentionClick: (agentId: string, agentName: string) => void
  onReplyClick: (messageId: string) => void
  onExecutionDetailClick?: (messageId: string, executionRecordId: string) => void
  onMentionAgent?: (agentId: string, agentName: string) => void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onStartMultiSelect: (messageId: string) => void
  onToggleSelection: (messageId: string) => void
}

const MessageRow = memo(function MessageRow({
  chatRoomId,
  message,
  isMultiSelectMode,
  isSelected,
  replyTo,
  replyCount,
  typingAgents,
  mentionAgents,
  currentUser,
  hasBeenPlayed,
  onSetMessageRef,
  onMarkVoiceMessagesPlayed,
  onStopSpeak,
  onAgentAvatarClick,
  onTypingAgentClick,
  onMentionClick,
  onReplyClick,
  onExecutionDetailClick,
  onMentionAgent,
  onDeleteMessage,
  onStartMultiSelect,
  onToggleSelection,
}: MessageRowProps) {
  const handleRowClick = useCallback(() => {
    if (isMultiSelectMode) onToggleSelection(message.id)
  }, [isMultiSelectMode, message.id, onToggleSelection])

  const handleOverlayClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onToggleSelection(message.id)
  }, [message.id, onToggleSelection])

  const handleOverlayKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    event.stopPropagation()
    onToggleSelection(message.id)
  }, [message.id, onToggleSelection])

  const handleMarkPlayed = useCallback(() => {
    onMarkVoiceMessagesPlayed(chatRoomId, [message.id])
  }, [chatRoomId, message.id, onMarkVoiceMessagesPlayed])

  const setRowRef = useCallback((element: HTMLDivElement | null) => {
    onSetMessageRef(message.id, element)
  }, [message.id, onSetMessageRef])

  return (
    <div
      data-message-id={message.id}
      onClick={handleRowClick}
      className={cn(
        "relative transition-colors",
        isMultiSelectMode && "cursor-pointer",
        isSelected && "bg-blue-50/70 dark:bg-blue-950/20"
      )}
      ref={setRowRef}
    >
      {isMultiSelectMode && (
        <div
          role="button"
          tabIndex={0}
          data-message-row-select-overlay
          aria-pressed={isSelected}
          aria-label={isSelected ? '取消选择消息' : '选择消息'}
          className="absolute inset-0 z-20 cursor-pointer"
          onClick={handleOverlayClick}
          onKeyDown={handleOverlayKeyDown}
        />
      )}
      <ChatMessage
        message={message}
        isRight={message.isHuman}
        replyTo={replyTo}
        replyCount={replyCount}
        typingAgents={typingAgents}
        mentionAgents={mentionAgents}
        currentUser={currentUser}
        hasBeenPlayed={hasBeenPlayed}
        onMarkPlayed={handleMarkPlayed}
        onStopSpeak={onStopSpeak}
        onAgentAvatarClick={onAgentAvatarClick}
        onTypingAgentClick={onTypingAgentClick}
        onMentionClick={onMentionClick}
        onReplyClick={onReplyClick}
        onExecutionDetailClick={onExecutionDetailClick}
        onMentionAgent={onMentionAgent}
        onDeleteMessage={onDeleteMessage}
        onStartMultiSelect={onStartMultiSelect}
        onToggleSelection={onToggleSelection}
        selectionMode={isMultiSelectMode}
        isSelected={isSelected}
      />
      {isMultiSelectMode && (
        <div className="pointer-events-none absolute left-3 top-4 z-30 flex size-5 items-center justify-center rounded-full border border-blue-500 bg-background text-blue-500 shadow-sm">
          {isSelected && <Check className="size-3.5" />}
        </div>
      )}
    </div>
  )
})

function estimateMessageHeight(message?: Message): number {
  if (!message) return 128

  const textLength = message.content.length
  const lineCount = message.content.split(/\r\n|\r|\n/).length
  const attachmentCount = message.attachments?.length ?? 0
  const textHeight = Math.min(420, Math.max(28, Math.ceil(textLength / 52) * 18 + lineCount * 6))
  const attachmentHeight = attachmentCount > 0 ? Math.min(280, attachmentCount * 96) : 0

  return 72 + textHeight + attachmentHeight
}

export function ChatMessagesList({
  chatRoomId,
  messages,
  loading,
  loadingOlderMessages,
  hasOlderMessages,
  messagesEndRef,
  typingAgents,
  mentionAgents,
  onAgentAvatarClick,
  onTypingAgentClick,
  onMentionClick,
  onReplyClick,
  onExecutionDetailClick,
  onMentionAgent,
  onDeleteMessage,
  onDeleteMessages,
  onLoadOlderMessages,
  currentUser,
}: ChatMessagesListProps) {
  const isMobile = useIsMobile()
  const scrollToMessageId = useChatStore((s) => s.scrollToMessageId)
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId)
  const forceScrollToBottom = useChatStore((s) => s.forceScrollToBottom)
  const setForceScrollToBottom = useChatStore((s) => s.setForceScrollToBottom)
  const saveScrollPosition = useChatStore((s) => s.saveScrollPosition)
  const getScrollPosition = useChatStore((s) => s.getScrollPosition)
  const allAgents = useChatStore((s) => s.allAgents)
  const setPlayingVoiceMessageId = useChatStore((s) => s.setPlayingVoiceMessageId)
  const handledVoiceMessageIdsByRoom = useChatStore((s) => s.handledVoiceMessageIdsByRoom)
  const playedVoiceMessageIdsByRoom = useChatStore((s) => s.playedVoiceMessageIdsByRoom)
  const markVoiceMessagesHandled = useChatStore((s) => s.markVoiceMessagesHandled)
  const markVoiceMessagesPlayed = useChatStore((s) => s.markVoiceMessagesPlayed)
  const messageRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const containerRef = useRef<HTMLDivElement | null>(null)
  // 语音播报队列：上一条播完再播下一条
  const speechQueueRef = useRef<Array<{ messageId: string; agentId: string; text: string; voiceConfig: AgentVoicePanelConfig }>>([])
  const queuedVoiceMessageIdsRef = useRef<Set<string>>(new Set())
  const deferredVoiceMessageIdsRef = useRef<Set<string>>(new Set())
  const isSpeakingRef = useRef(false)
  const speechRunIdRef = useRef(0)
  const [visibilityVersion, setVisibilityVersion] = useState(0)
  const handledIds = useMemo(
    () => new Set(handledVoiceMessageIdsByRoom[chatRoomId] ?? []),
    [chatRoomId, handledVoiceMessageIdsByRoom],
  )
  const playedIds = useMemo(
    () => new Set(playedVoiceMessageIdsByRoom[chatRoomId] ?? []),
    [chatRoomId, playedVoiceMessageIdsByRoom],
  )
  // ref 缓存，供 processQueue 在不触发 effect 重跑的前提下读取最新值
  const handledIdsRef = useRef(handledIds)
  const playedIdsRef = useRef(playedIds)
  handledIdsRef.current = handledIds
  playedIdsRef.current = playedIds
  const allAgentsRef = useRef(allAgents)
  allAgentsRef.current = allAgents
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  )
  const messageIndexById = useMemo(
    () => new Map(messages.map((message, index) => [message.id, index])),
    [messages],
  )
  const messageByIdRef = useRef(messageById)
  messageByIdRef.current = messageById
  const replyCountsByMessageId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const message of messages) {
      if (message.replyMessageId) {
        counts.set(message.replyMessageId, (counts.get(message.replyMessageId) ?? 0) + 1)
      }
    }
    return counts
  }, [messages])

  // 是否在底部附近（距离底部 100px 以内算"在底部"）
  const [isNearBottom, setIsNearBottom] = useState(true)
  // 是否显示新消息提示
  const [showNewMessageHint, setShowNewMessageHint] = useState(false)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingSelected, setDeletingSelected] = useState(false)
  // 上一次消息数量，用于检测新消息
  const prevMessageCountRef = useRef(messages.length)
  const prevLastMessageIdRef = useRef(messages[messages.length - 1]?.id ?? null)
  // 记录上一次的群聊 ID，用于检测群聊切换
  const prevChatRoomIdRef = useRef(chatRoomId)
  // 是否已完成初始滚动位置恢复（切换群聊时重置）
  const hasRestoredPositionRef = useRef(false)
  // 已完成进入群聊批量预热的 room ID 集合
  const prewarmDoneRoomsRef = useRef<Set<string>>(new Set())
  // 进入房间时已存在的消息 ID（不自动播放）
  const initialMessageIdsRef = useRef<Set<string>>(new Set())
  const initialCapturedRef = useRef(false)
  const recentlyStoppedVoiceMessageIdsRef = useRef<Map<string, number>>(new Map())
  const prependAnchorRef = useRef<{ messageId: string; offset: number } | null>(null)
  const pendingHighlightMessageIdRef = useRef<string | null>(null)
  const hasUserScrollIntentRef = useRef(false)

  const selectedCount = selectedMessageIds.size
  const getVirtualItemKey = useCallback((index: number) => messages[index]?.id ?? index, [messages])
  const estimateVirtualItemSize = useCallback((index: number) => estimateMessageHeight(messages[index]), [messages])
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: messages.length,
    getScrollElement: () => containerRef.current,
    getItemKey: getVirtualItemKey,
    estimateSize: estimateVirtualItemSize,
    overscan: isMobile ? 8 : 12,
  })
  const virtualItems = rowVirtualizer.getVirtualItems()

  const exitMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false)
    setSelectedMessageIds(new Set())
  }, [])

  const startMultiSelect = useCallback((messageId: string) => {
    setIsMultiSelectMode(true)
    setSelectedMessageIds(new Set([messageId]))
  }, [])

  const toggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) {
        next.delete(messageId)
      } else {
        next.add(messageId)
      }
      return next
    })
  }, [])

  const handleSetMessageRef = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) {
      messageRefs.current.set(messageId, element)
    } else {
      messageRefs.current.delete(messageId)
    }
  }, [])

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    await onDeleteMessage?.(messageId)
    const msg = messageByIdRef.current.get(messageId)
    if (!msg || msg.isHuman || !msg.agentId) return
    const agent = allAgentsRef.current.find((item) => item.id === msg.agentId)
    const voiceConfig = agent?.speechConfig ? toVoicePanelConfig(agent.speechConfig) : null
    if (!voiceConfig?.enabled || voiceConfig.provider !== 'openai-compatible-tts') return
    const text = normalizeSpeechText(msg.content)
    if (!text || text.length > PREWARM_MAX_TEXT_LENGTH) return
    deleteTtsCache(chatRoomId, buildTtsCacheKey({
      provider: voiceConfig.provider,
      model: voiceConfig.model ?? null,
      voice: voiceConfig.voiceId ?? null,
      speed: voiceConfig.speed ?? 1.3,
      format: voiceConfig.format ?? null,
      text,
    }))
  }, [chatRoomId, onDeleteMessage])

  const handleDeleteSelected = useCallback(async () => {
    if (!onDeleteMessages || selectedMessageIds.size === 0) return
    setDeletingSelected(true)
    try {
      await onDeleteMessages(Array.from(selectedMessageIds))
      toast.success(`已删除 ${selectedMessageIds.size} 条消息`)
      setDeleteDialogOpen(false)
      exitMultiSelect()
    } catch (error) {
      console.error('Failed to delete selected messages:', error)
      toast.error('批量删除失败')
    } finally {
      setDeletingSelected(false)
    }
  }, [exitMultiSelect, onDeleteMessages, selectedMessageIds])

  // 检查是否在底部附近
  const checkIsNearBottom = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current
      const distanceToBottom = scrollHeight - scrollTop - clientHeight
      return distanceToBottom < 100
    }
    return true
  }, [])

  const capturePrependAnchor = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    const anchorItem = rowVirtualizer
      .getVirtualItems()
      .find((item) => item.end >= container.scrollTop)
    const anchorMessage = anchorItem ? messages[anchorItem.index] : null
    if (!anchorItem || !anchorMessage) return

    prependAnchorRef.current = {
      messageId: anchorMessage.id,
      offset: anchorItem.start - container.scrollTop,
    }
  }, [messages, rowVirtualizer])

  const tryLoadOlderMessages = useCallback(() => {
    const container = containerRef.current
    if (
      container
      && container.scrollTop < 80
      && hasUserScrollIntentRef.current
      && hasOlderMessages
      && !loading
      && !loadingOlderMessages
      && messages.length > 0
    ) {
      capturePrependAnchor()
      void onLoadOlderMessages?.()
    }
  }, [capturePrependAnchor, hasOlderMessages, loading, loadingOlderMessages, messages.length, onLoadOlderMessages])

  const markUserScrollIntent = useCallback(() => {
    hasUserScrollIntentRef.current = true
  }, [])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    markUserScrollIntent()
    if (event.deltaY < 0) {
      tryLoadOlderMessages()
    }
  }, [markUserScrollIntent, tryLoadOlderMessages])

  const handleTouchStart = useCallback(() => {
    markUserScrollIntent()
  }, [markUserScrollIntent])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
      markUserScrollIntent()
      tryLoadOlderMessages()
    }
  }, [markUserScrollIntent, tryLoadOlderMessages])

  // 滚动事件处理
  const handleScroll = useCallback(() => {
    tryLoadOlderMessages()
    const nearBottom = checkIsNearBottom()
    setIsNearBottom(nearBottom)

    // 如果用户滚动到底部，隐藏新消息提示
    if (nearBottom && showNewMessageHint) {
      setShowNewMessageHint(false)
    }
  }, [checkIsNearBottom, showNewMessageHint, tryLoadOlderMessages])

  useLayoutEffect(() => {
    if (loadingOlderMessages || prependAnchorRef.current === null) return

    const anchor = prependAnchorRef.current
    const anchorIndex = messageIndexById.get(anchor.messageId)
    if (anchorIndex === undefined) {
      prependAnchorRef.current = null
      return
    }

    const animationFrame = requestAnimationFrame(() => {
      const offsetInfo = rowVirtualizer.getOffsetForIndex(anchorIndex, 'start')
      if (!offsetInfo) return

      rowVirtualizer.scrollToOffset(Math.max(0, offsetInfo[0] - anchor.offset), { behavior: 'auto' })
      prependAnchorRef.current = null
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [loadingOlderMessages, messageIndexById, messages.length, rowVirtualizer])

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (messages.length === 0) return

    const alignToBottom = () => {
      const container = containerRef.current
      if (!container) return
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' })
      container.scrollTop = container.scrollHeight
    }

    alignToBottom()

    let frame = 0
    const tick = () => {
      alignToBottom()
      frame += 1
      if (frame < 3) {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }, [messages.length, rowVirtualizer])

  const highlightMessage = useCallback((messageId: string) => {
    const messageEl = messageRefs.current.get(messageId)
    if (!messageEl) return false

    messageEl.classList.add('message-highlight')
    if (pendingHighlightMessageIdRef.current === messageId) {
      pendingHighlightMessageIdRef.current = null
    }
    window.setTimeout(() => {
      messageEl.classList.remove('message-highlight')
      setScrollToMessageId(null)
    }, 3000)
    return true
  }, [setScrollToMessageId])

  // 处理消息定位
  useEffect(() => {
    if (!scrollToMessageId) return

    const messageIndex = messageIndexById.get(scrollToMessageId)
    if (messageIndex === undefined) return

    pendingHighlightMessageIdRef.current = scrollToMessageId
    rowVirtualizer.scrollToIndex(messageIndex, { align: 'center', behavior: 'smooth' })

    let frame = 0
    const tick = () => {
      if (highlightMessage(scrollToMessageId)) return
      frame += 1
      if (frame < 6) {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  }, [highlightMessage, messageIndexById, rowVirtualizer, scrollToMessageId])

  useEffect(() => {
    const pendingId = pendingHighlightMessageIdRef.current
    if (pendingId) {
      highlightMessage(pendingId)
    }
  }, [highlightMessage, virtualItems])

  // 处理强制滚动到底部（用户发送消息后）
  useEffect(() => {
    if (forceScrollToBottom) {
      scrollToBottom()
      setShowNewMessageHint(false)
      setIsNearBottom(true)
      setForceScrollToBottom(false)
    }
  }, [forceScrollToBottom, scrollToBottom, setForceScrollToBottom])

  // 检测新消息
  useEffect(() => {
    const previousMessageCount = prevMessageCountRef.current
    const previousLastMessageId = prevLastMessageIdRef.current
    const currentLastMessageId = messages[messages.length - 1]?.id ?? null
    const hasNewMessages = messages.length > previousMessageCount && currentLastMessageId !== previousLastMessageId
    prevMessageCountRef.current = messages.length
    prevLastMessageIdRef.current = currentLastMessageId

    if (hasNewMessages) {
      if (isNearBottom) {
        // 在底部，自动滚动
        scrollToBottom()
      } else {
        // 不在底部，显示新消息提示
        setShowNewMessageHint(true)
      }
    }
  }, [messages, isNearBottom, scrollToBottom])

  // typingAgents 变化时，如果在底部也滚动
  useEffect(() => {
    if (isNearBottom && typingAgents.size > 0) {
      scrollToBottom()
    }
  }, [typingAgents, isNearBottom, scrollToBottom])

  // 检测群聊切换，重置恢复标记
  useEffect(() => {
    if (prevChatRoomIdRef.current !== chatRoomId) {
      prevChatRoomIdRef.current = chatRoomId
      hasRestoredPositionRef.current = false
      initialMessageIdsRef.current = new Set()
      initialCapturedRef.current = false
      recentlyStoppedVoiceMessageIdsRef.current.clear()
      hasUserScrollIntentRef.current = false
      prependAnchorRef.current = null
      pendingHighlightMessageIdRef.current = null
      prevMessageCountRef.current = messages.length
      prevLastMessageIdRef.current = messages[messages.length - 1]?.id ?? null
      // 重置底部状态
      setIsNearBottom(true)
      setShowNewMessageHint(false)
      exitMultiSelect()
    }
  }, [chatRoomId, exitMultiSelect])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setVisibilityVersion((value) => value + 1)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // 消息加载完成后恢复上次滚动位置（只在切换群聊后的首次加载时执行）
  useEffect(() => {
    if (!loading && messages.length > 0 && containerRef.current && !hasRestoredPositionRef.current) {
      hasRestoredPositionRef.current = true
      const savedPosition = getScrollPosition(chatRoomId)
      if (savedPosition !== null) {
        // 恢复滚动位置
        rowVirtualizer.scrollToOffset(savedPosition, { behavior: 'auto' })
      } else {
        // 没有保存的位置，滚动到底部
        scrollToBottom()
      }
    }
  }, [loading, chatRoomId, getScrollPosition, messages.length, rowVirtualizer, scrollToBottom])

  // 捕获进入房间时的初始消息 ID，这些消息不走自动播放
  useEffect(() => {
    if (!loading && !initialCapturedRef.current && messages.length > 0) {
      initialCapturedRef.current = true
      for (const m of messages) initialMessageIdsRef.current.add(m.id)
    }
  }, [loading, chatRoomId, messages])

  // 进入群聊时先从 IDB 加载缓存，再批量预热未缓存的旧消息（每个 room 只触发一次）
  useEffect(() => {
    if (loading || messages.length === 0 || allAgents.length === 0) return
    if (prewarmDoneRoomsRef.current.has(chatRoomId)) return
    prewarmDoneRoomsRef.current.add(chatRoomId)
    const agents = allAgents
    const roomId = chatRoomId
    void (async () => {
      await loadRoomTtsCache(roomId)
      for (const message of [...messages].reverse().slice(0, 10)) {
        if (message.isHuman || !message.agentId || !message.content.trim()) continue
        const agent = agents.find((a) => a.id === message.agentId)
        const vc = agent?.speechConfig ? toVoicePanelConfig(agent.speechConfig) : null
        if (!vc?.enabled || vc.provider !== 'openai-compatible-tts') continue
        prewarmTts({
          text: message.content,
          provider: vc.provider,
          model: vc.model,
          voiceId: vc.voiceId,
          rate: vc.speed,
          format: vc.format ?? undefined,
          agentId: message.agentId,
          chatRoomId: roomId,
        })
      }
    })()
  }, [chatRoomId, loading, messages, allAgents])

  // 切换房间时取消正在播报的语音（已播 ID 保留，不清空）
  useEffect(() => {
    speechRunIdRef.current += 1
    speechQueueRef.current = []
    queuedVoiceMessageIdsRef.current.clear()
    deferredVoiceMessageIdsRef.current.clear()
    stopSpeechPlayback()
    setPlayingVoiceMessageId(null)
  }, [chatRoomId, setPlayingVoiceMessageId])


  // 串行消费队列：上一条播完再播下一条。读取 ref 中的最新状态，避免 effect 重跑触发循环。
  const processQueue = useCallback(async () => {
    if (isSpeakingRef.current) return
    isSpeakingRef.current = true
    const runId = speechRunIdRef.current
    while (speechQueueRef.current.length > 0) {
      if (runId !== speechRunIdRef.current) {
        break
      }
      const item = speechQueueRef.current.shift()!
      // 避免重复播报：在 shift 后再次检查 playedIds
      if (playedIdsRef.current.has(item.messageId)) {
        queuedVoiceMessageIdsRef.current.delete(item.messageId)
        continue
      }
      setPlayingVoiceMessageId(item.messageId)
      // 预热队列中接下来 3 条，避免播完等待
      for (const next of speechQueueRef.current.slice(0, 3)) {
        prewarmTts({
          text: next.text,
          provider: next.voiceConfig.provider,
          model: next.voiceConfig.model,
          voiceId: next.voiceConfig.voiceId,
          rate: next.voiceConfig.speed,
          format: next.voiceConfig.format ?? undefined,
          agentId: next.agentId,
          chatRoomId,
        })
      }
      let playedSuccessfully = false
      let interrupted = false
      try {
        await speakText({
          text: item.text,
          provider: item.voiceConfig.provider,
          model: item.voiceConfig.model,
          voiceId: item.voiceConfig.voiceId,
          fallbackProvider: item.voiceConfig.fallbackProvider,
          rate: item.voiceConfig.speed,
          volume: item.voiceConfig.volume,
          pitch: item.voiceConfig.pitch ?? undefined,
          emotion: item.voiceConfig.emotion,
          style: item.voiceConfig.style,
          format: item.voiceConfig.format,
          sampleRate: item.voiceConfig.sampleRate,
          temperature: item.voiceConfig.temperature,
          prompt: item.voiceConfig.prompt,
          agentId: item.agentId,
          chatRoomId,
          messageId: item.messageId,
          source: 'assistant-auto-speak',
        })
        playedSuccessfully = true
      } catch (e) {
        if (e instanceof Error && e.message === 'speech_interrupted') {
          interrupted = true
        } else if (e instanceof Error && (e as Error & { cancelled?: boolean }).cancelled) {
          interrupted = true
        }
      }
      queuedVoiceMessageIdsRef.current.delete(item.messageId)
      if (interrupted || runId !== speechRunIdRef.current) {
        deferredVoiceMessageIdsRef.current.add(item.messageId)
        break
      }
      if (playedSuccessfully) {
        deferredVoiceMessageIdsRef.current.delete(item.messageId)
        markVoiceMessagesHandled(chatRoomId, [item.messageId])
        markVoiceMessagesPlayed(chatRoomId, [item.messageId])
      } else {
        deferredVoiceMessageIdsRef.current.add(item.messageId)
      }
    }
    if (speechRunIdRef.current === runId) {
      setPlayingVoiceMessageId(null)
      isSpeakingRef.current = false
    }
  }, [chatRoomId, markVoiceMessagesHandled, markVoiceMessagesPlayed, setPlayingVoiceMessageId])

  const stopCurrentPlaybackSession = useCallback((messageId: string) => {
    speechRunIdRef.current += 1
    isSpeakingRef.current = false
    const pendingIds = speechQueueRef.current.map((item) => item.messageId)
    speechQueueRef.current = []
    queuedVoiceMessageIdsRef.current.clear()
    deferredVoiceMessageIdsRef.current.add(messageId)
    for (const pendingId of pendingIds) {
      deferredVoiceMessageIdsRef.current.add(pendingId)
    }
    recentlyStoppedVoiceMessageIdsRef.current.set(messageId, Date.now())
    stopSpeechPlayback()
    setPlayingVoiceMessageId(null)
  }, [setPlayingVoiceMessageId])

  useEffect(() => {
    if (loading) return
    if (document.hidden) return

    const handledSet = handledIdsRef.current
    const playedSet = playedIdsRef.current
    const agentsList = allAgentsRef.current

    // 找出未播报的新消息（不在 effect 开头清空 deferred set）
    const newMessages = messages.filter(
      (message) => message.chatRoomId === chatRoomId
        && !handledSet.has(message.id)
        && !queuedVoiceMessageIdsRef.current.has(message.id)
        && !deferredVoiceMessageIdsRef.current.has(message.id),
    )
    if (newMessages.length === 0) return
    const permanentlySkippedMessageIds: string[] = []

    // 收集所有需要播报的新消息，按顺序入队
    const toSpeak = newMessages.filter((message) => {
      if (message.isHuman || !message.agentId || !message.content.trim()) {
        permanentlySkippedMessageIds.push(message.id)
        return false
      }
      const agent = agentsList.find((item) => item.id === message.agentId)
      if (!agent) {
        return false
      }
      const voiceConfig = agent.speechConfig ? toVoicePanelConfig(agent.speechConfig) : null
      const shouldAutoPlay = voiceConfig?.enabled
        && voiceConfig.outputMode === 'auto_final_only'
        && supportsSpeechPlayback(voiceConfig)
        && !playedSet.has(message.id)
        && !initialMessageIdsRef.current.has(message.id)

      if (playedSet.has(message.id)) {
        permanentlySkippedMessageIds.push(message.id)
        return false
      }

      return shouldAutoPlay
    })

    if (permanentlySkippedMessageIds.length > 0) {
      markVoiceMessagesHandled(chatRoomId, permanentlySkippedMessageIds)
    }

    for (const message of newMessages) {
      if (message.isHuman || !message.agentId || !message.content.trim()) continue
      const agent = agentsList.find((item) => item.id === message.agentId)
      const vc = agent?.speechConfig ? toVoicePanelConfig(agent.speechConfig) : null
      if (!vc?.enabled || vc.provider !== 'openai-compatible-tts') continue
      prewarmTts({
        text: message.content,
        provider: vc.provider,
        model: vc.model,
        voiceId: vc.voiceId,
        rate: vc.speed,
        format: vc.format ?? undefined,
        agentId: message.agentId,
        chatRoomId,
      })
    }

    if (toSpeak.length === 0) return

    // 已有语音正在播放时，只预热缓存，不入队打断
    if (isSpeakingRef.current) return

    for (const message of toSpeak) {
      const agent = agentsList.find((item) => item.id === message.agentId)
      const agentConfig = agent?.speechConfig
      if (!agentConfig) continue
      const vc = toVoicePanelConfig(agentConfig)
      queuedVoiceMessageIdsRef.current.add(message.id)
      speechQueueRef.current.push({
        messageId: message.id,
        agentId: message.agentId!,
        text: normalizeSpeechText(message.content),
        voiceConfig: vc,
      })
    }

    void processQueue()
  }, [chatRoomId, loading, markVoiceMessagesHandled, messages, processQueue, visibilityVersion])

  // 组件卸载时保存当前滚动位置
  useEffect(() => {
    return () => {
      if (containerRef.current) {
        saveScrollPosition(chatRoomId, containerRef.current.scrollTop)
      }
    }
  }, [chatRoomId, saveScrollPosition])

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={markUserScrollIntent}
        onTouchStart={handleTouchStart}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ scrollbarGutter: 'stable' }}
        className={cn(
          messages.length === 0 ? 'relative flex-1 focus:outline-none' : 'scrollbar-hover relative flex-1 overflow-y-auto py-4 focus:outline-none',
          isMobile && 'min-h-0'
        )}
      >
        {messages.length === 0 && loading ? (
          <div className="flex h-full items-center justify-center text-gray-400">
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400 select-none">
            暂无消息
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const message = messages[virtualItem.index]
              if (!message) return null

              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  <MessageRow
                    chatRoomId={chatRoomId}
                    message={message}
                    isMultiSelectMode={isMultiSelectMode}
                    isSelected={selectedMessageIds.has(message.id)}
                    replyTo={message.replyMessageId ? messageById.get(message.replyMessageId) : null}
                    replyCount={replyCountsByMessageId.get(message.id) ?? 0}
                    typingAgents={typingAgents.get(message.id)}
                    mentionAgents={mentionAgents}
                    currentUser={currentUser}
                    hasBeenPlayed={playedIds.has(message.id)}
                    onSetMessageRef={handleSetMessageRef}
                    onMarkVoiceMessagesPlayed={markVoiceMessagesPlayed}
                    onStopSpeak={stopCurrentPlaybackSession}
                    onAgentAvatarClick={onAgentAvatarClick}
                    onTypingAgentClick={onTypingAgentClick}
                    onMentionClick={onMentionClick}
                    onReplyClick={onReplyClick}
                    onExecutionDetailClick={onExecutionDetailClick}
                    onMentionAgent={onMentionAgent}
                    onDeleteMessage={handleDeleteMessage}
                    onStartMultiSelect={startMultiSelect}
                    onToggleSelection={toggleMessageSelection}
                  />
                </div>
              )
            })}
          </div>
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

      {loadingOlderMessages && messages.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <Loader2 className="size-3.5 animate-spin" />
            <span>加载历史消息...</span>
          </div>
        </div>
      )}

      {isMultiSelectMode && (
        <div className="absolute inset-x-4 bottom-4 z-30 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-background px-4 py-3 shadow-lg dark:border-border">
          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <CheckSquare className="size-4 text-blue-500" />
            <span className="truncate">已选择 {selectedCount} 条消息</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exitMultiSelect}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <X className="size-4" />
              取消
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || !onDeleteMessages}
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingSelected ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              删除
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="批量删除消息"
        description={`确定要删除选中的 ${selectedCount} 条消息吗？删除后这些消息不会再进入后续上下文。`}
        confirmText="删除"
        onConfirm={handleDeleteSelected}
        loading={deletingSelected}
        icon={Trash2}
      />

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
          <span>有新消息</span>
        </button>
      )}
    </div>
  )
}
