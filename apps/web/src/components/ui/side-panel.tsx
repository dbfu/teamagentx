import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { ReactNode, Ref, useCallback, useEffect, useRef, useState } from 'react'

interface SidePanelProps {
  open: boolean
  onClose: () => void
  title: string
  icon?: ReactNode
  children: ReactNode
  className?: string
  /** 自定义 overflow 行为，默认为 'auto' */
  overflow?: 'auto' | 'hidden' | 'visible'
  /** Content 区域的 ref，用于控制滚动 */
  contentRef?: Ref<HTMLDivElement>
  /** 浮动在右下角的内容（不受滚动影响） */
  floatingCorner?: ReactNode
  /** 展开状态下的宽度类名 */
  widthClass?: string
  /** 是否移动端模式 */
  isMobile?: boolean
  /** 是否允许桌面端拖拽调整宽度 */
  resizable?: boolean
  /** 默认宽度（px） */
  defaultWidth?: number
  /** 最小宽度（px） */
  minWidth?: number
  /** 最大宽度（px） */
  maxWidth?: number
  /** 宽度本地存储 key */
  storageKey?: string
}

function clampWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(width, minWidth), maxWidth)
}

function getStoredWidth(storageKey: string | undefined, defaultWidth: number, minWidth: number, maxWidth: number) {
  if (!storageKey || typeof window === 'undefined') {
    return defaultWidth
  }

  let storedWidth: number
  try {
    storedWidth = Number(window.localStorage.getItem(storageKey))
  } catch {
    return defaultWidth
  }

  if (!Number.isFinite(storedWidth)) {
    return defaultWidth
  }

  return clampWidth(storedWidth, minWidth, maxWidth)
}

export function SidePanel({
  open,
  onClose,
  title,
  icon,
  children,
  className,
  overflow = 'auto',
  contentRef,
  floatingCorner,
  widthClass = 'w-[370px]',
  isMobile,
  resizable = false,
  defaultWidth = 370,
  minWidth = 300,
  maxWidth = 720,
  storageKey,
}: SidePanelProps) {
  const overflowClass = overflow === 'auto' ? 'overflow-y-auto' : overflow === 'hidden' ? 'overflow-hidden' : 'overflow-visible'
  const [panelWidth, setPanelWidth] = useState(() => getStoredWidth(storageKey, defaultWidth, minWidth, maxWidth))
  const [isResizing, setIsResizing] = useState(false)
  const latestWidthRef = useRef(panelWidth)
  const canResize = resizable && !isMobile

  useEffect(() => {
    latestWidthRef.current = panelWidth
  }, [panelWidth])

  useEffect(() => {
    setPanelWidth((width) => clampWidth(width, minWidth, maxWidth))
  }, [minWidth, maxWidth])

  useEffect(() => {
    if (!storageKey || !canResize || !open || typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.setItem(storageKey, String(panelWidth))
    } catch {
      // Ignore storage failures; resizing should still work for this session.
    }
  }, [canResize, open, panelWidth, storageKey])

  useEffect(() => {
    if (!isResizing || typeof window === 'undefined') {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      setPanelWidth(clampWidth(window.innerWidth - event.clientX, minWidth, maxWidth))
    }

    const handlePointerUp = () => {
      setIsResizing(false)
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [isResizing, maxWidth, minWidth])

  const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!canResize || !open) {
      return
    }

    event.preventDefault()
    setIsResizing(true)
  }, [canResize, open])

  const desktopStyle = canResize
    ? { flexShrink: 0, flexGrow: 0, width: open ? panelWidth : 0 }
    : { flexShrink: 0, flexGrow: 0 }

  // 移动端使用固定定位全宽覆盖
  if (isMobile) {
    return (
      <div
        className={cn(
          'fixed inset-0 z-50 flex flex-col bg-card transition-all duration-150 ease-in-out',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-medium text-foreground">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div
          ref={contentRef}
          className={cn('flex-1', overflowClass, className)}
          style={overflow === 'auto' ? { scrollbarGutter: 'stable' } : undefined}
        >
          {children}
        </div>

        {/* 浮动在底部的内容（不受滚动影响） */}
        {floatingCorner && (
          <div className="absolute bottom-4 left-0 right-0 z-50 pointer-events-none">
            {floatingCorner}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'border-l bg-card flex flex-col h-full overflow-hidden relative',
        isResizing ? 'transition-none' : 'transition-all duration-150 ease-in-out',
        open
          ? cn(canResize ? 'opacity-100 border-border' : `${widthClass} opacity-100 border-border`)
          : 'w-0 opacity-0 border-transparent'
      )}
      style={desktopStyle}
    >
      {canResize && open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="调整面板宽度"
          tabIndex={0}
          onPointerDown={handleResizeStart}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
              return
            }

            event.preventDefault()
            const nextWidth = event.key === 'ArrowLeft'
              ? latestWidthRef.current + 24
              : latestWidthRef.current - 24
            setPanelWidth(clampWidth(nextWidth, minWidth, maxWidth))
          }}
          className="group absolute left-0 top-0 z-20 h-full w-3 -translate-x-1.5 cursor-col-resize outline-none"
        >
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-blue-500 group-focus-visible:bg-blue-500" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-foreground">{title}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        className={cn('flex-1', overflowClass, className)}
        style={overflow === 'auto' ? { scrollbarGutter: 'stable' } : undefined}
      >
        {children}
      </div>

      {/* 浮动在底部的内容（不受滚动影响） */}
      {floatingCorner && (
        <div className="absolute bottom-4 left-0 right-0 z-50 pointer-events-none">
          {floatingCorner}
        </div>
      )}
    </div>
  )
}
