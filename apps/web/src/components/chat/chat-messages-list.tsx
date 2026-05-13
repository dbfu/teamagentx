import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Message } from '@/lib/agent-api'
import { ChatMessage } from './chat-message'
import type { StreamEvent } from '@/stores/socket-store'
import { useChatStore } from '@/stores/chat-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { normalizeSpeechText, speakTextWithBrowserSpeech, supportsBrowserSpeechSynthesis } from '@/lib/browser-speech'

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
  const speechQueueRef = useRef<Array<{ messageId: string; text: string; voiceId: string | null; speed: number; volume: number }>>([])
  const isSpeakingRef = useRef(false)
  const handledIds = useMemo(
    () => new Set(handledVoiceMessageIdsByRoom[chatRoomId] ?? []),
    [chatRoomId, handledVoiceMessageIdsByRoom],
  )
  const playedIds = useMemo(
    () => new Set(playedVoiceMessageIdsByRoom[chatRoomId] ?? []),
    [chatRoomId, playedVoiceMessageIdsByRoom],
  )

  // 是否在底部附近（距离底部 100px 以内算"在底部"）
  const [isNearBottom, setIsNearBottom] = useState(true)
  // 是否显示新消息提示
  const [showNewMessageHint, setShowNewMessageHint] = useState(false)
  // 上一次消息数量，用于检测新消息
  const prevMessageCountRef = useRef(messages.length)
  // 记录上一次的群聊 ID，用于检测群聊切换
  const prevChatRoomIdRef = useRef(chatRoomId)
  // 是否已完成初始滚动位置恢复（切换群聊时重置）
  const hasRestoredPositionRef = useRef(false)

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
      // 重置底部状态
      setIsNearBottom(true)
      setShowNewMessageHint(false)
    }
  }, [chatRoomId])

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

  // 切换房间时取消正在播报的语音（已播 ID 保留，不清空）
  useEffect(() => {
    if (supportsBrowserSpeechSynthesis()) {
      window.speechSynthesis.cancel()
      setPlayingVoiceMessageId(null)
    }
  }, [chatRoomId, setPlayingVoiceMessageId])

  useEffect(() => {
    if (loading) return
    if (!supportsBrowserSpeechSynthesis()) return

    const hasInitializedRoom = Object.prototype.hasOwnProperty.call(handledVoiceMessageIdsByRoom, chatRoomId)

    // 首次进入该房间：把当前已加载消息标记为已处理/已播，刷新后不会从头再播
    if (!hasInitializedRoom) {
      const initialMessageIds = messages.map((message) => message.id)
      markVoiceMessagesHandled(chatRoomId, initialMessageIds)
      markVoiceMessagesPlayed(chatRoomId, initialMessageIds)
      return
    }

    // 找出未播报的新消息
    const newMessages = messages.filter((message) => !handledIds.has(message.id))
    if (newMessages.length === 0) return

    // 无论是否实际播报，先全部标记，不会重播
    markVoiceMessagesHandled(chatRoomId, newMessages.map((message) => message.id))

    // tab 在后台不播
    if (document.hidden) return

    // 收集所有需要播报的新消息，按顺序入队
    const toSpeak = newMessages.filter((message) => {
      if (message.isHuman || !message.agentId || !message.content.trim()) return false
      const agent = allAgents.find((item) => item.id === message.agentId)
      const voiceConfig = agent?.voiceConfig
      return voiceConfig?.enabled && voiceConfig.outputMode === 'auto_final_only'
    })

    if (toSpeak.length === 0) return

    for (const message of toSpeak) {
      const vc = allAgents.find((item) => item.id === message.agentId)!.voiceConfig!
      speechQueueRef.current.push({
        messageId: message.id,
        text: normalizeSpeechText(message.content),
        voiceId: vc.voiceId,
        speed: vc.speed,
        volume: vc.volume,
      })
    }

    // 串行消费队列：上一条播完再播下一条
    const processQueue = async () => {
      if (isSpeakingRef.current) return
      isSpeakingRef.current = true
      while (speechQueueRef.current.length > 0) {
        const item = speechQueueRef.current.shift()!
        setPlayingVoiceMessageId(item.messageId)
        markVoiceMessagesPlayed(chatRoomId, [item.messageId])
        await speakTextWithBrowserSpeech({
          text: item.text,
          voiceId: item.voiceId,
          rate: item.speed,
          volume: item.volume,
        }).catch(() => {})
        setPlayingVoiceMessageId(null)
      }
      isSpeakingRef.current = false
    }

    void processQueue()
  }, [allAgents, chatRoomId, handledIds, handledVoiceMessageIdsByRoom, loading, markVoiceMessagesHandled, markVoiceMessagesPlayed, messages, setPlayingVoiceMessageId])

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
          messages.length === 0 ? 'flex-1' : 'scrollbar-hover flex-1 overflow-y-auto py-4',
          isMobile && 'min-h-0'
        )}
      >
        {loading ? (
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
              ref={(el) => {
                if (el) {
                  messageRefs.current.set(message.id, el)
                } else {
                  messageRefs.current.delete(message.id)
                }
              }}
            >
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
                onAgentAvatarClick={onAgentAvatarClick}
                onTypingAgentClick={onTypingAgentClick}
                onMentionClick={onMentionClick}
                onReplyClick={onReplyClick}
                onExecutionDetailClick={onExecutionDetailClick}
                onMentionAgent={onMentionAgent}
                onDeleteMessage={onDeleteMessage}
              />
            </div>
          ))
        )}
        <div ref={messagesEndRef} className="h-1" />
      </div>

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
