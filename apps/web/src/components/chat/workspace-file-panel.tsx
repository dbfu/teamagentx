import { lazy, Suspense, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Code2, Eye, FileText, Folder, FolderOpen, GripVertical, Loader2, Maximize2, Minimize2, RefreshCw, X, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { workspaceApi, type WorkspaceEntry, type WorkspaceFilePreview } from '@/lib/workspace-api'
import { MaterialFileIcon } from '@/file-icons/MaterialFileIcon'
import {
  clampFileTreeWidth,
  MAX_FILE_TREE_WIDTH,
  MIN_FILE_TREE_WIDTH,
  persistWorkspaceFileState,
  readPersistedWorkspaceFileState,
  readStoredFileTreeWidth,
  WORKSPACE_FILE_TREE_WIDTH_STORAGE_KEY,
} from './workspace-file-state'

const WorkspaceMonacoPreview = lazy(() => import('./workspace-monaco-preview'))
const WorkspaceMarkdownPreview = lazy(() => import('./workspace-markdown-preview'))
const WorkspacePdfPreview = lazy(() => import('./workspace-pdf-preview'))
const WorkspaceSpreadsheetPreview = lazy(() => import('./workspace-spreadsheet-preview'))
const WorkspaceDocxPreview = lazy(() => import('./workspace-docx-preview'))
const WorkspacePptxPreview = lazy(() => import('./workspace-pptx-preview'))

type FileState = {
  preview: WorkspaceFilePreview | null
  loading: boolean
  error: string | null
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath)
}

function isHtmlFile(filePath: string): boolean {
  return /\.(html?|xhtml)$/i.test(filePath)
}

type WorkspaceDocumentKind = 'pdf' | 'spreadsheet' | 'word' | 'presentation'

