import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { type WorkbenchTaskStatus } from '@/lib/workbench-api'
import { useTranslation } from 'react-i18next'

export const statusMeta: Record<WorkbenchTaskStatus, { labelKey: string; tone: string; columnKey: string }> = {
  draft: { labelKey: 'statusDraft', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', columnKey: 'columnDraft' },
  dispatched: { labelKey: 'statusDispatched', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300', columnKey: 'columnInProgress' },
  in_progress: { labelKey: 'statusInProgress', tone: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300', columnKey: 'columnInProgress' },
  waiting_review: { labelKey: 'statusWaitingReview', tone: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300', columnKey: 'columnWaitingReview' },
  needs_input: { labelKey: 'statusBlocked', tone: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300', columnKey: 'columnNeedsInput' },
  completed: { labelKey: 'statusCompleted', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300', columnKey: 'columnCompleted' },
}

const statusOptions: WorkbenchTaskStatus[] = [
  'draft',
  'dispatched',
  'in_progress',
  'waiting_review',
  'needs_input',
  'completed',
]

export function TaskStatusSelect({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: WorkbenchTaskStatus
  onChange: (status: WorkbenchTaskStatus) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <Select value={value} onValueChange={(val) => onChange(val as WorkbenchTaskStatus)} disabled={disabled}>
      <SelectTrigger size="sm" className={className}>
        <SelectValue>{t(`workbench.${statusMeta[value].labelKey}`)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {statusOptions.map((status) => (
          <SelectItem key={status} value={status}>
            {t(`workbench.${statusMeta[status].labelKey}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}