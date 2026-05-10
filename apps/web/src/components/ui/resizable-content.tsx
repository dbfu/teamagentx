import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import * as React from 'react'

interface ResizableContentProps {
  children: React.ReactNode
  /** 初始高度，默认 96 (24rem) */
  initialHeight?: number
  /** 最小高度，默认 60 */
  minHeight?: number
  /** 最大高度，默认 400 */
  maxHeight?: number
  /** 标题 */
  label?: string
  /** 额外的 className */
  className?: string
  /** 内容区域的 className */
  contentClassName?: string
}

export function ResizableContent({
  children,
  initialHeight = 120,
  minHeight = 90,
  maxHeight = 500,
  label,
  className,
  contentClassName,
}: ResizableContentProps) {
  const [height, setHeight] = React.useState(initialHeight)
  const [isResizing, setIsResizing] = React.useState(false)
  const [isHovered, setIsHovered] = React.useState(false)
  const startYRef = React.useRef(0)
  const startHeightRef = React.useRef(0)

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    startYRef.current = e.clientY
    startHeightRef.current = height
  }, [height])

  React.useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startYRef.current
      const newHeight = Math.min(maxHeight, Math.max(minHeight, startHeightRef.current + deltaY))
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, minHeight, maxHeight])

  return (
    <div className={className}>
      {label && <div className="text-xs text-muted-foreground mb-1">{label}:</div>}
      {/* 外层容器 */}
      <div
        className={cn(
          'relative font-mono text-foreground bg-muted rounded border border-border',
          isResizing && 'select-none',
          contentClassName
        )}
        style={{ height }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 内容滚动区域 */}
        <div className="overflow-y-auto h-[calc(100%-16px)] p-2">
          {children}
        </div>
        {/* 拖拽手柄固定在底部 */}
        <div
          className={cn(
            'absolute bottom-0 left-0 right-0 h-4 cursor-row-resize flex items-center justify-center rounded-b',
            'transition-colors',
            isResizing && 'bg-primary/10'
          )}
          onMouseDown={handleMouseDown}
        >
          <ChevronDown className={cn(
            'size-3 text-muted-foreground transition-opacity',
            isHovered || isResizing ? 'opacity-100' : 'opacity-0',
            isResizing && 'text-primary'
          )} />
        </div>
      </div>
    </div>
  )
}