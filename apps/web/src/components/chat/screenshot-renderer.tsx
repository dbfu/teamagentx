import { useEffect, useRef, useCallback } from 'react'
import { Message } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { ChatMessage } from './chat-message'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface CurrentUser {
  username: string
  avatar?: string | null
  avatarColor?: string | null
}

interface ScreenshotRendererProps {
  messages: Message[]
  roomName: string
  roomAvatar?: string | null
  isQuickChatRoom?: boolean
  mentionAgents: MentionAgent[]
  currentUser: CurrentUser
  onReady?: (element: HTMLElement) => void
}

/**
 * 过滤消息数据，移除执行详情、Token、耗时、回复等用于截图
 */
function filterMessageForScreenshot(message: Message): Message {
  return {
    ...message,
    // 移除执行记录相关数据
    executionRecordId: null,
    executionDuration: null,
    totalTokens: null,
    // 移除回复消息ID
    replyMessageId: null,
  }
}

/**
 * 截图渲染器组件
 * 复用 ChatMessage 组件保证样式一致
 */
export function ScreenshotRenderer({
  messages,
  roomName,
  roomAvatar,
  isQuickChatRoom,
  mentionAgents,
  currentUser,
  onReady,
}: ScreenshotRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // 通知父组件容器已准备好
  const notifyReady = useCallback(() => {
    if (containerRef.current && messages.length > 0) {
      // 等待渲染完成（给 ReactMarkdown 留出时间）
      setTimeout(() => {
        if (containerRef.current) {
          onReady?.(containerRef.current)
        }
      }, 200)
    }
  }, [messages.length, onReady])

  useEffect(() => {
    notifyReady()
  }, [notifyReady])

  if (messages.length === 0) {
    return null
  }

  // 过滤消息，移除不需要显示的元素
  const filteredMessages = messages.map(filterMessageForScreenshot)

  return (
    <div
      ref={containerRef}
      className="screenshot-container font-sans"
      style={{
        position: 'fixed',
        top: '0',
        left: '0',
        width: '1000px',
        maxWidth: 'none',
        backgroundColor: 'white',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: '14px',
        lineHeight: '1.5',
      }}
    >
      {/* 头部信息 */}
      <div className="flex items-center gap-3 px-6 py-4 border-b bg-muted/50">
        {isQuickChatRoom ? (
          <AgentAvatarImage avatar={roomAvatar ?? null} alt={roomName} className="size-10 rounded-full shadow-sm" />
        ) : (
          <GroupAvatarImage avatar={roomAvatar ?? null} alt={roomName} className="size-10 rounded-full shadow-sm" />
        )}
        <div>
          <div className="text-lg font-semibold text-foreground">
            {roomName}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            聊天记录截图 · {new Date().toLocaleDateString('zh-CN')}
          </div>
        </div>
      </div>

      {/* 消息列表 - 使用过滤后的消息 */}
      <div className="py-2">
        {filteredMessages.map((message) => (
          <ChatMessage
            key={message.id}
            message={message}
            isRight={message.isHuman}
            showSpeechButton={false}
            mentionAgents={mentionAgents}
            currentUser={currentUser}
            // 不传递 replyCount 和 replyTo，避免渲染回复相关元素
            replyCount={undefined}
            replyTo={undefined}
            // 禁用所有交互功能
            onAgentAvatarClick={() => {}}
            onTypingAgentClick={() => {}}
            onMentionClick={() => {}}
            onReplyClick={() => {}}
            onExecutionDetailClick={() => {}}
            onMentionAgent={() => {}}
            disableContentCollapse
          />
        ))}
      </div>

      {/* 底部水印 */}
      <div className="px-6 py-3 border-t bg-muted/50 text-xs text-muted-foreground text-center">
        由 TeamAgentX 生成
      </div>
    </div>
  )
}
