import { Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="清空消息"
      description="确定要清空该群组的所有消息吗？此操作不可撤销。"
      confirmText="确定"
      onConfirm={onClear}
      loading={clearing}
      icon={Trash2}
    />
  )
}