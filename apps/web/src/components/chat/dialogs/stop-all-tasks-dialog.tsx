import { Square } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

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
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="停止所有任务"
      description={`将停止当前群聊中正在执行的 ${taskCount} 个任务，停止后任务会标记为已取消。`}
      confirmText="停止"
      cancelText="取消"
      icon={Square}
      iconColor="text-red-500"
      iconBgColor="bg-red-500/10"
      confirmButtonClass="bg-red-500 hover:bg-red-600"
      onConfirm={onConfirm}
    />
  )
}
