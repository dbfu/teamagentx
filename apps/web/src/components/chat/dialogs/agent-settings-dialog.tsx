import { useState, useEffect } from 'react'
import { Agent } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { FormDialog } from '@/components/ui/form-dialog'
import { Switch } from '@/components/ui/switch'

interface AgentSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent | null
  initialInjectGroupHistory?: boolean
  onSave: (settings: { injectGroupHistory: boolean }) => Promise<void>
  mode: 'add' | 'edit'
}

export function AgentSettingsDialog({
  open,
  onOpenChange,
  agent,
  initialInjectGroupHistory = true,
  onSave,
  mode,
}: AgentSettingsDialogProps) {
  const [injectGroupHistory, setInjectGroupHistory] = useState(initialInjectGroupHistory)
  const [saving, setSaving] = useState(false)

  // 重置状态
  useEffect(() => {
    if (open) {
      setInjectGroupHistory(initialInjectGroupHistory)
    }
  }, [open, initialInjectGroupHistory])

  const handleSave = async () => {
    if (!agent) return

    setSaving(true)
    try {
      await onSave({
        injectGroupHistory,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  if (!agent) return null

  const title = mode === 'add' ? `添加 ${agent.name}` : `${agent.name} 设置`;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <div className="flex items-center gap-3">
          <AgentAvatarImage avatar={agent.avatar} className="size-9" />
          {title}
        </div>
      }
      confirmText={mode === 'add' ? '添加' : '保存'}
      onConfirm={handleSave}
      loading={saving}
      width="w-96"
    >
      <div className="space-y-4">
        {/* 注入群历史消息 */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">注入群历史消息</div>
            <div className="text-xs text-muted-foreground">作为上下文提供给助手</div>
          </div>
          <Switch
            checked={injectGroupHistory}
            onCheckedChange={setInjectGroupHistory}
            disabled={saving}
          />
        </div>

      </div>
    </FormDialog>
  )
}
