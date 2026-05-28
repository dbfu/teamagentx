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
      description="确定要清空当前消息吗？现有消息会保存到历史记录，当前聊天将重新开始。"
      confirmText="确定"
      onConfirm={onClear}
      loading={clearing}
      icon={Trash2}
    />
  )
}
