import type { ToolCall } from '@/stores/socket-store'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import { Maximize2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)

type ToolLike = {
  name?: string
  input?: Record<string, unknown>
  output?: string | Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = record[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function languageFromPath(path?: string | null): string {
  const ext = path?.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    case 'py':
      return 'python'
    case 'sh':
    case 'bash':
      return 'bash'
    default:
      return 'text'
  }
}

function filePathFromInput(input?: Record<string, unknown>): string | null {
  return input ? stringField(input, ['file_path', 'path', 'filename']) : null
}

function highlightedHtml(code: string, language?: string): string {
  try {
    const highlightLanguage = language === 'html' ? 'xml' : language
    if (highlightLanguage && highlightLanguage !== 'text' && hljs.getLanguage(highlightLanguage)) {
      return hljs.highlight(code, { language: highlightLanguage }).value
    }
    return hljs.highlightAuto(code).value
  } catch {
    return code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
}

const HIGHLIGHT_CLASS_NAME = '[&_.hljs-addition]:text-green-700 dark:[&_.hljs-addition]:text-green-300 [&_.hljs-attr]:text-sky-700 dark:[&_.hljs-attr]:text-sky-300 [&_.hljs-built_in]:text-cyan-700 dark:[&_.hljs-built_in]:text-cyan-300 [&_.hljs-comment]:text-gray-400 [&_.hljs-comment]:italic [&_.hljs-deletion]:text-red-700 dark:[&_.hljs-deletion]:text-red-300 [&_.hljs-keyword]:font-medium [&_.hljs-keyword]:text-blue-600 dark:[&_.hljs-keyword]:text-blue-400 [&_.hljs-literal]:font-medium [&_.hljs-literal]:text-purple-600 dark:[&_.hljs-literal]:text-purple-400 [&_.hljs-meta]:text-blue-700 dark:[&_.hljs-meta]:text-blue-300 [&_.hljs-number]:text-orange-600 dark:[&_.hljs-number]:text-orange-400 [&_.hljs-string]:text-emerald-600 dark:[&_.hljs-string]:text-emerald-400 [&_.hljs-title]:text-cyan-700 dark:[&_.hljs-title]:text-cyan-300 [&_.hljs-type]:text-amber-700 dark:[&_.hljs-type]:text-amber-300'

function HighlightedCode({ code, language, className = '' }: { code: string; language?: string; className?: string }) {
  const html = useMemo(() => highlightedHtml(code, language), [code, language])

  return (
    <code
      className={`language-${language || 'text'} ${HIGHLIGHT_CLASS_NAME} ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function CodeBlock({ label, code, language }: { label: string; code: string; language?: string }) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!expanded) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-blue-50 hover:text-blue-600 focus-visible:bg-blue-50 focus-visible:text-blue-600 focus-visible:outline-none dark:hover:bg-blue-950/40 dark:hover:text-blue-300 dark:focus-visible:bg-blue-950/40 dark:focus-visible:text-blue-300"
          title="放大"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded border bg-muted/60 p-2 text-xs leading-relaxed text-foreground">
        <HighlightedCode code={code} language={language} />
      </pre>
      {expanded && (
        <div className="fixed inset-0 z-50 flex bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="flex min-h-0 w-full flex-col rounded-lg border bg-background shadow-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground">{label}</div>
                {language && language !== 'text' && <div className="text-xs text-muted-foreground">{language}</div>}
              </div>
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:bg-gray-100 focus-visible:text-foreground focus-visible:outline-none dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
                title="关闭"
                onClick={() => setExpanded(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-4 text-sm leading-relaxed text-foreground">
              <HighlightedCode code={code} language={language} />
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

export function isCodeEditTool(tool: ToolLike): boolean {
  const name = (tool.name || '').toLowerCase()
  if (['file_change', 'write', 'edit', 'multiedit', 'notebookedit', 'apply_patch'].includes(name)) return true
  if (name.includes('write') || name.includes('edit') || name.includes('patch')) return true

  const input = tool.input
  if (!input) return false
  return Boolean(
    stringField(input, ['content', 'old_string', 'new_string', 'patch']) ||
    Array.isArray(input.edits) ||
    Array.isArray(input.changes),
  )
}

export function isCodeReadTool(tool: ToolLike): boolean {
  const name = (tool.name || '').toLowerCase()
  if (['read', 'file_read'].includes(name)) return true
  return name.includes('read') && Boolean(filePathFromInput(tool.input))
}

export function CodeEditToolContent({ tool }: { tool: ToolLike }) {
  const input = tool.input || {}
  const filePath = filePathFromInput(input)
  const language = languageFromPath(filePath)
  const content = stringField(input, ['content'])
  const oldString = stringField(input, ['old_string', 'oldStr', 'oldText'])
  const newString = stringField(input, ['new_string', 'newStr', 'newText'])
  const patch = stringField(input, ['patch'])
  const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : []
  const changes = Array.isArray(input.changes) ? input.changes.filter(isRecord) : []

  return (
    <div className="space-y-2">
      {filePath && <div className="text-xs text-muted-foreground">文件: <span className="font-mono">{filePath}</span></div>}
      {changes.length > 0 && (
        <div className="rounded border bg-muted/40 p-2 text-xs">
          <div className="mb-1 text-muted-foreground">文件变更:</div>
          <div className="space-y-1 font-mono">
            {changes.map((change, idx) => (
              <div key={idx}>
                {String(change.kind || 'update')} {String(change.path || '')}
              </div>
            ))}
          </div>
        </div>
      )}
      {content && <CodeBlock label="写入内容" code={content} language={language} />}
      {oldString && <CodeBlock label="替换前" code={oldString} language={language} />}
      {newString && <CodeBlock label="替换后" code={newString} language={language} />}
      {edits.map((edit, idx) => {
        const editOld = stringField(edit, ['old_string', 'oldStr', 'oldText'])
        const editNew = stringField(edit, ['new_string', 'newStr', 'newText'])
        return (
          <div key={idx} className="space-y-2">
            <div className="text-xs text-muted-foreground">编辑 {idx + 1}</div>
            {editOld && <CodeBlock label="替换前" code={editOld} language={language} />}
            {editNew && <CodeBlock label="替换后" code={editNew} language={language} />}
          </div>
        )
      })}
      {patch && <CodeBlock label="补丁" code={patch} language="diff" />}
    </div>
  )
}

export function CodeReadToolOutput({ tool }: { tool: ToolLike }) {
  if (typeof tool.output !== 'string') return null

  const filePath = filePathFromInput(tool.input)
  const language = languageFromPath(filePath)

  return (
    <div className="space-y-2">
      {filePath && <div className="text-xs text-muted-foreground">文件: <span className="font-mono">{filePath}</span></div>}
      <CodeBlock label="读取内容" code={tool.output} language={language} />
    </div>
  )
}

export function renderToolValue(value: ToolCall['output'] | unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
