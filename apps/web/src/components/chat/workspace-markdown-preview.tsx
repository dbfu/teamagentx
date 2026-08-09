import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function WorkspaceMarkdownPreview({ path, content }: { path: string; content: string }) {
  return (
    <div className="h-full overflow-auto bg-card px-5 py-4" aria-label={`Markdown 预览：${path}`}>
      <article className="mx-auto max-w-[820px] text-sm leading-7 text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_h1]:mt-7 [&_h1]:mb-4 [&_h1]:border-b [&_h1]:border-border [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border/70 [&_h2]:pb-1.5 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_p]:my-3 [&_p]:break-words [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:bg-primary/5 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-muted-foreground [&_blockquote>p]:my-0 [&_hr]:my-6 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_pre]:my-4 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-[var(--code-surface)] [&_pre]:p-4 [&_pre]:leading-6 [&_pre]:text-[var(--code-foreground)] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_img]:my-4 [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...props }) => <a href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>,
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  )
}