function workspaceDocumentKind(filePath: string): WorkspaceDocumentKind | null {
  const extension = filePath.split('.').at(-1)?.toLowerCase()
  if (extension === 'pdf') return 'pdf'
  if (extension === 'xls' || extension === 'xlsx') return 'spreadsheet'
  if (extension === 'docx') return 'word'
  if (extension === 'pptx') return 'presentation'
  return null
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
  const [fileModes, setFileModes] = useState<Record<string, 'preview' | 'source'>>({})
  const [loadingTree, setLoadingTree] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [treeReady, setTreeReady] = useState(false)
  const [fileTreeWidth, setFileTreeWidth] = useState(readStoredFileTreeWidth)
  const [isResizingFileTree, setIsResizingFileTree] = useState(false)
  const [expandedPreviewPath, setExpandedPreviewPath] = useState<string | null>(null)
  const treeReadyRef = useRef(false)
  const treeRequestRef = useRef(0)
  const fileRequestGenerationRef = useRef(0)
  const openPathsRef = useRef<string[]>([])
  const activePathRef = useRef('')
  const activeTabRef = useRef<HTMLDivElement | null>(null)
  const workspaceGridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(WORKSPACE_FILE_TREE_WIDTH_STORAGE_KEY, String(fileTreeWidth))
    } catch {
      // Ignore storage failures; resizing should still work for this session.
    }
  }, [fileTreeWidth])

  useEffect(() => {
    if (!isResizingFileTree || typeof window === 'undefined') return

    const updateWidthFromPointer = (clientX: number) => {
      const container = workspaceGridRef.current
      if (!container) return
      const bounds = container.getBoundingClientRect()
      if (bounds.width <= 0) return
      setFileTreeWidth(clampFileTreeWidth(((clientX - bounds.left) / bounds.width) * 100))
    }
    const handlePointerMove = (event: PointerEvent) => updateWidthFromPointer(event.clientX)
    const handlePointerUp = () => setIsResizingFileTree(false)

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isResizingFileTree])

  useEffect(() => {
    if (!expandedPreviewPath) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedPreviewPath(null)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [expandedPreviewPath])

  const loadFile = useCallback(async (filePath: string, requestGeneration: number) => {
    const response = await workspaceApi.getFile(chatRoomId, filePath)
    if (fileRequestGenerationRef.current !== requestGeneration || !openPathsRef.current.includes(filePath)) return

    if (response.success && response.data) {
      setFiles((current) => ({ ...current, [filePath]: { preview: response.data!.file, loading: false, error: null } }))
    } else {
      setFiles((current) => ({ ...current, [filePath]: { preview: null, loading: false, error: response.error || t('chat.workspaceReadFailed') } }))
    }
  }, [chatRoomId, t])

  const loadTree = useCallback(async (options?: { restoreOpenFiles?: boolean }) => {
    const requestId = treeRequestRef.current + 1
    treeRequestRef.current = requestId
    setLoadingTree(true)
    setTreeError(null)
    treeReadyRef.current = false
    setTreeReady(false)
    const response = await workspaceApi.getTree(chatRoomId)
    if (treeRequestRef.current !== requestId) return

    if (response.success && response.data) {
      const nextEntries = response.data.entries
      const availableFiles = new Set(nextEntries.filter((entry) => entry.kind === 'file').map((entry) => entry.path))
      const persisted = options?.restoreOpenFiles ? readPersistedWorkspaceFileState(chatRoomId) : null
      const canRestore = persisted?.root === response.data.root
      const pathsToKeep = (options?.restoreOpenFiles
        ? (canRestore ? persisted?.openPaths ?? [] : [])
        : openPathsRef.current
      ).filter((path) => availableFiles.has(path))
      const preferredActivePath = options?.restoreOpenFiles
        ? (canRestore ? persisted?.activePath ?? '' : '')
        : activePathRef.current
      const nextActivePath = pathsToKeep.includes(preferredActivePath)
        ? preferredActivePath
        : pathsToKeep.at(-1) ?? ''

      setRoot(response.data.root)
      setEntries(nextEntries)
      setCollapsed(allDirectoryPaths(nextEntries))
      setRootCollapsed(false)
      openPathsRef.current = pathsToKeep
      activePathRef.current = nextActivePath
      setOpenPaths(pathsToKeep)
      setActivePath(nextActivePath)
      setFiles((current) => {
        const next: Record<string, FileState> = {}
        for (const path of pathsToKeep) {
          if (current[path]) next[path] = current[path]
        }
        return next
      })
      treeReadyRef.current = true
      setTreeReady(true)
    } else {
      setTreeError(response.error || t('chat.workspaceLoadFailed'))
    }
    setLoadingTree(false)
  }, [chatRoomId, t])

  const handleFileTreeResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    setIsResizingFileTree(true)
  }, [])

  const handleFileTreeResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const step = event.shiftKey ? 5 : 2
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    setFileTreeWidth((current) => clampFileTreeWidth(current + direction * step))
  }, [])

  useEffect(() => {
    fileRequestGenerationRef.current += 1
    treeReadyRef.current = false
    openPathsRef.current = []
    activePathRef.current = ''
    setOpenPaths([])
    setActivePath('')
    setFiles({})
    setFileModes({})
    setExpandedPreviewPath(null)
    void loadTree({ restoreOpenFiles: true })
  }, [chatRoomId, loadTree])

  useEffect(() => {
    openPathsRef.current = openPaths
  }, [openPaths])

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  useEffect(() => {
    if (!treeReady || !treeReadyRef.current) return

    const availableFiles = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path))
    const pathsToLoad = openPaths.filter((path) => availableFiles.has(path) && !files[path])
    if (pathsToLoad.length === 0) return

    setFiles((current) => {
      const next = { ...current }
      for (const path of pathsToLoad) {
        if (!next[path]) next[path] = { preview: null, loading: true, error: null }
      }
      return next
    })

    for (const path of pathsToLoad) {
      void loadFile(path, fileRequestGenerationRef.current)
    }
  }, [entries, files, loadFile, openPaths, treeReady])

  useEffect(() => {
    if (!treeReady || !treeReadyRef.current || !root) return
    persistWorkspaceFileState(chatRoomId, { root, openPaths, activePath })
  }, [activePath, chatRoomId, openPaths, root, treeReady])

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activePath])

  const openFile = useCallback((entry: WorkspaceEntry) => {
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
    activePathRef.current = entry.path
    if (!openPathsRef.current.includes(entry.path)) {
      const nextOpenPaths = [...openPathsRef.current, entry.path]
      openPathsRef.current = nextOpenPaths
      setOpenPaths(nextOpenPaths)
    }
  }, [])

  const closeFile = (filePath: string) => {
    const nextOpenPaths = openPathsRef.current.filter((path) => path !== filePath)
    openPathsRef.current = nextOpenPaths
    setOpenPaths(nextOpenPaths)
    setFiles((current) => {
      const next = { ...current }
      delete next[filePath]
      return next
    })
    if (activePathRef.current === filePath) {
      const nextActivePath = nextOpenPaths.at(-1) ?? ''
      activePathRef.current = nextActivePath
      setActivePath(nextActivePath)
    }
  }

  const activeFileState = activePath ? files[activePath] : null
  const activePreview = activeFileState?.preview ?? null
  const fileMode = fileModes[activePath] ?? 'preview'
  const activePreviewSupportsModeToggle = activePreview?.kind === 'text'
    && (isMarkdownFile(activePreview.path) || isHtmlFile(activePreview.path))
  const activeDocumentKind = activePreview?.kind === 'document' ? workspaceDocumentKind(activePreview.path) : null
  const isPreviewExpanded = !!activePreview && expandedPreviewPath === activePath
  const previewOverlayHasNativeTitlebar = window.electronAPI?.isElectron && window.electronAPI.platform === 'darwin'
  const previewOverlayTop = window.electronAPI?.isElectron && !previewOverlayHasNativeTitlebar ? 'top-8' : 'top-0'
  const visible = useMemo(() => visibleEntries(entries, collapsed), [collapsed, entries])

  const renderWorkspacePreview = (expanded = false) => {
    if (!activePreview) return null
    if (activePreview.kind === 'image') {
      return <div className="grid h-full place-items-center overflow-auto bg-muted/20 p-5"><img src={`data:${activePreview.mimeType};base64,${activePreview.content}`} alt={activePreview.name} className="max-h-full max-w-full rounded-lg border border-border object-contain shadow-sm" /></div>
    }
    if (activePreview.kind === 'document') {
      return (
        <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">{t('common.loading')}</div>}>
          {activeDocumentKind === 'pdf' ? <WorkspacePdfPreview path={activePreview.path} content={activePreview.content} /> : activeDocumentKind === 'spreadsheet' ? <WorkspaceSpreadsheetPreview path={activePreview.path} content={activePreview.content} /> : activeDocumentKind === 'word' ? <WorkspaceDocxPreview path={activePreview.path} content={activePreview.content} /> : activeDocumentKind === 'presentation' ? <WorkspacePptxPreview path={activePreview.path} content={activePreview.content} /> : <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">{t('chat.workspaceUnsupported', { size: formatFileSize(activePreview.size) })}</div>}
        </Suspense>
      )
    }
    if (activePreview.kind === 'unsupported') {
      return <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">{t('chat.workspaceUnsupported', { size: formatFileSize(activePreview.size) })}</div>
    }
    if (activePreview.kind === 'text') {
      return (
        <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted-foreground">{t('common.loading')}</div>}>
          {isMarkdownFile(activePreview.path) && fileMode === 'preview' ? <WorkspaceMarkdownPreview path={activePreview.path} content={activePreview.content} /> : isHtmlFile(activePreview.path) && fileMode === 'preview' ? <iframe title={`HTML 预览：${activePreview.path}`} sandbox="" srcDoc={activePreview.content} referrerPolicy="no-referrer" className="h-full w-full border-0 bg-white" /> : <WorkspaceMonacoPreview path={activePreview.path} content={activePreview.content} onExpand={expanded ? undefined : () => setExpandedPreviewPath(activePath)} expandLabel={t('chat.workspaceExpandCode')} />}
        </Suspense>
      )
    }
    return null
  }

  return (
    <div
      ref={workspaceGridRef}
      className={cn('grid h-full min-h-0', isResizingFileTree && 'select-none')}
      style={{ gridTemplateColumns: `minmax(170px, ${fileTreeWidth}%) 8px minmax(0, 1fr)` }}
    >
      <aside className="min-h-0 min-w-0 overflow-y-auto bg-muted/20" aria-label={t('chat.workspaceFileTree')}>
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

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('chat.workspaceResizeFileTree')}
        aria-valuemin={MIN_FILE_TREE_WIDTH}
        aria-valuemax={MAX_FILE_TREE_WIDTH}
        aria-valuenow={Math.round(fileTreeWidth)}
        tabIndex={0}
        onPointerDown={handleFileTreeResizeStart}
        onKeyDown={handleFileTreeResizeKeyDown}
        className={cn(
          'group relative z-20 flex min-w-0 cursor-col-resize touch-none items-center justify-center border-x border-border/70 bg-muted/10 outline-none transition-colors hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-inset',
          isResizingFileTree && 'bg-primary/10',
        )}
      >
        <span className="absolute inset-y-0 -left-4 -right-4 cursor-col-resize touch-none" aria-hidden="true" />
        <GripVertical className="pointer-events-none relative z-10 size-3.5 text-muted-foreground/60 transition-colors group-hover:text-primary group-focus-visible:text-primary" />
      </div>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-card" aria-label={t('chat.workspacePreview')}>
        {openPaths.length > 0 && (
          <div className="flex h-9 shrink-0 border-b border-border bg-muted/20">
            <div className="flex min-w-0 flex-1 overflow-x-auto" role="tablist" aria-label={t('chat.workspaceOpenFiles')}>
              {openPaths.map((path) => {
                const active = path === activePath
                const name = path.split('/').at(-1) || path
                return (
                  <div ref={active ? activeTabRef : undefined} key={path} className={cn('group relative flex min-w-[120px] max-w-[210px] shrink-0 items-center border-r border-border', active ? 'bg-card' : 'text-muted-foreground')}>
                    {active && <span className="pointer-events-none absolute inset-x-0 bottom-[-1px] z-10 h-0.5 bg-primary" aria-hidden="true" />}
                    <button
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 text-left text-[11px]"
                      title={path}
                      onClick={() => {
                        activePathRef.current = path
                        setActivePath(path)
                      }}
                    >
                      <MaterialFileIcon name={name} />
                      <span className="min-w-0 truncate">{name}</span>
                    </button>
                    <button type="button" className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100" title={`${t('common.close')} ${name}`} aria-label={`${t('common.close')} ${name}`} onClick={() => closeFile(path)}><X className="size-3" /></button>
                  </div>
                )
              })}
            </div>
            <div className="flex w-10 shrink-0 items-center justify-center border-l border-border bg-muted/20">
              <button
                type="button"
                className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                onClick={() => setExpandedPreviewPath(activePath)}
                disabled={!activePreview || !!activeFileState?.loading || !!activeFileState?.error}
                title={t('chat.workspaceExpandPreview')}
                aria-label={t('chat.workspaceExpandPreview')}
              >
                <Maximize2 className="size-3.5" />
              </button>
            </div>
          </div>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {activePreviewSupportsModeToggle && (
            <div className="absolute right-3 top-3 z-10 flex items-center rounded-md border border-border bg-card/95 p-0.5 text-[10px] shadow-sm">
              <button type="button" className={cn('flex items-center gap-1 rounded px-2 py-1', fileMode === 'preview' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')} onClick={() => setFileModes((current) => ({ ...current, [activePath]: 'preview' }))}><Eye className="size-3" />{t('chat.workspacePreview')}</button>
              <button type="button" className={cn('flex items-center gap-1 rounded px-2 py-1', fileMode === 'source' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent')} onClick={() => setFileModes((current) => ({ ...current, [activePath]: 'source' }))}><Code2 className="size-3" />{t('chat.workspaceSource')}</button>
            </div>
          )}
          {!activePath ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground"><FileText className="size-8 opacity-50" /><span>{t('chat.workspaceSelectFile')}</span></div>
          ) : activeFileState?.loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('common.loading')}</div>
          ) : activeFileState?.error ? (
            <div className="p-4 text-xs text-destructive">{activeFileState.error}</div>
          ) : activePreview ? (
            isPreviewExpanded ? null : renderWorkspacePreview()
          ) : null}
        </div>
      </section>

      {isPreviewExpanded && activePreview && (
        <div
          className={cn(
            'fixed inset-x-0 bottom-0 z-[70] flex min-h-0 flex-col bg-card',
            previewOverlayTop,
          )}
          role="dialog"
          aria-modal="true"
          aria-label={t('chat.workspaceExpandPreview')}
        >
          {previewOverlayHasNativeTitlebar && <div className="workspace-preview-titlebar h-10 shrink-0 bg-card" aria-hidden="true" />}
          <div
            className="workspace-preview-titlebar flex h-11 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3"
            style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as CSSProperties : undefined}
          >
            <MaterialFileIcon name={activePreview.name} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium" title={activePreview.path}>{activePreview.path}</span>
            <button
              type="button"
              className="workspace-preview-titlebar-action rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as CSSProperties : undefined}
              onClick={() => setExpandedPreviewPath(null)}
              title={t('chat.workspaceCollapsePreview')}
              aria-label={t('chat.workspaceCollapsePreview')}
            >
              <Minimize2 className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {renderWorkspacePreview(true)}
          </div>
        </div>
      )}
    </div>
  )
}

function FolderTreeIcon() {
  return <FolderOpen className="size-4 shrink-0 text-primary" />
}
