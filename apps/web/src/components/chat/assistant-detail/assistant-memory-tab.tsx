import { agentApi } from '@/lib/agent-api'
import { Button } from '@/components/ui/button'
import { Loader2, Save, RotateCcw, Brain } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface MemoryEditorProps {
  label: string
  description: string
  icon: React.ReactNode
  content: string
  filePath: string
  loading: boolean
  saving: boolean
  onChange: (value: string) => void
  onSave: () => void
  onReset: () => void
}

function MemoryEditor({
  label,
  description,
  icon,
  content,
  filePath,
  loading,
  saving,
  onChange,
  onSave,
  onReset,
}: MemoryEditorProps) {
  const { t } = useTranslation()

  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
          <div>
            <div className="font-medium text-sm text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={loading || saving}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="size-3" />
            {t('common.reset')}
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={loading || saving}
            className="gap-1.5 text-xs bg-blue-500 hover:bg-blue-600"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            {t('common.save')}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">{t('common.loading')}</span>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('assistant.memoryPlaceholder')}
          className="w-full min-h-[200px] resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none bg-muted/30 placeholder:text-muted-foreground/50"
        />
      )}

      {filePath && (
        <div className="text-xs text-muted-foreground truncate" title={filePath}>
          {t('assistant.memoryFile')}：{filePath}
        </div>
      )}
    </div>
  )
}

interface AssistantMemoryTabProps {
  agentId: string
}

export function AssistantMemoryTab({ agentId }: AssistantMemoryTabProps) {
  const { t } = useTranslation()
  const [globalContent, setGlobalContent] = useState('')
  const [globalFilePath, setGlobalFilePath] = useState('')
  const [globalOriginal, setGlobalOriginal] = useState('')
  const [globalLoading, setGlobalLoading] = useState(true)
  const [globalSaving, setGlobalSaving] = useState(false)

  const loadGlobalMemory = useCallback(async () => {
    setGlobalLoading(true)
    try {
      const res = await agentApi.getMemory(agentId)
      if (res.success && res.data) {
        setGlobalContent(res.data.content)
        setGlobalOriginal(res.data.content)
        setGlobalFilePath(res.data.filePath)
      }
    } catch {
      toast.error(t('assistant.globalMemoryLoadFailed'))
    } finally {
      setGlobalLoading(false)
    }
  }, [agentId, t])

  useEffect(() => {
    loadGlobalMemory()
  }, [loadGlobalMemory])

  const saveGlobalMemory = async () => {
    setGlobalSaving(true)
    try {
      const res = await agentApi.updateMemory(agentId, globalContent)
      if (res.success) {
        setGlobalOriginal(globalContent)
        toast.success(t('assistant.globalMemorySaved'))
      } else {
        toast.error(t('common.saveFailed'))
      }
    } finally {
      setGlobalSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm text-muted-foreground">
        {t('assistant.memoryDesc')}
      </div>

      <MemoryEditor
        label={t('assistant.globalMemory')}
        description={t('assistant.globalMemoryDesc')}
        icon={<Brain className="size-4" />}
        content={globalContent}
        filePath={globalFilePath}
        loading={globalLoading}
        saving={globalSaving}
        onChange={setGlobalContent}
        onSave={saveGlobalMemory}
        onReset={() => setGlobalContent(globalOriginal)}
      />
    </div>
  )
}
