import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface MessageHoverToolbarProps {
  /** 是否显示工具条 */
  open: boolean
  /** 锚点元素（消息气泡），工具条相对它定位在右上角 */
  anchorRef: React.RefObject<HTMLElement | null>
  /** 鼠标进入工具条（用于在气泡与工具条之间移动时保持显示） */
  onMouseEnter?: () => void
  /** 鼠标离开工具条 */
  onMouseLeave?: () => void
  children: React.ReactNode
  className?: string
  /** z-index，默认 50 */
  zIndex?: number
  /** 距离视口边缘的最小留白，默认 8px */
  margin?: number
  /** 工具条与气泡顶边之间的间距，默认 6px */
  gap?: number
}

/**
 * 消息 hover 浮动工具条。
 * 鼠标悬停消息气泡时，在气泡「右上角」浮出一排图标按钮。
 * 通过 portal 渲染避免被气泡的 overflow-hidden 裁剪，并动态测量自身尺寸 +
 * 锚点位置做边界 clamp：上方空间不足时翻到气泡内部右上角，水平超出时向左收。
 */
export function MessageHoverToolbar({
  open,
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  children,
  className,
  zIndex = 50,
  margin = 8,
  gap = 6,
}: MessageHoverToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const compute = useCallback(() => {
    const anchor = anchorRef.current
    const el = toolbarRef.current
    if (!anchor || !el) return

    const rect = anchor.getBoundingClientRect()
    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth

    // 始终固定在气泡右上角上方：底边贴气泡顶边，右边对齐气泡右边。
    // 顶部不做 clamp——允许工具条溢出到视口外/被 header 盖住，而不是翻进气泡内部。
    const top = rect.top - height - gap
    let left = rect.right - width

    // 仅做水平边界 clamp
    left = Math.min(left, vw - width - margin)
    left = Math.max(margin, left)

    setPos({ left, top })
  }, [anchorRef, gap, margin])

  // 打开后测量并定位，绘制前完成避免闪烁；监听 resize 重新计算
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [open, compute])

  if (!open) return null

  const layer = (
    <div
      ref={toolbarRef}
      className={cn(
        'fixed flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg pointer-events-auto transition-opacity',
        pos ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )

  return typeof document === 'undefined' ? layer : createPortal(layer, document.body)
}
