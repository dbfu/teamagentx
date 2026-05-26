import { cn } from '@/lib/utils'
import { resolveAssetUrl } from '@/lib/asset-url'
import { MENTION_MARKER_CLASS, remarkMentions } from '@/lib/remark-mentions'
import { remarkTrimUrlPunctuation } from '@/lib/remark-trim-url-punctuation'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'

interface MentionAgent {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
}

interface MarkdownContentProps {
  content: string
  className?: string
  mentionAgents?: MentionAgent[]
  onMentionClick?: (agentId: string, agentName: string) => void
  onImageClick?: (image: { url: string; name: string }) => void
}

export function normalizeOrderedListMarkerBreaks(content: string): string {
  const lines = content.split('\n')
  const result: string[] = []
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]

    if (/^\s*```/.test(line)) {
      inFence = !inFence
      result.push(line)
      continue
    }

    const markerMatch = !inFence ? line.match(/^(\s*\d+\.)\s*$/) : null
    if (markerMatch) {
      let nextIndex = i + 1
      while (nextIndex < lines.length && lines[nextIndex].trim() === '') {
        nextIndex += 1
      }

      if (nextIndex < lines.length && lines[nextIndex].trim() !== '') {
        result.push(`${markerMatch[1]} ${lines[nextIndex].trimStart()}`)
        i = nextIndex
        continue
      }
    }

    result.push(line)
  }

  return result.join('\n')
}

export function MarkdownContent({
  content,
  className,
  mentionAgents,
  onMentionClick,
  onImageClick,
}: MarkdownContentProps) {
  const normalizedContent = normalizeOrderedListMarkerBreaks(content)
  const hasMentions = Boolean(mentionAgents?.length)

  return (
    <div
      className={cn(
        'prose prose-sm max-w-none break-words [&_p]:my-0 [&_li]:my-0 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap [&_img]:max-h-[360px] [&_img]:w-auto [&_img]:max-w-[min(560px,80vw)] [&_img]:rounded-lg [&_img]:object-contain',
        onImageClick && '[&_img]:cursor-pointer',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={
          hasMentions
            ? [remarkGfm, remarkTrimUrlPunctuation, [remarkMentions, { mentionAgents }]]
            : [remarkGfm, remarkTrimUrlPunctuation]
        }
        rehypePlugins={hasMentions ? [rehypeRaw] : undefined}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const imageUrl = resolveAssetUrl(src)
            return (
              <img
                src={imageUrl}
                alt={alt || '图片'}
                className={cn(
                  'max-h-[360px] w-auto max-w-[min(560px,80vw)] rounded-lg object-contain',
                  onImageClick && 'cursor-pointer transition-opacity hover:opacity-90',
                )}
                onClick={() => imageUrl && onImageClick?.({ url: imageUrl, name: alt || '图片' })}
              />
            )
          },
          span: ({ className, children, ...props }) => {
            if (className === MENTION_MARKER_CLASS) {
              const agentId = (props as any).agentId || (props as any)['data-agent-id']
              const agentName = (props as any).agentName || (props as any)['data-agent-name']

              if (agentId && agentName) {
                const blocksDetail = isSystemAssistantDetailBlocked({ id: agentId, name: agentName })
                return (
                  <span
                    className={cn(
                      'text-primary whitespace-nowrap',
                      blocksDetail ? 'cursor-default' : 'cursor-pointer hover:text-primary/80'
                    )}
                    onClick={() => {
                      if (!blocksDetail) onMentionClick?.(agentId, agentName)
                    }}
                    title={blocksDetail ? undefined : `点击查看 ${agentName} 详情`}
                  >
                    {children}
                  </span>
                )
              }
            }

            return <span className={className} {...props}>{children}</span>
          },
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  )
}
