import Editor, { loader } from '@monaco-editor/react'
import { shikiToMonaco } from '@shikijs/monaco'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { createHighlighter, type BundledLanguage } from 'shiki'
import { useEffect, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import { useTheme } from '@/components/theme-provider'

type MonacoEnvironment = {
  getWorker: (_moduleId: string, label: string) => Worker
}

const globalWithMonaco = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironment }
globalWithMonaco.MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

const ONE_LIGHT_THEME = 'one-light'
const PALENIGHT_THEME = 'material-theme-palenight'
const shikiLanguages = [
  'c', 'cpp', 'csharp', 'css', 'dockerfile', 'go', 'graphql', 'html', 'ini',
  'java', 'javascript', 'jsx', 'json', 'jsonc', 'kotlin', 'less', 'lua',
  'markdown', 'php', 'properties', 'python', 'ruby', 'rust', 'scss',
  'shellscript', 'sql', 'swift', 'toml', 'typescript', 'tsx', 'vue', 'xml', 'yaml',
] satisfies BundledLanguage[]

const highlighterPromise = createHighlighter({
  themes: [ONE_LIGHT_THEME, PALENIGHT_THEME],
  langs: shikiLanguages,
})

let shikiSetupPromise: Promise<void> | null = null

function prepareShikiMonaco() {
  if (!shikiSetupPromise) {
    shikiSetupPromise = highlighterPromise.then((highlighter) => {
      const registered = new Set(monaco.languages.getLanguages().map((language) => language.id))
      for (const language of highlighter.getLoadedLanguages()) {
        if (!registered.has(language)) {
          monaco.languages.register({ id: language })
          registered.add(language)
        }
      }
      shikiToMonaco(highlighter, monaco)
    })
  }
  return shikiSetupPromise
}

const languageByExtension: Record<string, string> = {
  bash: 'shellscript',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'cpp',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  properties: 'properties',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

function languageForFile(filePath: string): string {
  const fileName = filePath.split('/').at(-1)?.toLowerCase() ?? ''
  if (fileName === 'params.conf') return 'json'
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'plaintext'
  if (fileName.startsWith('.env')) return 'ini'
  return languageByExtension[fileName.split('.').at(-1) ?? ''] ?? 'plaintext'
}

interface WorkspaceMonacoPreviewProps {
  path: string
  content: string
  onExpand?: () => void
  expandLabel?: string
}

export default function WorkspaceMonacoPreview({ path, content, onExpand, expandLabel = '放大代码区域' }: WorkspaceMonacoPreviewProps) {
  const { theme } = useTheme()
  const [ready, setReady] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const editorTheme = theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark')
    ? PALENIGHT_THEME
    : ONE_LIGHT_THEME

  useEffect(() => {
    let disposed = false
    prepareShikiMonaco()
      .then(() => {
        if (!disposed) setReady(true)
      })
      .catch((error) => {
        if (!disposed) setSetupError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      disposed = true
    }
  }, [])

  if (setupError) {
    return <div className="grid h-full place-items-center bg-[var(--code-surface)] px-6 text-center text-xs text-destructive">代码主题加载失败：{setupError}</div>
  }
  if (!ready) {
    return <div className="grid h-full place-items-center bg-[var(--code-surface)] text-xs text-muted-foreground">正在加载代码主题…</div>
  }

  return (
    <div className="relative h-full min-h-0 bg-[var(--code-surface)]">
      {onExpand && (
        <button
          type="button"
          className="absolute right-3 top-3 z-10 rounded-md border border-border/70 bg-[var(--code-surface)]/90 p-1.5 text-[var(--code-foreground)] shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          onClick={onExpand}
          title={expandLabel}
          aria-label={expandLabel}
        >
          <Maximize2 className="size-3.5" />
        </button>
      )}
      <Editor
        key={path}
        height="100%"
        path={`file:///${path}`}
        value={content}
        language={languageForFile(path)}
        theme={editorTheme}
        loading={<div className="grid h-full place-items-center text-xs text-muted-foreground">正在加载代码预览…</div>}
        options={{
          readOnly: true,
          domReadOnly: true,
          ariaLabel: `预览文件：${path}`,
          automaticLayout: true,
          fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
          fontSize: 13,
          lineHeight: 22,
          minimap: { enabled: false },
          lineNumbers: 'on',
          folding: true,
          renderValidationDecorations: 'off',
          occurrencesHighlight: 'off',
          selectionHighlight: false,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          padding: { top: 8, bottom: 8 },
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
      />
    </div>
  )
}
