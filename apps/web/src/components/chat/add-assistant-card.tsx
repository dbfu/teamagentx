import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AddAssistantCardProps {
  onClick: () => void
}

export function AddAssistantCard({ onClick }: AddAssistantCardProps) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-blue-200 bg-blue-50/40 p-3 text-blue-600 shadow-sm shadow-blue-500/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md hover:shadow-blue-500/10 active:translate-y-0 active:scale-[0.98] outline-none dark:border-blue-900/70 dark:bg-blue-950/20 dark:text-blue-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/35"
    >
      <span className="flex size-10 items-center justify-center rounded-lg bg-blue-500 text-white shadow-sm shadow-blue-500/25 transition-transform duration-200 group-hover:scale-105 group-hover:bg-blue-600 dark:bg-blue-600 dark:group-hover:bg-blue-500">
        <Plus className="size-5" />
      </span>
      <span className="text-xs font-medium text-blue-600 transition-colors group-hover:text-blue-700 dark:text-blue-300 dark:group-hover:text-blue-200">
        {t('chat.addAssistant')}
      </span>
    </button>
  )
}
