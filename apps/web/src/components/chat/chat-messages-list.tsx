import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Agent, Message } from '@/lib/agent-api'
import { ChatMessage } from './chat-message'
import { useChatStore } from '@/stores/chat-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { toVoicePanelConfig, type AgentVoicePanelConfig } from '@/lib/agent-speech'
import { deleteTtsCache, loadRoomTtsCache, normalizeSpeechText, prewarmTts, speakText, stopSpeechPlayback, supportsSpeechPlayback } from '@/lib/browser-speech'
import { buildTtsCacheKey, PREWARM_MAX_TEXT_LENGTH } from '@/speech/tts-prefetch-cache'
import { ArrowDown, Check, CheckSquare, Loader2, Trash2, X } from 'lucide-react'
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

type CapturedScrollAnchor = {
  chatRoomId: string
  messageId: string
  offset: number
  scrollTop: number
}

interface ChatMessagesListProps {
  chatRoomId: string  // 群聊 ID，用于保存滚动位置
  messages: Message[]
  loading: boolean
  loadingOlderMessages: boolean
  hasOlderMessages: boolean
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  typingAgents: Map<string, { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled'; startedAt?: number }[]>
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
  isSidePanelOpen?: boolean
  readOnly?: boolean
}

interface MessageRowProps {
  chatRoomId: string
  message: Message
  isVoicePlayed: boolean
  isMultiSelectMode: boolean
  isSelected: boolean
  replyTo?: Message | null
  replyCount: number
  typingAgents?: { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled'; startedAt?: number }[]
  mentionAgents: MentionAgent[]
  currentUser?: CurrentUser
  onSetMessageRef: (messageId: string, element: HTMLDivElement | null) => void
  onMarkVoiceMessagesPlayed: (chatRoomId: string, messageIds: string[]) => void
  onStopSpeak: (messageId: string) => void
  onStartManualSpeak: (messageId: string) => void
  onCompleteManualSpeak: (messageId: string) => void
  onAgentAvatarClick: (agentId: string, agentName: string) => void
  onTypingAgentClick: (messageId: string, agentId: string, agentName: string) => void
  onMentionClick: (agentId: string, agentName: string) => void
  onReplyClick: (messageId: string) => void
  onExecutionDetailClick?: (messageId: string, executionRecordId: string) => void
  onMentionAgent?: (agentId: string, agentName: string) => void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onStartMultiSelect?: (messageId: string) => void
  onToggleSelection: (messageId: string) => void
  copyOnlyContextMenu?: boolean
}

type PreparedAutoSpeakItem = {
  messageId: string
  agentId: string
  text: string
  voiceConfig: AgentVoicePanelConfig
}

const SIDE_PANEL_BOTTOM_LOCK_MS = 1200
const SIDE_PANEL_BOTTOM_LOCK_FRAMES = 75

function logVoiceQueue(event: string, details: Record<string, unknown>): void {
  console.debug(`[voice-queue] ${event}`, details)
  void window.electronAPI?.appendDebugLog?.(`[voice-queue] ${event}`, details)
}

interface PrepareAutoSpeakBatchOptions {
  chatRoomId: string
  messages: Message[]
  agentsList: Agent[]
  handledSet: Set<string>
  queuedIds: Set<string>
  deferredIds: Set<string>
  playedSet: Set<string>
  initialMessageIds: Set<string>
}

interface AutoSpeakQueueStartOptions {
  queueLength: number
  isAutoSpeaking: boolean
  activePlayingMessageId: string | null
}

export function getSequentialAutoSpeakItemsAfterManualMessage({
  chatRoomId,
  completedMessageId,
  messages,
  agentsList,
  queuedIds,
  deferredIds,
  playedSet,
}: {
  chatRoomId: string
  completedMessageId: string
  messages: Message[]
  agentsList: Agent[]
  queuedIds: Set<string>
  deferredIds: Set<string>
  playedSet: Set<string>
}): PreparedAutoSpeakItem[] {
  const completedIndex = messages.findIndex((message) => message.id === completedMessageId)
  if (completedIndex < 0) return []

  const items: PreparedAutoSpeakItem[] = []
  for (const message of messages.slice(completedIndex + 1)) {
    if (message.chatRoomId !== chatRoomId || message.isHuman || !message.agentId || !message.content.trim()) continue
    if (queuedIds.has(message.id) || deferredIds.has(message.id) || playedSet.has(message.id)) continue

    const agent = agentsList.find((item) => item.id === message.agentId)
    if (!agent?.speechConfig) continue
    const voiceConfig = toVoicePanelConfig(agent.speechConfig)
    const normalizedText = normalizeSpeechText(message.content)
    const shouldAutoPlay = voiceConfig.enabled
      && voiceConfig.outputMode === 'auto_final_only'
      && supportsSpeechPlayback(voiceConfig)
      && Boolean(normalizedText)

    if (!shouldAutoPlay) continue

    items.push({
      messageId: message.id,
      agentId: message.agentId,
      text: normalizedText,
      voiceConfig,
    })
  }

  return items
}

export function prepareAutoSpeakBatch({
  chatRoomId,
  messages,
  agentsList,
  handledSet,
  queuedIds,
  deferredIds,
  playedSet,
  initialMessageIds,
}: PrepareAutoSpeakBatchOptions): {
  permanentlySkippedMessageIds: string[]
  prewarmItems: PreparedAutoSpeakItem[]
  queueItems: PreparedAutoSpeakItem[]
} {
  const newMessages = messages.filter(
    (message) => message.chatRoomId === chatRoomId
      && !handledSet.has(message.id)
      && !queuedIds.has(message.id)
      && !deferredIds.has(message.id),
  )

  const permanentlySkippedMessageIds: string[] = []
  const prewarmItems: PreparedAutoSpeakItem[] = []
  const queueItems: PreparedAutoSpeakItem[] = []

  for (const message of newMessages) {
    if (message.isHuman || !message.agentId || !message.content.trim()) {
      permanentlySkippedMessageIds.push(message.id)
      continue
    }

    const agent = agentsList.find((item) => item.id === message.agentId)
    if (!agent?.speechConfig) {
      continue
    }

    const voiceConfig = toVoicePanelConfig(agent.speechConfig)
    const normalizedText = normalizeSpeechText(message.content)

    if (voiceConfig.enabled && voiceConfig.provider === 'openai-compatible-tts') {
      prewarmItems.push({
        messageId: message.id,
        agentId: message.agentId,
        text: message.content,
        voiceConfig,
      })
    }

    if (playedSet.has(message.id)) {
      permanentlySkippedMessageIds.push(message.id)
      continue
    }

    const shouldAutoPlay = voiceConfig.enabled
      && voiceConfig.outputMode === 'auto_final_only'
      && supportsSpeechPlayback(voiceConfig)
      && !initialMessageIds.has(message.id)
      && Boolean(normalizedText)

    if (!shouldAutoPlay) {
      continue
    }

    queueItems.push({
      messageId: message.id,
      agentId: message.agentId,
      text: normalizedText,
      voiceConfig,
    })
  }

  return {
    permanentlySkippedMessageIds,
    prewarmItems,
    queueItems,
  }
}

export function shouldStartAutoSpeakQueue({
  queueLength,
  isAutoSpeaking,
  activePlayingMessageId,
}: AutoSpeakQueueStartOptions): boolean {
  return queueLength > 0 && !isAutoSpeaking && !activePlayingMessageId
}

const MessageRow = memo(function MessageRow({
  chatRoomId,
  message,
  isVoicePlayed,
  isMultiSelectMode,
  isSelected,
  replyTo,
  replyCount,
  typingAgents,
  mentionAgents,
  currentUser,
  onSetMessageRef,
  onMarkVoiceMessagesPlayed,
  onStopSpeak,
  onStartManualSpeak,
  onCompleteManualSpeak,
  onAgentAvatarClick,
  onTypingAgentClick,
  onMentionClick,
  onReplyClick,
  onExecutionDetailClick,
  onMentionAgent,
  onDeleteMessage,
  onStartMultiSelect,
  onToggleSelection,
  copyOnlyContextMenu,
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
        isVoicePlayed={isVoicePlayed}
        isRight={message.isHuman}
        replyTo={replyTo}
        replyCount={replyCount}
        typingAgents={typingAgents}
        mentionAgents={mentionAgents}
        currentUser={currentUser}
        onMarkPlayed={handleMarkPlayed}
        onStopSpeak={onStopSpeak}
        onStartManualSpeak={onStartManualSpeak}
        onCompleteManualSpeak={onCompleteManualSpeak}
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
        copyOnlyContextMenu={copyOnlyContextMenu}
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

export const ChatMessagesList = memo(function ChatMessagesList({
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
  isSidePanelOpen = false,
  readOnly = false,
}: ChatMessagesListProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const scrollToMessageId = useChatStore((s) => s.scrollToMessageId)
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId)
  const forceScrollToBottom = useChatStore((s) => s.forceScrollToBottom)
  const setForceScrollToBottom = useChatStore((s) => s.setForceScrollToBottom)
  const saveScrollPosition = useChatStore((s) => s.saveScrollPosition)
  const getScrollPosition = useChatStore((s) => s.getScrollPosition)
  const saveScrollAnchor = useChatStore((s) => s.saveScrollAnchor)
  const getScrollAnchor = useChatStore((s) => s.getScrollAnchor)
  const allAgents = useChatStore((s) => s.allAgents)
  const playingVoiceMessageId = useChatStore((s) => s.playingVoiceMessageId)
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
  const messagesBelongToCurrentRoom = useMemo(
    () => messages.length === 0 || messages.every((message) => message.chatRoomId === chatRoomId),
    [chatRoomId, messages],
  )

  // 是否显示新消息提示
  const [showNewMessageHint, setShowNewMessageHint] = useState(false)
  const [showScrollToBottomHint, setShowScrollToBottomHint] = useState(false)
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false)
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingSelected, setDeletingSelected] = useState(false)
  // 上一次消息数量，用于检测新消息
  const prevMessageCountRef = useRef(messages.length)
  const prevLastMessageIdRef = useRef<string | null>(messages[messages.length - 1]?.id ?? null)
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
  const userScrollIntentUntilRef = useRef(0)
  const userLeavingBottomUntilRef = useRef(0)
  const isNearBottomRef = useRef(true)
  const pendingScrollToBottomFrameRef = useRef<number | null>(null)
  const suppressScrollSaveUntilRef = useRef(0)
  const pendingScrollSaveFrameRef = useRef<number | null>(null)
  const latestScrollAnchorRef = useRef<CapturedScrollAnchor | null>(null)
  const wasSidePanelOpenRef = useRef(isSidePanelOpen)
  const sidePanelBottomLockUntilRef = useRef(0)

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
  const virtualTotalSize = rowVirtualizer.getTotalSize()

  const exitMultiSelect = useCallback(() => {
    setIsMultiSelectMode(false)
    setSelectedMessageIds(new Set())
  }, [])

  const startMultiSelect = useCallback((messageId: string) => {
    if (readOnly) return
    setIsMultiSelectMode(true)
    setSelectedMessageIds(new Set([messageId]))
  }, [readOnly])

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
      toast.success(t('chat.batchDeleteSuccess', { count: selectedMessageIds.size }))
      setDeleteDialogOpen(false)
      exitMultiSelect()
    } catch (error) {
      console.error('Failed to delete selected messages:', error)
      toast.error(t('chat.batchDeleteFailed'))
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

  const captureScrollAnchor = useCallback((): CapturedScrollAnchor | null => {
    const container = containerRef.current
    if (!container) return null

    const containerRect = container.getBoundingClientRect()
    let domAnchor: { messageId: string; offset: number; scrollTop: number; top: number; strategy: 'top-visible' | 'partially-visible' } | null = null
    let partialDomAnchor: { messageId: string; offset: number; scrollTop: number; top: number; strategy: 'top-visible' | 'partially-visible' } | null = null
    for (const [messageId, element] of messageRefs.current) {
      if (!element || !messageIndexById.has(messageId)) continue

      const rect = element.getBoundingClientRect()
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue

      const offset = rect.top - containerRect.top
      if (offset >= 0) {
        if (!domAnchor || offset < domAnchor.offset) {
          domAnchor = {
            messageId,
            offset,
            scrollTop: container.scrollTop,
            top: rect.top,
            strategy: 'top-visible',
          }
        }
        continue
      }

      if (!partialDomAnchor || rect.top > partialDomAnchor.top) {
        partialDomAnchor = {
          messageId,
          offset,
          scrollTop: container.scrollTop,
          top: rect.top,
          strategy: 'partially-visible',
        }
      }
    }
    domAnchor = domAnchor ?? partialDomAnchor

    if (domAnchor) {
      return {
        chatRoomId,
        messageId: domAnchor.messageId,
        offset: domAnchor.offset,
        scrollTop: domAnchor.scrollTop,
      }
    }

    const anchorItem = rowVirtualizer
      .getVirtualItems()
      .find((item) => item.end >= container.scrollTop)
    const anchorMessage = anchorItem ? messages[anchorItem.index] : null
    if (!anchorItem || !anchorMessage) {
      return null
    }

    return {
      chatRoomId,
      messageId: anchorMessage.id,
      offset: anchorItem.start - container.scrollTop,
      scrollTop: container.scrollTop,
    }
  }, [chatRoomId, messageIndexById, messages, rowVirtualizer])

  const saveLatestScrollAnchor = useCallback((latest: CapturedScrollAnchor) => {
    saveScrollAnchor(latest.chatRoomId, {
      messageId: latest.messageId,
      offset: latest.offset,
      scrollTop: latest.scrollTop,
    })
  }, [saveScrollAnchor])

  const flushLatestScrollAnchor = useCallback((roomId: string) => {
    if (pendingScrollSaveFrameRef.current !== null) {
      cancelAnimationFrame(pendingScrollSaveFrameRef.current)
      pendingScrollSaveFrameRef.current = null
    }

    const latest = latestScrollAnchorRef.current
    if (latest?.chatRoomId === roomId) {
      saveLatestScrollAnchor(latest)
    }
  }, [saveLatestScrollAnchor])

  const persistCurrentScrollState = useCallback(() => {
    const container = containerRef.current
    if (!container || !messagesBelongToCurrentRoom) return

    saveScrollPosition(chatRoomId, container.scrollTop)
    const scrollAnchor = captureScrollAnchor()
    if (scrollAnchor) {
      latestScrollAnchorRef.current = scrollAnchor
      saveLatestScrollAnchor(scrollAnchor)
    }
  }, [captureScrollAnchor, chatRoomId, messagesBelongToCurrentRoom, saveLatestScrollAnchor, saveScrollPosition])

  const suppressProgrammaticScrollSave = useCallback((durationMs = 500) => {
    suppressScrollSaveUntilRef.current = Math.max(suppressScrollSaveUntilRef.current, Date.now() + durationMs)
  }, [])

  const cancelPendingScrollToBottom = useCallback(() => {
    if (pendingScrollToBottomFrameRef.current !== null) {
      cancelAnimationFrame(pendingScrollToBottomFrameRef.current)
      pendingScrollToBottomFrameRef.current = null
    }
  }, [])

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

  const markUserScrollIntent = useCallback((options?: { cancelAutoBottom?: boolean }) => {
    hasUserScrollIntentRef.current = true
    const durationMs = 1600
    const intentUntil = Date.now() + durationMs
    userScrollIntentUntilRef.current = Math.max(userScrollIntentUntilRef.current, intentUntil)
    if (options?.cancelAutoBottom) {
      userLeavingBottomUntilRef.current = Math.max(userLeavingBottomUntilRef.current, intentUntil)
      sidePanelBottomLockUntilRef.current = 0
      cancelPendingScrollToBottom()
    }
  }, [cancelPendingScrollToBottom])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    markUserScrollIntent({ cancelAutoBottom: true })
  }, [markUserScrollIntent])

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    markUserScrollIntent({ cancelAutoBottom: event.deltaY < 0 })
    if (event.deltaY < 0) {
      tryLoadOlderMessages()
    }
  }, [markUserScrollIntent, tryLoadOlderMessages])

  const handleTouchStart = useCallback(() => {
    markUserScrollIntent({ cancelAutoBottom: true })
  }, [markUserScrollIntent])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key) || event.key === ' ') {
      markUserScrollIntent({
        cancelAutoBottom: ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey),
      })
    }
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
      tryLoadOlderMessages()
    }
  }, [markUserScrollIntent, tryLoadOlderMessages])

  // 滚动事件处理
  const handleScroll = useCallback(() => {
    tryLoadOlderMessages()
    const nearBottom = checkIsNearBottom()
    isNearBottomRef.current = nearBottom

    const now = Date.now()
    const hasRecentUserScroll = hasUserScrollIntentRef.current || now <= userScrollIntentUntilRef.current
    const canSaveCurrentRoom = hasRestoredPositionRef.current
      && prevChatRoomIdRef.current === chatRoomId
      && messagesBelongToCurrentRoom
    if (canSaveCurrentRoom && hasRecentUserScroll && containerRef.current) {
      saveScrollPosition(chatRoomId, containerRef.current.scrollTop)
    }

    const canSaveScroll = canSaveCurrentRoom && now >= suppressScrollSaveUntilRef.current
    if (canSaveScroll) {
      if (now <= userScrollIntentUntilRef.current) {
        userScrollIntentUntilRef.current = now + 800
      }
      const scrollAnchor = captureScrollAnchor()
      if (scrollAnchor) {
        latestScrollAnchorRef.current = scrollAnchor
      }
      if (pendingScrollSaveFrameRef.current === null) {
        pendingScrollSaveFrameRef.current = requestAnimationFrame(() => {
          pendingScrollSaveFrameRef.current = null
          const currentAnchor = captureScrollAnchor()
          if (currentAnchor) {
            latestScrollAnchorRef.current = currentAnchor
          }
          const latest = latestScrollAnchorRef.current
          if (latest) {
            saveLatestScrollAnchor(latest)
          }
        })
      }
    }

    if (nearBottom) {
      if (showNewMessageHint) {
        setShowNewMessageHint(false)
      }
      if (showScrollToBottomHint) {
        setShowScrollToBottomHint(false)
      }
    } else if (hasRecentUserScroll && messages.length > 0 && !showScrollToBottomHint) {
      setShowScrollToBottomHint(true)
    }
  }, [captureScrollAnchor, chatRoomId, checkIsNearBottom, messages.length, messagesBelongToCurrentRoom, saveLatestScrollAnchor, saveScrollPosition, showNewMessageHint, showScrollToBottomHint, tryLoadOlderMessages])

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

      suppressProgrammaticScrollSave()
      rowVirtualizer.scrollToOffset(Math.max(0, offsetInfo[0] - anchor.offset), { behavior: 'auto' })
      prependAnchorRef.current = null
    })

    return () => cancelAnimationFrame(animationFrame)
  }, [loadingOlderMessages, messageIndexById, messages.length, rowVirtualizer, suppressProgrammaticScrollSave])

  // 滚动到底部
  const scrollToBottom = useCallback((options?: { save?: boolean; frames?: number; respectUserScroll?: boolean }) => {
    if (messages.length === 0) return

    cancelPendingScrollToBottom()

    const alignToBottom = () => {
      const container = containerRef.current
      if (!container) return
      suppressProgrammaticScrollSave()
      rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior: 'auto' })
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
      container.scrollTop = container.scrollHeight
      isNearBottomRef.current = true
    }

    alignToBottom()

    let frame = 0
    const maxFrames = options?.frames ?? 3
    const tick = () => {
      pendingScrollToBottomFrameRef.current = null
      if (options?.respectUserScroll && Date.now() <= userLeavingBottomUntilRef.current) {
        return
      }

      alignToBottom()
      frame += 1
      if (frame < maxFrames) {
        pendingScrollToBottomFrameRef.current = requestAnimationFrame(tick)
      } else if (options?.save) {
        const scrollAnchor = captureScrollAnchor()
        if (scrollAnchor) {
          latestScrollAnchorRef.current = scrollAnchor
          saveLatestScrollAnchor(scrollAnchor)
        }
      }
    }
    pendingScrollToBottomFrameRef.current = requestAnimationFrame(tick)
  }, [cancelPendingScrollToBottom, captureScrollAnchor, chatRoomId, messages.length, messagesEndRef, rowVirtualizer, saveLatestScrollAnchor, suppressProgrammaticScrollSave])

  useLayoutEffect(() => {
    const wasSidePanelOpen = wasSidePanelOpenRef.current
    const wasPinnedToBottom = isNearBottomRef.current || checkIsNearBottom()
    const userIsLeavingBottom = Date.now() <= userLeavingBottomUntilRef.current
    wasSidePanelOpenRef.current = isSidePanelOpen

    if (!isSidePanelOpen) {
      sidePanelBottomLockUntilRef.current = 0
      return
    }

    // 有待定位的消息时，不要把列表锁定到底部，让消息定位逻辑独占滚动
    if (scrollToMessageId) return

    if (
      wasSidePanelOpen
      || !wasPinnedToBottom
      || userIsLeavingBottom
      || !messagesBelongToCurrentRoom
      || !hasRestoredPositionRef.current
    ) {
      return
    }

    sidePanelBottomLockUntilRef.current = Date.now() + SIDE_PANEL_BOTTOM_LOCK_MS
    scrollToBottom({ save: true, frames: SIDE_PANEL_BOTTOM_LOCK_FRAMES })
    setShowNewMessageHint(false)
    setShowScrollToBottomHint(false)
  }, [checkIsNearBottom, isSidePanelOpen, messagesBelongToCurrentRoom, scrollToBottom, scrollToMessageId])

  useLayoutEffect(() => {
    if (
      !isSidePanelOpen
      || scrollToMessageId
      || Date.now() > sidePanelBottomLockUntilRef.current
      || !messagesBelongToCurrentRoom
      || !hasRestoredPositionRef.current
    ) {
      return
    }

    scrollToBottom({ save: true, frames: SIDE_PANEL_BOTTOM_LOCK_FRAMES })
    setShowNewMessageHint(false)
    setShowScrollToBottomHint(false)
  }, [isSidePanelOpen, messagesBelongToCurrentRoom, scrollToBottom, scrollToMessageId, virtualTotalSize])

  useEffect(() => {
    if (!isSidePanelOpen || typeof ResizeObserver === 'undefined') return

    const container = containerRef.current
    if (!container) return

    let frameId: number | null = null
    const keepBottomIfLocked = () => {
      frameId = null
      if (
        Date.now() > sidePanelBottomLockUntilRef.current
        || !messagesBelongToCurrentRoom
        || !hasRestoredPositionRef.current
      ) {
        return
      }

      scrollToBottom({ save: true, frames: SIDE_PANEL_BOTTOM_LOCK_FRAMES })
      setShowNewMessageHint(false)
      setShowScrollToBottomHint(false)
    }

    const observer = new ResizeObserver(() => {
      if (frameId !== null) return
      frameId = requestAnimationFrame(keepBottomIfLocked)
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [isSidePanelOpen, messagesBelongToCurrentRoom, scrollToBottom])

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

    // 容器有 py-4 的 padding，需要额外偏移让消息头部完全显示
    const paddingTopOffset = 16

    // 列表可能刚挂载（如从任务看板切到详情面板），行高尚未测量完，
    // 要等待渲染完成后再定位，使用延时确保虚拟列表测量完成
    let frame = 0
    const tick = () => {
      const offsetInfo = rowVirtualizer.getOffsetForIndex(messageIndex, 'start')
      if (offsetInfo) {
        suppressProgrammaticScrollSave()
        // 减去 padding-top，让消息头部完全显示
        rowVirtualizer.scrollToOffset(Math.max(0, offsetInfo[0] - paddingTopOffset), { behavior: 'auto' })
      }
      if (highlightMessage(scrollToMessageId)) return
      frame += 1
      if (frame < 24) {
        // 延时等待渲染，每隔 50ms 检查一次
        setTimeout(tick, 50)
      }
    }
    // 初始延时 100ms，等待列表渲染
    setTimeout(tick, 100)
  }, [highlightMessage, messageIndexById, rowVirtualizer, scrollToMessageId, suppressProgrammaticScrollSave])

  useEffect(() => {
    const pendingId = pendingHighlightMessageIdRef.current
    if (pendingId) {
      highlightMessage(pendingId)
    }
  }, [highlightMessage, virtualItems])

  // 处理强制滚动到底部（用户发送消息后）
  useEffect(() => {
    if (forceScrollToBottom) {
      scrollToBottom({ save: true })
      setShowNewMessageHint(false)
      setShowScrollToBottomHint(false)
      setForceScrollToBottom(false)
    }
  }, [chatRoomId, forceScrollToBottom, messages.length, scrollToBottom, setForceScrollToBottom])

  // 检测新消息
  useEffect(() => {
    const currentLastMessageId = messages[messages.length - 1]?.id ?? null
    if (messages.length === 0) {
      prevMessageCountRef.current = 0
      prevLastMessageIdRef.current = null
      isNearBottomRef.current = true
      userLeavingBottomUntilRef.current = 0
      sidePanelBottomLockUntilRef.current = 0
      setShowNewMessageHint(false)
      setShowScrollToBottomHint(false)
      return
    }

    if (prevChatRoomIdRef.current !== chatRoomId) {
      prevMessageCountRef.current = messages.length
      prevLastMessageIdRef.current = currentLastMessageId
      return
    }

    if (!messagesBelongToCurrentRoom || !hasRestoredPositionRef.current) {
      prevMessageCountRef.current = messages.length
      prevLastMessageIdRef.current = currentLastMessageId
      return
    }

    const previousMessageCount = prevMessageCountRef.current
    const previousLastMessageId = prevLastMessageIdRef.current
    const hasNewMessages = messages.length > previousMessageCount && currentLastMessageId !== previousLastMessageId
    prevMessageCountRef.current = messages.length
    prevLastMessageIdRef.current = currentLastMessageId

    if (hasNewMessages) {
      if (isNearBottomRef.current && Date.now() > userLeavingBottomUntilRef.current) {
        // 在底部，自动滚动
        scrollToBottom({ save: true, respectUserScroll: true })
      } else {
        // 不在底部，显示新消息提示
        setShowNewMessageHint(true)
      }
    }
  }, [chatRoomId, messages, messagesBelongToCurrentRoom, scrollToBottom])

  // 内容高度变化（如消息展开/收起）时，若底部已重新可见，则清除新消息提示。
  // 收起会导致 scrollHeight 变小但不会触发 scroll 事件，isNearBottomRef 会保持过期值，
  // 这里根据最新高度重新判断，避免新内容已经在可视范围内却仍提示。
  useEffect(() => {
    if (!showNewMessageHint && !showScrollToBottomHint) return
    if (checkIsNearBottom()) {
      isNearBottomRef.current = true
      setShowNewMessageHint(false)
      setShowScrollToBottomHint(false)
    }
  }, [virtualTotalSize, showNewMessageHint, showScrollToBottomHint, checkIsNearBottom])

  // typingAgents 变化时，如果在底部也滚动
  useEffect(() => {
    if (
      prevChatRoomIdRef.current === chatRoomId
      && messagesBelongToCurrentRoom
      && hasRestoredPositionRef.current
      && isNearBottomRef.current
      && Date.now() > userLeavingBottomUntilRef.current
      && typingAgents.size > 0
    ) {
      scrollToBottom({ respectUserScroll: true })
    }
  }, [chatRoomId, typingAgents, messagesBelongToCurrentRoom, scrollToBottom])

  // 检测群聊切换，重置恢复标记
  useEffect(() => {
    if (prevChatRoomIdRef.current !== chatRoomId) {
      const previousChatRoomId = prevChatRoomIdRef.current
      cancelPendingScrollToBottom()
      flushLatestScrollAnchor(previousChatRoomId)
      prevChatRoomIdRef.current = chatRoomId
      hasRestoredPositionRef.current = false
      initialMessageIdsRef.current = new Set()
      initialCapturedRef.current = false
      recentlyStoppedVoiceMessageIdsRef.current.clear()
      hasUserScrollIntentRef.current = false
      userScrollIntentUntilRef.current = 0
      userLeavingBottomUntilRef.current = 0
      prependAnchorRef.current = null
      pendingHighlightMessageIdRef.current = null
      latestScrollAnchorRef.current = null
      prevMessageCountRef.current = messages.length
      prevLastMessageIdRef.current = messages[messages.length - 1]?.id ?? null
      // 重置底部状态
      isNearBottomRef.current = true
      setShowNewMessageHint(false)
      setShowScrollToBottomHint(false)
      exitMultiSelect()
    }
  }, [cancelPendingScrollToBottom, chatRoomId, exitMultiSelect, flushLatestScrollAnchor, messages])

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

  useEffect(() => {
    window.addEventListener('pagehide', persistCurrentScrollState)
    window.addEventListener('beforeunload', persistCurrentScrollState)
    return () => {
      window.removeEventListener('pagehide', persistCurrentScrollState)
      window.removeEventListener('beforeunload', persistCurrentScrollState)
      cancelPendingScrollToBottom()
    }
  }, [cancelPendingScrollToBottom, persistCurrentScrollState])

  // 消息加载完成后恢复上次滚动位置（只在切换群聊后的首次加载时执行）
  useEffect(() => {
    if (!loading && messages.length > 0 && messagesBelongToCurrentRoom && containerRef.current && !hasRestoredPositionRef.current) {
      hasRestoredPositionRef.current = true
      // 有待定位的消息时，交给消息定位逻辑滚动，不恢复上次位置（避免抢滚动）
      if (scrollToMessageId) return
      const savedAnchor = getScrollAnchor(chatRoomId)
      if (savedAnchor) {
        const anchorIndex = messageIndexById.get(savedAnchor.messageId)
        if (anchorIndex !== undefined) {
          suppressProgrammaticScrollSave()
          rowVirtualizer.scrollToIndex(anchorIndex, { align: 'start', behavior: 'auto' })

          let attempts = 0
          let alignedFrames = 0
          let restoreFrame: number | null = null
          const alignToAnchor = () => {
            attempts += 1
            const container = containerRef.current
            const messageEl = messageRefs.current.get(savedAnchor.messageId)
            if (container && messageEl) {
              suppressProgrammaticScrollSave()
              messageEl.scrollIntoView({ block: 'start', behavior: 'auto' })
              container.scrollTop = Math.max(0, container.scrollTop - savedAnchor.offset)
              alignedFrames += 1
              if (alignedFrames < 3) {
                restoreFrame = requestAnimationFrame(alignToAnchor)
              }
              return
            }

            const offsetInfo = rowVirtualizer.getOffsetForIndex(anchorIndex, 'start')
            if (offsetInfo) {
              const targetOffset = Math.max(0, offsetInfo[0] - savedAnchor.offset)
              suppressProgrammaticScrollSave()
              rowVirtualizer.scrollToOffset(targetOffset, { behavior: 'auto' })
              alignedFrames += 1
              if (alignedFrames < 3) {
                restoreFrame = requestAnimationFrame(alignToAnchor)
              }
              return
            }

            if (attempts >= 6) {
              suppressProgrammaticScrollSave()
              rowVirtualizer.scrollToOffset(savedAnchor.scrollTop, { behavior: 'auto' })
              return
            }

            restoreFrame = requestAnimationFrame(alignToAnchor)
          }

          restoreFrame = requestAnimationFrame(alignToAnchor)
          return () => {
            if (restoreFrame !== null) {
              cancelAnimationFrame(restoreFrame)
            }
          }
        }
      }

      const savedPosition = getScrollPosition(chatRoomId)
      if (savedPosition !== null) {
        // 恢复滚动位置
        suppressProgrammaticScrollSave()
        rowVirtualizer.scrollToOffset(savedPosition, { behavior: 'auto' })
      } else {
        // 没有保存的位置，滚动到底部
        scrollToBottom()
      }
    }
  }, [chatRoomId, getScrollAnchor, getScrollPosition, loading, messageIndexById, messages.length, messagesBelongToCurrentRoom, rowVirtualizer, scrollToBottom, scrollToMessageId, suppressProgrammaticScrollSave])

  // 捕获进入房间时的初始消息 ID，这些消息不走自动播放
  useEffect(() => {
    if (!loading && messagesBelongToCurrentRoom && !initialCapturedRef.current && messages.length > 0) {
      initialCapturedRef.current = true
      for (const m of messages) initialMessageIdsRef.current.add(m.id)
    }
  }, [loading, chatRoomId, messages, messagesBelongToCurrentRoom])

  // 进入群聊时先从 IDB 加载缓存，再批量预热未缓存的旧消息（每个 room 只触发一次）
  useEffect(() => {
    if (loading || !messagesBelongToCurrentRoom || messages.length === 0 || allAgents.length === 0) return
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
  }, [chatRoomId, loading, messages, messagesBelongToCurrentRoom, allAgents])

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
    logVoiceQueue('process:start', {
      chatRoomId,
      runId,
      queueLength: speechQueueRef.current.length,
      playingVoiceMessageId: useChatStore.getState().playingVoiceMessageId,
    })
    while (speechQueueRef.current.length > 0) {
      if (runId !== speechRunIdRef.current) {
        logVoiceQueue('process:abort-runid-changed', {
          chatRoomId,
          runId,
          latestRunId: speechRunIdRef.current,
        })
        break
      }
      const item = speechQueueRef.current.shift()!
      // 避免重复播报：在 shift 后再次检查 playedIds
      if (playedIdsRef.current.has(item.messageId)) {
        queuedVoiceMessageIdsRef.current.delete(item.messageId)
        logVoiceQueue('process:skip-played', {
          chatRoomId,
          messageId: item.messageId,
        })
        continue
      }
      setPlayingVoiceMessageId(item.messageId)
      logVoiceQueue('process:item-start', {
        chatRoomId,
        runId,
        messageId: item.messageId,
        remainingQueueLength: speechQueueRef.current.length,
      })
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
      let playbackStarted = false
      const markPlaybackStarted = () => {
        if (playbackStarted) return
        playbackStarted = true
        markVoiceMessagesHandled(chatRoomId, [item.messageId])
        markVoiceMessagesPlayed(chatRoomId, [item.messageId])
        logVoiceQueue('process:item-playback-start', {
          chatRoomId,
          runId,
          messageId: item.messageId,
        })
      }
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
          onPlaybackStart: markPlaybackStarted,
        })
        playedSuccessfully = true
        logVoiceQueue('process:item-complete', {
          chatRoomId,
          runId,
          messageId: item.messageId,
        })
      } catch (e) {
        if (e instanceof Error && e.message === 'speech_interrupted') {
          interrupted = true
        } else if (e instanceof Error && (e as Error & { cancelled?: boolean }).cancelled) {
          interrupted = true
        }
        logVoiceQueue('process:item-error', {
          chatRoomId,
          runId,
          messageId: item.messageId,
          interrupted,
          error: e instanceof Error ? e.message : String(e),
        })
      }
      queuedVoiceMessageIdsRef.current.delete(item.messageId)
      if (interrupted || runId !== speechRunIdRef.current) {
        if (!playbackStarted) {
          deferredVoiceMessageIdsRef.current.add(item.messageId)
        } else {
          deferredVoiceMessageIdsRef.current.delete(item.messageId)
        }
        logVoiceQueue('process:item-break', {
          chatRoomId,
          runId,
          messageId: item.messageId,
          interrupted,
          playbackStarted,
          deferredSize: deferredVoiceMessageIdsRef.current.size,
        })
        break
      }
      if (playedSuccessfully) {
        deferredVoiceMessageIdsRef.current.delete(item.messageId)
      } else {
        if (!playbackStarted) {
          deferredVoiceMessageIdsRef.current.add(item.messageId)
        } else {
          deferredVoiceMessageIdsRef.current.delete(item.messageId)
        }
      }
    }
    if (speechRunIdRef.current === runId) {
      setPlayingVoiceMessageId(null)
      isSpeakingRef.current = false
      logVoiceQueue('process:end', {
        chatRoomId,
        runId,
        queueLength: speechQueueRef.current.length,
        deferredSize: deferredVoiceMessageIdsRef.current.size,
      })
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

  const pauseAutoPlaybackForManualStart = useCallback((messageId: string) => {
    speechRunIdRef.current += 1
    isSpeakingRef.current = false
    speechQueueRef.current = []
    queuedVoiceMessageIdsRef.current.clear()

    const currentPlayingMessageId = useChatStore.getState().playingVoiceMessageId
    const shouldStopActivePlayback = Boolean(currentPlayingMessageId && currentPlayingMessageId !== messageId)
    if (currentPlayingMessageId && currentPlayingMessageId !== messageId) {
      deferredVoiceMessageIdsRef.current.add(currentPlayingMessageId)
      recentlyStoppedVoiceMessageIdsRef.current.set(currentPlayingMessageId, Date.now())
    }

    if (shouldStopActivePlayback) {
      stopSpeechPlayback()
    }
    setPlayingVoiceMessageId(null)
    logVoiceQueue('manual:start', {
      chatRoomId,
      messageId,
      currentPlayingMessageId,
      shouldStopActivePlayback,
      deferredSize: deferredVoiceMessageIdsRef.current.size,
    })
  }, [setPlayingVoiceMessageId])

  const resumeAutoPlaybackAfterManualSpeak = useCallback((completedMessageId: string) => {
    const queueItems = getSequentialAutoSpeakItemsAfterManualMessage({
      chatRoomId,
      completedMessageId,
      messages,
      agentsList: allAgentsRef.current,
      queuedIds: queuedVoiceMessageIdsRef.current,
      deferredIds: deferredVoiceMessageIdsRef.current,
      playedSet: playedIdsRef.current,
    })

    for (const item of queueItems) {
      queuedVoiceMessageIdsRef.current.add(item.messageId)
      speechQueueRef.current.push(item)
    }
    logVoiceQueue('manual:resume', {
      chatRoomId,
      completedMessageId,
      queueItems: queueItems.map((item) => item.messageId),
      queueLength: speechQueueRef.current.length,
      playingVoiceMessageId: useChatStore.getState().playingVoiceMessageId,
    })

    if (shouldStartAutoSpeakQueue({
      queueLength: speechQueueRef.current.length,
      isAutoSpeaking: isSpeakingRef.current,
      activePlayingMessageId: useChatStore.getState().playingVoiceMessageId,
    })) {
      void processQueue()
    }
  }, [chatRoomId, messages, processQueue])

  useEffect(() => {
    if (loading) return
    if (document.hidden) return

    const { permanentlySkippedMessageIds, prewarmItems, queueItems } = prepareAutoSpeakBatch({
      chatRoomId,
      messages,
      agentsList: allAgentsRef.current,
      handledSet: handledIdsRef.current,
      queuedIds: queuedVoiceMessageIdsRef.current,
      deferredIds: deferredVoiceMessageIdsRef.current,
      playedSet: playedIdsRef.current,
      initialMessageIds: initialMessageIdsRef.current,
    })
    if (permanentlySkippedMessageIds.length > 0) {
      markVoiceMessagesHandled(chatRoomId, permanentlySkippedMessageIds)
    }

    for (const item of prewarmItems) {
      prewarmTts({
        text: item.text,
        provider: item.voiceConfig.provider,
        model: item.voiceConfig.model,
        voiceId: item.voiceConfig.voiceId,
        rate: item.voiceConfig.speed,
        format: item.voiceConfig.format ?? undefined,
        agentId: item.agentId,
        chatRoomId,
      })
    }

    if (queueItems.length === 0) return

    for (const item of queueItems) {
      queuedVoiceMessageIdsRef.current.add(item.messageId)
      speechQueueRef.current.push(item)
    }

    if (shouldStartAutoSpeakQueue({
      queueLength: speechQueueRef.current.length,
      isAutoSpeaking: isSpeakingRef.current,
      activePlayingMessageId: playingVoiceMessageId,
    })) {
      void processQueue()
    }
  }, [chatRoomId, loading, markVoiceMessagesHandled, messages, playingVoiceMessageId, processQueue, visibilityVersion])

  useEffect(() => {
    if (loading) return
    if (document.hidden) return
    if (!shouldStartAutoSpeakQueue({
      queueLength: speechQueueRef.current.length,
      isAutoSpeaking: isSpeakingRef.current,
      activePlayingMessageId: playingVoiceMessageId,
    })) {
      return
    }
    void processQueue()
  }, [loading, playingVoiceMessageId, processQueue, visibilityVersion])

  // 组件卸载时保存当前滚动位置
  useEffect(() => {
    return () => {
      flushLatestScrollAnchor(chatRoomId)
    }
  }, [chatRoomId, flushLatestScrollAnchor])

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
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
            {t('chat.loadingMessages')}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-400 select-none">
            {t('chat.noMessages')}
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${virtualTotalSize}px` }}
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
                    isVoicePlayed={playedIds.has(message.id)}
                    isMultiSelectMode={isMultiSelectMode}
                    isSelected={selectedMessageIds.has(message.id)}
                    replyTo={message.replyMessageId ? messageById.get(message.replyMessageId) : null}
                    replyCount={replyCountsByMessageId.get(message.id) ?? 0}
                    typingAgents={typingAgents.get(message.id)}
                    mentionAgents={mentionAgents}
                    currentUser={currentUser}
                    onSetMessageRef={handleSetMessageRef}
                    onMarkVoiceMessagesPlayed={markVoiceMessagesPlayed}
                    onStopSpeak={stopCurrentPlaybackSession}
                    onStartManualSpeak={pauseAutoPlaybackForManualStart}
                    onCompleteManualSpeak={resumeAutoPlaybackAfterManualSpeak}
                    onAgentAvatarClick={onAgentAvatarClick}
                    onTypingAgentClick={onTypingAgentClick}
                    onMentionClick={onMentionClick}
                    onReplyClick={onReplyClick}
                    onExecutionDetailClick={onExecutionDetailClick}
                    onMentionAgent={onMentionAgent}
                    onDeleteMessage={readOnly ? undefined : handleDeleteMessage}
                    onStartMultiSelect={readOnly ? undefined : startMultiSelect}
                    onToggleSelection={toggleMessageSelection}
                    copyOnlyContextMenu={readOnly}
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
            <span>{t('chat.loadingHistoryMessages')}</span>
          </div>
        </div>
      )}

      {!readOnly && isMultiSelectMode && (
        <div className="absolute inset-x-4 bottom-4 z-30 flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-background px-4 py-3 shadow-lg dark:border-border">
          <div className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <CheckSquare className="size-4 text-blue-500" />
            <span className="truncate">{t('chat.selectedCount', { count: selectedCount })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exitMultiSelect}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <X className="size-4" />
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={selectedCount === 0 || !onDeleteMessages}
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-2 text-sm text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingSelected ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {t('common.delete')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('chat.batchDeleteMessagesTitle')}
        description={t('chat.batchDeleteMessagesDesc', { count: selectedCount })}
        confirmText={t('common.delete')}
        onConfirm={handleDeleteSelected}
        loading={deletingSelected}
        icon={Trash2}
      />

      {/* 新消息提示 */}
      {messages.length > 0 && showNewMessageHint && (
        <button
          onClick={() => {
            scrollToBottom({ save: true })
            setShowNewMessageHint(false)
            setShowScrollToBottomHint(false)
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-blue-500 px-4 py-1.5 text-sm text-white shadow-lg hover:bg-blue-600 transition-colors"
        >
          <ArrowDown className="size-4 animate-bounce" />
          <span>{t('chat.newMessagesHint')}</span>
        </button>
      )}

      {messages.length > 0 && !showNewMessageHint && showScrollToBottomHint && (
        <button
          type="button"
          aria-label={t('chat.scrollToBottom')}
          onClick={() => {
            scrollToBottom({ save: true })
            setShowScrollToBottomHint(false)
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full border border-gray-200 bg-background px-3 py-1.5 text-sm text-foreground shadow-lg transition-colors hover:bg-gray-50 dark:border-border dark:hover:bg-muted"
        >
          <ArrowDown className="size-4" />
          <span>{t('chat.scrollToBottom')}</span>
        </button>
      )}
    </div>
  )
})
