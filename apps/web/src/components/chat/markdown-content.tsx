import { cn } from '@/lib/utils'
import { Check, Copy } from 'lucide-react'
import { isValidElement, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveAssetUrl } from '@/lib/asset-url'
import { MENTION_MARKER_CLASS, remarkMentions } from '@/lib/remark-mentions'
import { remarkTrimUrlPunctuation } from '@/lib/remark-trim-url-punctuation'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'
import { MermaidDiagram } from './mermaid-diagram'
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
  // 流式视图等高频更新场景可关闭 mermaid 渲染，避免边流边反复绘图；mermaid 块退化为普通代码块
  disableMermaid?: boolean
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

// 带复制按钮的代码块容器；mermaid 图不包裹复制按钮
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation()
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  // mermaid 块由 code 渲染器替换为 <MermaidDiagram>，此时直接透传，不加复制按钮
  if (isValidElement(children) && children.type === MermaidDiagram) {
    return <>{children}</>
  }

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 忽略复制失败（如无剪贴板权限）
    }
  }

  return (
    <div className="group relative">
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? t('common.copied') : t('common.copy')}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border bg-card/80 px-2 py-1 text-xs text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  )
}

export function MarkdownContent({
  content,
  className,
  mentionAgents,
  onMentionClick,
  onImageClick,
  disableMermaid,
}: MarkdownContentProps) {
  const { t } = useTranslation()
  const normalizedContent = normalizeOrderedListMarkerBreaks(content)
  const hasMentions = Boolean(mentionAgents?.length)

  return (
    <div
      className={cn(
        'prose prose-sm max-w-none min-w-0 break-words [&_p]:my-0 [&_li]:my-0 [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:w-full [&_pre]:whitespace-pre-wrap [&_code]:whitespace-pre-wrap [&_img]:max-h-[360px] [&_img]:w-auto [&_img]:max-w-[min(560px,80vw)] [&_img]:rounded-lg [&_img]:object-contain',
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
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            // fenced 代码块带 language-xxx 类名；行内代码无此类名
            const language = /language-(\w+)/.exec(className || '')?.[1]
            if (language === 'mermaid' && !disableMermaid) {
              return <MermaidDiagram chart={String(children)} />
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="break-all">
              {children}
            </a>
          ),
          img: ({ src, alt }) => {
            const imageUrl = resolveAssetUrl(src)
            return (
              <img
                src={imageUrl}
                alt={alt || t('chat.image')}
                className={cn(
                  'max-h-[360px] w-auto max-w-[min(560px,80vw)] rounded-lg object-contain',
                  onImageClick && 'cursor-pointer transition-opacity hover:opacity-90',
                )}
                onClick={() => imageUrl && onImageClick?.({ url: imageUrl, name: alt || t('chat.image') })}
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
                    title={blocksDetail ? undefined : t('common.clickToViewAgentDetails', { name: agentName })}
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
