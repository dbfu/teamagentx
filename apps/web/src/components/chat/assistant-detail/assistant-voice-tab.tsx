import { useEffect, useMemo, useState } from 'react'
import { Loader2, PlayCircle, Save, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { Agent, agentApi } from '@/lib/agent-api'
import {
  AGENT_VOICE_PRESETS,
  applyVoicePreset,
  createDefaultAgentSpeechConfig,
  fromVoicePanelConfig,
  inferVoicePresetId,
  toVoicePanelConfig,
  type AgentVoicePanelConfig,
  type AgentVoicePresetId,
} from '@/lib/agent-speech'
import { speakText } from '@/lib/browser-speech'
import { cn } from '@/lib/utils'

interface AssistantVoiceTabProps {
  agent: Agent
  onUpdate?: () => void
}

export function AssistantVoiceTab({ agent, onUpdate }: AssistantVoiceTabProps) {
  const [voiceConfig, setVoiceConfig] = useState<AgentVoicePanelConfig>(
    toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig()),
  )
  const [selectedPresetId, setSelectedPresetId] = useState<AgentVoicePresetId | null>(
    inferVoicePresetId(toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isPreviewing, setIsPreviewing] = useState(false)

  useEffect(() => {
    const incoming = toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())
    setVoiceConfig(incoming)
    setSelectedPresetId(inferVoicePresetId(incoming))
  }, [agent])

  const hasChanges = useMemo(() => {
    const current = JSON.stringify(voiceConfig)
    const incoming = JSON.stringify(toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig()))
    return current !== incoming
  }, [agent, voiceConfig])

  const handlePresetSelect = (presetId: AgentVoicePresetId) => {
    setSelectedPresetId(presetId)
    setVoiceConfig((prev) => ({
      ...applyVoicePreset(prev, presetId),
      enabled: true,
      outputMode: prev.outputMode === 'off' ? 'manual' : prev.outputMode,
    }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await agentApi.update(agent.id, {
        speechConfig: fromVoicePanelConfig(voiceConfig),
      })
      toast.success('语音设置已保存')
      onUpdate?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '语音设置保存失败')
    } finally {
      setIsSaving(false)
    }
  }

  const handlePreview = async () => {
    if (!voiceConfig.enabled) {
      toast.error('请先开启语音')
      return
    }

    setIsPreviewing(true)
    try {
      await speakText({
        text: `你好，我是 ${agent.name}，这是当前语音风格试听。`,
        provider: voiceConfig.provider,
        model: voiceConfig.model,
        voiceId: voiceConfig.voiceId,
        fallbackProvider: voiceConfig.fallbackProvider,
        rate: voiceConfig.speed,
        volume: voiceConfig.volume,
        pitch: voiceConfig.pitch ?? undefined,
        emotion: voiceConfig.emotion,
        style: voiceConfig.style,
        format: voiceConfig.format,
        sampleRate: voiceConfig.sampleRate,
        temperature: voiceConfig.temperature,
        prompt: voiceConfig.prompt,
        agentId: agent.id,
        source: 'assistant-preview',
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '试听失败')
    } finally {
      setIsPreviewing(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/50 px-6 py-4">
          <div className="flex items-center gap-2">
            <Volume2 className="size-5 text-primary" />
            <h3 className="font-semibold text-foreground">语音设置</h3>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <div>
              <p className="font-medium text-foreground">开启语音</p>
              <p className="mt-1 text-sm text-muted-foreground">开启后，助手消息可以手动或自动播报。</p>
            </div>
            <button
              type="button"
              onClick={() => setVoiceConfig((prev) => ({
                ...prev,
                enabled: !prev.enabled,
                outputMode: !prev.enabled && prev.outputMode === 'off' ? 'manual' : prev.outputMode,
              }))}
              className={cn(
                'relative h-5 w-10 rounded-full transition-colors',
                voiceConfig.enabled ? 'bg-blue-500' : 'bg-gray-200',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-4 rounded-full bg-white transition-transform',
                  voiceConfig.enabled ? 'translate-x-5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-foreground">播报方式</label>
            <select
              value={voiceConfig.outputMode}
              disabled={!voiceConfig.enabled}
              onChange={(e) => setVoiceConfig((prev) => ({
                ...prev,
                outputMode: e.target.value as AgentVoicePanelConfig['outputMode'],
              }))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
            >
              <option value="off">关闭</option>
              <option value="manual">手动播放</option>
              <option value="auto_final_only">自动播报最终回答</option>
            </select>
          </div>

          <div>
            <div className="mb-2">
              <p className="text-sm font-medium text-foreground">内置语音风格</p>
              <p className="mt-1 text-xs text-muted-foreground">先用几种现成风格跑起来，复杂语音参数不直接暴露给用户。</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {AGENT_VOICE_PRESETS.map((preset) => {
                const active = selectedPresetId === preset.id
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!voiceConfig.enabled}
                    onClick={() => handlePresetSelect(preset.id)}
                    className={cn(
                      'rounded-xl border p-4 text-left transition-colors disabled:opacity-60',
                      active
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-border bg-background hover:border-blue-200 hover:bg-blue-50/50',
                    )}
                  >
                    <p className="font-medium text-foreground">{preset.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{preset.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!voiceConfig.enabled || isPreviewing}
              onClick={handlePreview}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {isPreviewing ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
              试听
            </button>

            <button
              type="button"
              disabled={!hasChanges || isSaving}
              onClick={handleSave}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存语音设置
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
