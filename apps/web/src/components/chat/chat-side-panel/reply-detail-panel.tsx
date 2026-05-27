import { Message } from '@/lib/agent-api'
import { formatDateTime } from '@/lib/utils'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { UserAvatar } from '../user-avatar'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { remarkMentions, MENTION_MARKER_CLASS } from '@/lib/remark-mentions'
import { remarkTrimUrlPunctuation } from '@/lib/remark-trim-url-punctuation'
import { resolveAssetUrl } from '@/lib/asset-url'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface ReplyDetailPanelProps {
  selectedReplyMessage: Message
  replies: Message[]
  mentionAgents: MentionAgent[]
}

export function ReplyDetailPanel({ selectedReplyMessage, replies, mentionAgents }: ReplyDetailPanelProps) {
  // 获取原消息发送者信息
  const originalSenderName = selectedReplyMessage.isHuman
    ? (selectedReplyMessage.user?.username ?? '用户')
    : (selectedReplyMessage.agent?.name ?? '助手')
  const renderContent = (content: string) => {
    // 如果没有 mentionAgents，直接渲染 markdown
    if (!mentionAgents || mentionAgents.length === 0) {
      return (
        <div className="prose prose-sm [&_p]:whitespace-pre-wrap [&_li]:whitespace-pre-wrap">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkTrimUrlPunctuation]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
              img: ({ src, alt }) => (
                <img src={resolveAssetUrl(src)} alt={alt || '图片'} />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      )
    }

    // 使用 remarkMentions 插件处理 @mentions
    return (
      <div className="prose prose-sm [&_p]:whitespace-pre-wrap [&_li]:whitespace-pre-wrap">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkTrimUrlPunctuation, [remarkMentions, { mentionAgents }]]}
          rehypePlugins={[rehypeRaw]}
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
            img: ({ src, alt }) => (
              <img src={resolveAssetUrl(src)} alt={alt || '图片'} />
            ),
            span: ({ className, children, ...props }) => {
              if (className === MENTION_MARKER_CLASS) {
                return (
                  <span className="cursor-pointer text-primary hover:text-primary/80">
                    {children}
                  </span>
                )
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

  return (
    <div className="space-y-4">
      {/* 原消息 */}
      <div className="rounded-lg bg-primary/5 p-3">
        <div className="flex items-start gap-3">
          {selectedReplyMessage.isHuman ? (
            <UserAvatar
              avatar={selectedReplyMessage.user?.avatar ?? selectedReplyMessage.avatar}
              size="md"
            />
          ) : (
            <AgentAvatarImage
              avatar={selectedReplyMessage.avatar ?? selectedReplyMessage.agent?.avatar ?? null}
              className="size-8 shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-foreground text-sm">{originalSenderName}</span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(selectedReplyMessage.createdAt)}
              </span>
            </div>
            <div className="text-foreground text-sm break-words">
              {renderContent(selectedReplyMessage.content)}
            </div>
          </div>
        </div>
      </div>

      {/* 分隔线 */}
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <div className="flex-1 h-px bg-border" />
        <span>{replies.length} 条回复</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* 回复列表 */}
      <div className="space-y-3">
        {replies.length === 0 ? (
          <div className="text-center text-muted-foreground py-4">
            暂无回复
          </div>
        ) : (
          replies.map((reply) => {
            const replySenderName = reply.isHuman
              ? (reply.user?.username ?? '用户')
              : (reply.agent?.name ?? '助手')
            return (
              <div key={reply.id} className="flex items-start gap-3">
                {reply.isHuman ? (
                  <UserAvatar
                    avatar={reply.user?.avatar ?? reply.avatar}
                    size="md"
                  />
                ) : (
                  <AgentAvatarImage
                    avatar={reply.avatar ?? reply.agent?.avatar ?? null}
                    className="size-8 shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-foreground text-sm">{replySenderName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(reply.createdAt)}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted px-3 py-2 shadow-sm text-foreground text-sm break-words">
                    {renderContent(reply.content)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
