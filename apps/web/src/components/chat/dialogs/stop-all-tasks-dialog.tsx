import { Square } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslation } from 'react-i18next'

interface StopAllTasksDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskCount: number
  onConfirm: () => void
}

export function StopAllTasksDialog({
  open,
  onOpenChange,
  taskCount,
  onConfirm,
}: StopAllTasksDialogProps) {
  const { t } = useTranslation()

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('chat.stopAllTasks')}
      description={t('chat.stopAllTasksDesc', { count: taskCount })}
      confirmText={t('common.stop')}
      cancelText={t('common.cancel')}
      icon={Square}
      iconColor="text-red-500"
      iconBgColor="bg-red-500/10"
      confirmButtonClass="bg-red-500 hover:bg-red-600"
      onConfirm={onConfirm}
    />
  )
}
