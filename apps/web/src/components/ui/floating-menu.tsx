import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface FloatingMenuProps {
  /** 是否显示菜单 */
  open: boolean
  /** 触发位置（通常为鼠标/触摸的 clientX / clientY） */
  x: number
  y: number
  /** 点击遮罩或按下时关闭 */
  onClose: () => void
  children: React.ReactNode
  /** 菜单容器额外样式（如 min-w、py 等已有默认值，可覆盖） */
  className?: string
  /** 菜单 z-index，遮罩为该值 - 1。默认 50 */
  zIndex?: number
  /** 距离视口边缘的最小留白，默认 8px */
  margin?: number
}

/**
 * 通用右键 / 长按浮动菜单。
 * 负责 portal、点击外部关闭的遮罩，以及视口边界检测：
 * 当菜单贴近右边 / 底部会自动向左 / 向上收，避免被裁剪出屏幕。
 *
 * 菜单项仍由调用方以 children 形式传入，保持各处原有样式与逻辑。
 */
export function FloatingMenu({
  open,
  x,
  y,
  onClose,
  children,
  className,
  zIndex = 50,
  margin = 8,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 测量菜单尺寸后做边界 clamp，在绘制前调整位置避免闪烁
  useLayoutEffect(() => {
    if (!open) return
    const el = menuRef.current
    if (!el) return

    const { width, height } = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x
    let top = y

    // 右边放不下：优先向左收；仍放不下则贴左边
    if (left + width + margin > vw) {
      left = Math.max(margin, vw - width - margin)
    }
    // 底部放不下：优先向上翻；仍放不下则贴顶部
    if (top + height + margin > vh) {
      top = Math.max(margin, vh - height - margin)
    }

    left = Math.max(margin, left)
    top = Math.max(margin, top)

    setPos({ left, top })
  }, [open, x, y, margin])

  if (!open) return null

  const layer = (
    <>
      <div
        className="fixed inset-0"
        style={{ zIndex: zIndex - 1 }}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={menuRef}
        className={cn(
          'fixed min-w-[120px] rounded-lg bg-popover py-1 shadow-lg border border-border pointer-events-auto',
          className
        )}
        style={{ left: pos.left, top: pos.top, zIndex }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  )

  return typeof document === 'undefined' ? layer : createPortal(layer, document.body)
}
