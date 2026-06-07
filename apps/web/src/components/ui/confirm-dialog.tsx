import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => Promise<void> | void
  loading?: boolean
  icon?: LucideIcon
  iconColor?: string
  iconBgColor?: string
  confirmButtonClass?: string
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  onConfirm,
  loading = false,
  icon: Icon = AlertTriangle,
  iconColor = 'text-red-500',
  iconBgColor = 'bg-red-500/10',
  confirmButtonClass = 'bg-red-500 hover:bg-red-600',
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const defaultConfirmText = confirmText || t('common.confirm')
  const defaultCancelText = cancelText || t('common.cancel')
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-sm">
        <div className="flex gap-4">
          <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${iconBgColor}`}>
            <Icon className={`size-5 ${iconColor}`} />
          </div>
          <div className="flex-1">
            <AlertDialogTitle className="text-left text-base">{title}</AlertDialogTitle>
            <AlertDialogDescription className="mt-1 text-left text-sm">
              {description}
            </AlertDialogDescription>
          </div>
        </div>
        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel>{defaultCancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={confirmButtonClass}
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {defaultConfirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}