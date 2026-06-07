import { Agent, agentApi } from '@/lib/agent-api'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTime } from '@/lib/utils'
import {
  Sparkles,
  Brain,
  Cpu,
  Globe,
  Folder,
  Clock,
  FileText,
  Database,
  Tag,
  Pencil,
  X,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { promptOptimizeApi } from '@/lib/prompt-optimize-api'

function FullscreenPromptModal({
  isOpen,
  prompt,
  onClose,
  onConfirm,
  isSaving,
}: {
  isOpen: boolean
  prompt: string
  onClose: () => void
  onConfirm: (prompt: string) => void
  isSaving?: boolean
}) {
  const { t } = useTranslation()
  const [editPrompt, setEditPrompt] = useState(prompt)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen) {
      setEditPrompt(prompt)
    }
  }, [isOpen, prompt])

  const handleOptimize = async () => {
    if (!editPrompt.trim() || isOptimizing) return

    setIsOptimizing(true)
    setEditPrompt('')

    await promptOptimizeApi.optimizeStream(
      editPrompt,
      (content) => {
        setEditPrompt((prev) => prev + content)
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight
        }
      },
      () => {
        setIsOptimizing(false)
        toast.success(t('assistant.promptOptimized'))
      },
      (error) => {
        setIsOptimizing(false)
        toast.error(error || t('assistant.optimizeFailed'))
      },
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{t('assistant.editPrompt')}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-6">
          <textarea
            ref={textareaRef}
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder={t('assistant.promptPlaceholder')}
            className="h-full w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleOptimize}
            disabled={!editPrompt.trim() || isOptimizing}
            className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-600 hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900"
          >
            {isOptimizing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {t('assistant.optimizePrompt')}
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(editPrompt)}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {t('common.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AssistantConfigTabProps {
  agent: Agent
  onUpdate?: () => void
}

export function AssistantConfigTab({ agent, onUpdate }: AssistantConfigTabProps) {
  const { t } = useTranslation()
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSystemAgent = agent.agentLevel === 'system'

  const thinkingModeLabels: Record<Agent['thinkingMode'], string> = {
    high: t('assistant.thinkingHighShort'),
    medium: t('assistant.thinkingMediumShort'),
    low: t('assistant.thinkingLowShort'),
    off: t('assistant.thinkingOffShort'),
  }

  const handleOpenWorkDir = async (workDir: string) => {
    if (!window.electronAPI?.isElectron) return
    try {
      await window.electronAPI.openFolder(workDir)
    } catch {
      toast.error(t('common.openFolderFailed'))
    }
  }

  const handleSavePrompt = async (newPrompt: string) => {
    if (isSystemAgent) {
      toast.error(t('assistant.systemAssistantCannotModify'))
      return
    }

    setIsSaving(true)
    try {
      await agentApi.update(agent.id, { prompt: newPrompt })
      toast.success(t('assistant.promptUpdated'))
      setIsEditingPrompt(false)
      onUpdate?.()
    } catch {
      toast.error(t('assistant.updateFailed'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <h3 className="font-semibold text-foreground">{t('assistant.systemPrompt')}</h3>
            </div>
            {!isSystemAgent && (
              <button
                onClick={() => setIsEditingPrompt(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-4" />
                {t('common.edit')}
              </button>
            )}
          </div>
        </div>
        <div className="p-6">
          <div className="max-h-100 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-muted p-4 text-sm leading-relaxed text-foreground">
            {agent.prompt || t('assistant.noPrompt')}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h3 className="font-semibold text-foreground">{t('assistant.basicInfo')}</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="flex items-center gap-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/5">
                {agent.type === 'builtin' ? (
                  <Sparkles className="size-5 text-primary" />
                ) : (
                  <Cpu className="size-5 text-primary" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('assistant.assistantType')}</p>
                <p className="font-medium text-foreground">{agent.type === 'builtin' ? t('assistant.builtinAgent') : t('assistant.externalTool')}</p>
              </div>
            </div>

            {agent.type === 'acp' && agent.acpTool && (
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <Globe className="size-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('assistant.acpTool')}</p>
                  <p className="font-medium text-foreground">{agent.acpTool}</p>
                </div>
              </div>
            )}

            {agent.type === 'acp' && (agent.acpTool === 'claude' || agent.acpTool === 'codex') && (
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <Brain className="size-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('assistant.thinkingMode')}</p>
                  <p className="font-medium text-foreground">{thinkingModeLabels[agent.thinkingMode || 'high']}</p>
                </div>
              </div>
            )}

            {agent.llmProvider && (
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
                  <Database className="size-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('assistant.llmProvider')}</p>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{agent.llmProvider.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {agent.llmProvider.model}
                    </Badge>
                  </div>
                </div>
              </div>
            )}

            {agent.category && (
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-orange-500/10">
                  <Tag className="size-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('assistant.category')}</p>
                  <p className="font-medium text-foreground">{agent.category.name}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-4">
              <div
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg',
                  agent.isActive ? 'bg-green-500/10' : 'bg-muted',
                )}
              >
                <div
                  className={cn(
                    'size-2.5 rounded-full',
                    agent.isActive ? 'bg-green-500' : 'bg-muted-foreground',
                  )}
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('assistant.currentStatus')}</p>
                <Badge
                  variant={agent.isActive ? 'default' : 'secondary'}
                  className={cn(
                    agent.isActive
                      ? 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'
                      : '',
                  )}
                >
                  {agent.isActive ? t('assistant.enabled') : t('assistant.disabled')}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {agent.workDir && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <div className="flex items-center gap-2">
              <Folder className="size-5 text-amber-500" />
              <h3 className="font-semibold text-foreground">{t('chat.workDirectory')}</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-amber-500/10 p-3 font-mono text-sm text-foreground">
              <span className="break-all">{agent.workDir}</span>
              {window.electronAPI?.isElectron && (
                <button
                  onClick={() => handleOpenWorkDir(agent.workDir!)}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  title={t('common.openFolder')}
                >
                  <FolderOpen className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {agent.description && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h3 className="font-semibold text-foreground">{t('assistant.description')}</h3>
          </div>
          <div className="p-6">
            <p className="leading-relaxed text-foreground">{agent.description}</p>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">{t('assistant.timeInfo')}</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="mb-1 text-sm text-muted-foreground">{t('common.createTime')}</p>
              <p className="text-foreground">{formatDateTime(agent.createdAt)}</p>
            </div>
            <div>
              <p className="mb-1 text-sm text-muted-foreground">{t('common.updateTime')}</p>
              <p className="text-foreground">{formatDateTime(agent.updatedAt)}</p>
            </div>
          </div>
        </div>
      </div>

      <FullscreenPromptModal
        isOpen={isEditingPrompt}
        prompt={agent.prompt || ''}
        onClose={() => setIsEditingPrompt(false)}
        onConfirm={handleSavePrompt}
        isSaving={isSaving}
      />
    </div>
  )
}
