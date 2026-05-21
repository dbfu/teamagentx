import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export function CategoryToggleButton({
  expanded,
  label,
  count,
  onClick,
  className,
}: {
  expanded: boolean
  label: string
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80",
        className
      )}
    >
      {expanded ? (
        <ChevronDown className="size-4 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-4 text-muted-foreground" />
      )}
      {expanded ? (
        <FolderOpen className="size-4 text-primary" />
      ) : (
        <Folder className="size-4 text-muted-foreground" />
      )}
      <span>{label}</span>
      <span className="text-muted-foreground">({count})</span>
    </button>
  )
}
