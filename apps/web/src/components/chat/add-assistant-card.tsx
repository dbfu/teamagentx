import { Plus } from 'lucide-react'

interface AddAssistantCardProps {
  onClick: () => void
}

export function AddAssistantCard({ onClick }: AddAssistantCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-primary shadow-sm shadow-primary/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/10 hover:shadow-md hover:shadow-primary/10 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/25 transition-transform duration-200 group-hover:scale-105 group-hover:bg-primary/90">
        <Plus className="size-5" />
      </span>
      <span className="text-xs font-medium text-primary transition-colors group-hover:text-primary/80">
        添加助手
      </span>
    </button>
  )
}
