
import { Toaster as Sonner } from 'sonner'

const Toaster = () => {
  return (
    <Sonner
      position="top-center"
      richColors
      toastOptions={{
        actionButtonStyle: {
          backgroundColor: 'rgb(59 130 246)',
          color: 'white',
          borderRadius: '8px',
          fontWeight: 500,
        },
        classNames: {
          toast: 'rounded-xl border border-border bg-background text-foreground shadow-lg',
          title: 'text-sm font-medium text-foreground',
          description: 'text-xs text-muted-foreground',
          actionButton: 'rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600',
        },
      }}
    />
  )
}

export { Toaster }
export { toast } from 'sonner'
