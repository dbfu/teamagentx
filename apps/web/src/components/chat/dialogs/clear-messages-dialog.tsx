import { Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslation } from 'react-i18next'

interface ClearMessagesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clearing: boolean
  onClear: () => Promise<void>
}

export function ClearMessagesDialog({
  open,
  onOpenChange,
  clearing,
  onClear,
}: ClearMessagesDialogProps) {
  const { t } = useTranslation()

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('chat.clearMessagesDialogTitle')}
      description={t('chat.clearMessagesConfirmDesc')}
      confirmText={t('common.confirm')}
      onConfirm={onClear}
      loading={clearing}
      icon={Trash2}
    />
  )
}
