import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { MainNavTab } from '@/stores/ui-store'

interface SortableNavItemProps {
  id: MainNavTab
  icon: LucideIcon
  label: string
  isActive: boolean
  onClick: () => void
  isElectron: boolean
  badge?: number
}

/**
 * 可拖拽排序的侧边栏导航项
 * 长按 300ms 后激活拖拽，防止误触
 */
export function SortableNavItem({
  id,
  icon: Icon,
  label,
  isActive,
  onClick,
  isElectron,
  badge,
}: SortableNavItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <button
      ref={setNodeRef}
      style={{
        ...style,
        ...(isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}),
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
        isDragging && 'opacity-50 scale-105 z-50',
        isActive
          ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
          : 'text-muted-foreground hover:bg-sidebar-accent'
      )}
      title={label}
    >
      <Icon className="size-5" />
      <span className="text-xs">{label}</span>
      {!!badge && badge > 0 && (
        <span className="absolute right-3 top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
          {badge > 99 ? '99' : badge}
        </span>
      )}
    </button>
  )
}