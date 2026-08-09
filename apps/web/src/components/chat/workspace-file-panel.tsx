import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Code2, Eye, FileText, Folder, FolderOpen, Loader2, RefreshCw, X, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { workspaceApi, type WorkspaceEntry, type WorkspaceFilePreview } from '@/lib/workspace-api'
import { MaterialFileIcon } from '@/file-icons/MaterialFileIcon'

const WorkspaceMonacoPreview = lazy(() => import('./workspace-monaco-preview'))
const WorkspaceMarkdownPreview = lazy(() => import('./workspace-markdown-preview'))

type FileState = {
  preview: WorkspaceFilePreview | null
  loading: boolean
  error: string | null
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath)
}

function formatFileSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function rootName(root: string): string {
  const normalized = root.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).at(-1) || root || '工作目录'
}

function visibleEntries(entries: WorkspaceEntry[], collapsed: ReadonlySet<string>): WorkspaceEntry[] {
  return entries.filter((entry) => {
    const parts = entry.path.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      if (collapsed.has(parts.slice(0, index).join('/'))) return false
    }
    return true
  })
}

function allDirectoryPaths(entries: WorkspaceEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.path))
}

export function WorkspaceFilePanel({ chatRoomId }: { chatRoomId: string }) {
  const { t } = useTranslation()
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [rootCollapsed, setRootCollapsed] = useState(false)
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [activePath, setActivePath] = useState('')
  const [files, setFiles] = useState<Record<string, FileState>>({})
  const [markdownModes, setMarkdownModes] = useState<Record<string, 'preview' | 'source'>>({})
  const [loadingTree, setLoadingTree] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const activeTabRef = useRef<HTMLDivElement | null>(null)

  const loadTree = useCallback(async () => {
    setLoadingTree(true)
    setTreeError(null)
    const response = await workspaceApi.getTree(chatRoomId)
    if (response.success && response.data) {
      setRoot(response.data.root)
      setEntries(response.data.entries)
      setCollapsed(allDirectoryPaths(response.data.entries))
      setRootCollapsed(false)
    } else {
      setTreeError(response.error || t('chat.workspaceLoadFailed'))
    }
    setLoadingTree(false)
  }, [chatRoomId, t])

  useEffect(() => {
    setOpenPaths([])
    setActivePath('')
    setFiles({})
    setMarkdownModes({})
    void loadTree()
  }, [chatRoomId, loadTree])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activePath])

  const openFile = useCallback(async (entry: WorkspaceEntry) => {
    if (entry.kind !== 'file') {
      setCollapsed((current) => {
        const next = new Set(current)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
      return
    }

    setActivePath(entry.path)
    setOpenPaths((current) => current.includes(entry.path) ? current : [...current, entry.path])
    const existing = files[entry.path]
    if (existing?.preview || existing?.loading) return

    setFiles((current) => ({ ...current, [entry.path]: { preview: null, loading: true, error: null } }))
    const response = await workspaceApi.getFile(chatRoomId, entry.path)
    if (response.success && response.data) {
      setFiles((current) => ({ ...current, [entry.path]: { preview: response.data!.file, loading: false, error: null } }))
    } else {
      setFiles((current) => ({ ...current, [entry.path]: { preview: null, loading: false, error: response.error || t('chat.workspaceReadFailed') } }))
    }
  }, [chatRoomId, files, t])

  const closeFile = (filePath: string) => {
    const nextOpenPaths = openPaths.filter((path) => path !== filePath)
    setOpenPaths(nextOpenPaths)
    setFiles((current) => {
      const next = { ...current }
      delete next[filePath]
      return next
    })
    if (activePath === filePath) setActivePath(nextOpenPaths.at(-1) ?? '')
  }

  const activeFileState = activePath ? files[activePath] : null
  const activePreview = activeFileState?.preview ?? null
  const markdownMode = markdownModes[activePath] ?? 'preview'
  const visible = useMemo(() => visibleEntries(entries, collapsed), [collapsed, entries])

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(170px,32%)_minmax(0,1fr)]">
      <aside className="min-h-0 min-w-0 overflow-y-auto border-r border-border bg-muted/20" aria-label={t('chat.workspaceFileTree')}>
        <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-border bg-muted/95 px-3 backdrop-blur-sm">
          <FolderTreeIcon />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={root}>{root ? rootName(root) : t('chat.workspaceDirectory')}</span>
          <button type="button" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => void loadTree()} title={t('chat.workspaceRefresh')}>
            <RefreshCw className={cn('size-3.5', loadingTree && 'animate-spin')} />
          </button>
        </div>
        {loadingTree ? (
          <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('chat.workspaceLoading')}</div>
        ) : treeError ? (
          <div className="space-y-2 px-3 py-5 text-xs text-destructive"><p>{treeError}</p><button type="button" className="rounded border border-border px-2 py-1 text-foreground hover:bg-accent" onClick={() => void loadTree()}>{t('common.retry')}</button></div>
        ) : (
          <>
            <button type="button" className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-sm font-semibold hover:bg-accent" onClick={() => setRootCollapsed((current) => !current)} title={root}>
              <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !rootCollapsed && 'rotate-90')} />
              {rootCollapsed ? <Folder className="size-4 shrink-0 text-primary" /> : <FolderOpen className="size-4 shrink-0 text-primary" />}
              <span className="min-w-0 truncate">{root ? rootName(root) : t('chat.workspaceDirectory')}</span>
            </button>
            {!rootCollapsed && visible.length === 0 && <div className="px-3 py-5 text-center text-[11px] text-muted-foreground">{t('chat.workspaceNoFiles')}</div>}
            {!rootCollapsed && visible.map((entry) => {
              const isCollapsed = entry.kind === 'directory' && collapsed.has(entry.path)
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={cn('flex h-8 w-full items-center gap-1.5 pr-2 text-left text-sm hover:bg-accent', activePath === entry.path && 'bg-primary/10 font-medium text-primary')}
                  style={{ paddingLeft: `${12 + (entry.depth + 1) * 12}px` }}
                  title={entry.kind === 'file' && entry.size !== null ? `${entry.path} (${formatFileSize(entry.size)})` : entry.path}
                  onClick={() => void openFile(entry)}
                >
                  {entry.kind === 'directory' ? <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', !isCollapsed && 'rotate-90')} /> : <span className="w-3.5 shrink-0" />}
                  {entry.kind === 'directory' ? (isCollapsed ? <Folder className="size-4 shrink-0 text-primary" /> : <FolderOpen className="size-4 shrink-0 text-primary" />) : <MaterialFileIcon name={entry.name} />}
                  <span className="min-w-0 truncate">{entry.name}</span>
                </button>
              )
            })}
          </>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card" aria-label={t('chat.workspacePreview')}>
        {openPaths.length > 0 && (
          <div className="flex h-9 shrink-0 overflow-x-auto border-b border-border bg-muted/20" role="tablist" aria-label={t('chat.workspaceOpenFiles')}>
            {openPaths.map((path) => {
              const active = path === activePath
              const name = path.split('/').at(-1) || path
              return (
                <div ref={active ? activeTabRef : undefined} key={path} className={cn('group relative flex min-w-[120px] max-w-[210px] shrink-0 items-center border-r border-border', active ? 'bg-card' : 'text-muted-foreground')}>
                  {active && <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] z-10 h-0.5 bg-primary" aria-hidden="true" />}
                  <button type="button" role="tab" aria-selected={active} className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 text-left text-[11px]" title={path} onClick={() => setActivePath(path)}><MaterialFileIcon name={name} /><span className="min-w-0 truncate">{name}</span></button>
                  <button type="button" className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100" title={`${t('common.close')} ${name}`} aria-label={`${t('common.close')} ${name}`} onClick={() => closeFile(path)}><X className="size-3" /></button>
                </div>
              )
            })}
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {activePreview?.kind === 'text' && isMarkdownFile(activePreview.path) && (
            <div className="absolute right-3 top-3 z-10 flex items-center rounded-md border border-border bg-card/95 p-0.5 text-[10px] shadow-sm">
              <button type="button" className={cn('flex items-center gap-1 rounded px-2 py-1', markdownMode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')} onClick={() => setMarkdownModes((current) => ({ ...current, [activePath]: 'preview' }))}><Eye className="size-3" />{t('chat.workspacePreview')}</button>
              <button type="button" className={cn('flex items-center gap-1 rounded px-2 py-1', markdownMode === 'source' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')} onClick={() => setMarkdownModes((current) => ({ ...current, [activePath]: 'source' }))}><Code2 className="size-3" />{t('chat.workspaceSource')}</button>
            </div>
          )}
          {!activePath ? (
            <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground"><FileText className="mb-2 size-8 opacity-50" /><span>{t('chat.workspaceSelectFile')}</span></div>
          ) : activeFileState?.loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</div>
          ) : activeFileState?.error ? (
            <div className="p-4 text-xs text-destructive">{activeFileState.error}</div>
          ) : activePreview?.kind === 'image' ? (
            <div className="grid h-full place-items-center overflow-auto bg-muted/20 p-5"><img src={`data:${activePreview.mimeType};base64,${activePreview.content}`} alt={activePreview.name} className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-sm" /></div>
          ) : activePreview?.kind === 'unsupported' ? (
            <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">{t('chat.workspaceUnsupported', { size: formatFileSize(activePreview.size) })}</div>
          ) : activePreview?.kind === 'text' ? (
            <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">{t('common.loading')}</div>}>
              {isMarkdownFile(activePreview.path) && markdownMode === 'preview' ? <WorkspaceMarkdownPreview path={activePreview.path} content={activePreview.content} /> : <WorkspaceMonacoPreview path={activePreview.path} content={activePreview.content} />}
            </Suspense>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function FolderTreeIcon() {
  return <FolderOpen className="size-4 shrink-0 text-primary" />
}
