import { ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'

interface FormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  children: ReactNode
  confirmText?: string
  cancelText?: string
  onConfirm: () => Promise<void> | void
  loading?: boolean
  disabled?: boolean
  width?: string
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  loading = false,
  disabled = false,
  width = 'w-80',
}: FormDialogProps) {
  if (!open) return null

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className={`${width} shrink-0 rounded-2xl bg-card shadow-xl`}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={handleCancel}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[50vh] overflow-y-auto p-6">
          {children}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || disabled}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1 inline size-4 animate-spin" />
                处理中...
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  )
}