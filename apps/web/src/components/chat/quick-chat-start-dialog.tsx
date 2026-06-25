import { useEffect, useState } from 'react'
import { FolderOpen, MessageSquare } from 'lucide-react'
import { Agent } from '@/lib/agent-api'
import { FormDialog } from '@/components/ui/form-dialog'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { useTranslation } from 'react-i18next'

interface QuickChatStartDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent | null
  onConfirm: (workDir?: string) => Promise<void>
  loading?: boolean
}

export function QuickChatStartDialog({
  open,
  onOpenChange,
  agent,
  onConfirm,
  loading = false,
}: QuickChatStartDialogProps) {
  const { t } = useTranslation()
  const [workDir, setWorkDir] = useState('')

  useEffect(() => {
    if (open) {
      setWorkDir('')
    }
  }, [open, agent?.id])

  const handleSelectFolder = async () => {
    if (!window.electronAPI?.isElectron) return
    const result = await window.electronAPI.selectFolder()
    if (result.success && result.path) {
      setWorkDir(result.path)
    }
  }

  const handleConfirm = async () => {
    await onConfirm(workDir.trim() || undefined)
  }

  if (!agent) return null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <div className="flex items-center gap-3">
          <AgentAvatarImage
            avatar={agent.avatar}
            agentId={agent.id}
            agentName={agent.name}
            agentLevel={agent.agentLevel}
            className="size-9"
          />
          <div className="min-w-0">
            <div className="truncate">{t('chat.quickChatDialogTitle', { name: agent.name })}</div>
            <div className="mt-0.5 flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <MessageSquare className="size-3.5" />
              {t('chat.quickChatDialogSubtitle')}
            </div>
          </div>
        </div>
      }
      confirmText={t('chat.startQuickChat')}
      onConfirm={handleConfirm}
      loading={loading}
      width="w-[30rem]"
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {t('chat.quickChatWorkDirLabel')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder={t('chat.quickChatWorkDirPlaceholder')}
              className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              disabled={loading}
            />
            {window.electronAPI?.isElectron && (
              <button
                type="button"
                onClick={handleSelectFolder}
                disabled={loading}
                className="flex items-center justify-center rounded-lg border border-input px-3 py-2 text-muted-foreground hover:bg-accent disabled:opacity-50"
                title={t('common.selectDirectory')}
              >
                <FolderOpen className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('chat.quickChatWorkDirHint')}
          </p>
        </div>

        {agent.workDir && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">{t('chat.assistantDefaultDir')}</div>
            <div className="mt-1 break-all font-mono text-sm text-foreground">{agent.workDir}</div>
          </div>
        )}
      </div>
    </FormDialog>
  )
}
