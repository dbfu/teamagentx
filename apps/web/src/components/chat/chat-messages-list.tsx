import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Message } from '@/lib/agent-api'
import { ChatMessage } from './chat-message'
import type { StreamEvent } from '@/stores/socket-store'
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
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  typingAgents: Map<string, { agentId: string; agentName: string; status?: 'pending' | 'executing' | 'cancelled' }[]>
  streamEvents: Map<string, StreamEvent[]>
  mentionAgents: MentionAgent[]
  replyCounts: Map<string, number>
  findReplyTo: (replyMessageId: string | null) => Message | undefined
  onAgentAvatarClick: (agentId: string, agentName: string) => void
  onTypingAgentClick: (messageId: string, agentId: string, agentName: string) => void
  onMentionClick: (agentId: string, agentName: string) => void
  onReplyClick: (messageId: string) => void
  onExecutionDetailClick?: (messageId: string, executionRecordId: string) => void
  onMentionAgent?: (agentId: string, agentName: string) => void
  onDeleteMessage?: (messageId: string) => Promise<void> | void
  onDeleteMessages?: (messageIds: string[]) => Promise<void> | void
  currentUser?: CurrentUser
}

export function ChatMessagesList({
  chatRoomId,
  messages,
  loading,
  messagesEndRef,
  typingAgents,
  streamEvents,
  mentionAgents,
  replyCounts,
  findReplyTo,
  onAgentAvatarClick,
  onTypingAgentClick,
  onMentionClick,
  onReplyClick,
  onExecutionDetailClick,
  onMentionAgent,
  onDeleteMessage,
  onDeleteMessages,
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

  const selectedCount = selectedMessageIds.size

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

  // 滚动事件处理
  const handleScroll = useCallback(() => {
    const nearBottom = checkIsNearBottom()
    setIsNearBottom(nearBottom)

    // 如果用户滚动到底部，隐藏新消息提示
    if (nearBottom && showNewMessageHint) {
      setShowNewMessageHint(false)
    }
  }, [checkIsNearBottom, showNewMessageHint])

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [])

  // 处理消息定位
  useEffect(() => {
    if (scrollToMessageId && messageRefs.current.has(scrollToMessageId)) {
      const messageEl = messageRefs.current.get(scrollToMessageId)
      if (messageEl) {
        // 滚动到消息位置（居中显示）
        messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' })

        // 添加高亮效果
        messageEl.classList.add('message-highlight')

        // 3秒后移除高亮
        setTimeout(() => {
          messageEl.classList.remove('message-highlight')
          setScrollToMessageId(null)
        }, 3000)
      }
    }
  }, [scrollToMessageId, setScrollToMessageId])

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
    const hasNewMessages = messages.length > prevMessageCountRef.current
    prevMessageCountRef.current = messages.length

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
        containerRef.current.scrollTop = savedPosition
      } else {
        // 没有保存的位置，滚动到底部
        scrollToBottom()
      }
    }
  }, [loading, chatRoomId, getScrollPosition, scrollToBottom])

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
        style={{ scrollbarGutter: 'stable' }}
        className={cn(
          messages.length === 0 ? 'relative flex-1' : 'scrollbar-hover relative flex-1 overflow-y-auto py-4',
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
          messages.map((message) => (
            <div
              key={message.id}
              data-message-id={message.id}
              onClick={() => {
                if (isMultiSelectMode) toggleMessageSelection(message.id)
              }}
              className={cn(
                "relative transition-colors",
                isMultiSelectMode && "cursor-pointer",
                selectedMessageIds.has(message.id) && "bg-blue-50/70 dark:bg-blue-950/20"
              )}
              ref={(el) => {
                if (el) {
                  messageRefs.current.set(message.id, el)
                } else {
                  messageRefs.current.delete(message.id)
                }
              }}
            >
              {isMultiSelectMode && (
                <div
                  role="button"
                  tabIndex={0}
                  data-message-row-select-overlay
                  aria-pressed={selectedMessageIds.has(message.id)}
                  aria-label={selectedMessageIds.has(message.id) ? '取消选择消息' : '选择消息'}
                  className="absolute inset-0 z-20 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggleMessageSelection(message.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    e.stopPropagation()
                    toggleMessageSelection(message.id)
                  }}
                />
              )}
              <ChatMessage
                message={message}
                isRight={message.isHuman}
                replyTo={findReplyTo(message.replyMessageId)}
                replyCount={replyCounts.get(message.id) ?? 0}
                typingAgents={typingAgents.get(message.id)}
                streamEvents={streamEvents}
                mentionAgents={mentionAgents}
                currentUser={currentUser}
                hasBeenPlayed={playedIds.has(message.id)}
                onMarkPlayed={() => markVoiceMessagesPlayed(chatRoomId, [message.id])}
                onStopSpeak={stopCurrentPlaybackSession}
                onAgentAvatarClick={onAgentAvatarClick}
                onTypingAgentClick={onTypingAgentClick}
                onMentionClick={onMentionClick}
                onReplyClick={onReplyClick}
                onExecutionDetailClick={onExecutionDetailClick}
                onMentionAgent={onMentionAgent}
                onDeleteMessage={async (messageId) => {
                  await onDeleteMessage?.(messageId)
                  const msg = messages.find((m) => m.id === messageId)
                  if (!msg || msg.isHuman || !msg.agentId) return
                  const agent = allAgentsRef.current.find((a) => a.id === msg.agentId)
                  const vc = agent?.speechConfig ? toVoicePanelConfig(agent.speechConfig) : null
                  if (!vc?.enabled || vc.provider !== 'openai-compatible-tts') return
                  const text = normalizeSpeechText(msg.content)
                  if (!text || text.length > PREWARM_MAX_TEXT_LENGTH) return
                  deleteTtsCache(chatRoomId, buildTtsCacheKey({
                    provider: vc.provider,
                    model: vc.model ?? null,
                    voice: vc.voiceId ?? null,
                    speed: vc.speed ?? 1.3,
                    format: vc.format ?? null,
                    text,
                  }))
                }}
                onStartMultiSelect={startMultiSelect}
                onToggleSelection={toggleMessageSelection}
                selectionMode={isMultiSelectMode}
                isSelected={selectedMessageIds.has(message.id)}
              />
              {isMultiSelectMode && (
                <div className="pointer-events-none absolute left-3 top-4 z-30 flex size-5 items-center justify-center rounded-full border border-blue-500 bg-background text-blue-500 shadow-sm">
                  {selectedMessageIds.has(message.id) && <Check className="size-3.5" />}
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

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
