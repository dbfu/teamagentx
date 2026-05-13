import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Mic2, PlayCircle, Radio, Volume2 } from 'lucide-react'
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
  onUpdate?: (agent?: Agent) => void | Promise<void>
}

export function AssistantVoiceTab({ agent, onUpdate }: AssistantVoiceTabProps) {
  const [voiceConfig, setVoiceConfig] = useState<AgentVoicePanelConfig>(
    toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig()),
  )
  const [selectedPresetId, setSelectedPresetId] = useState<AgentVoicePresetId | null>(
    inferVoicePresetId(toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())),
  )
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const lastSavedConfigRef = useRef(JSON.stringify(toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())))
  const hasHydratedRef = useRef(false)

  useEffect(() => {
    const incoming = toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())
    setVoiceConfig(incoming)
    setSelectedPresetId(inferVoicePresetId(incoming))
    lastSavedConfigRef.current = JSON.stringify(incoming)
    setSaveState('idle')
    setSaveError(null)
    hasHydratedRef.current = true
  }, [agent])

  const hasChanges = useMemo(
    () => JSON.stringify(voiceConfig) !== lastSavedConfigRef.current,
    [voiceConfig],
  )

  const handlePresetSelect = (presetId: AgentVoicePresetId) => {
    setSelectedPresetId(presetId)
    setVoiceConfig((prev) => ({
      ...applyVoicePreset(prev, presetId),
      enabled: true,
      outputMode: prev.outputMode === 'off' ? 'manual' : prev.outputMode,
    }))
  }

  useEffect(() => {
    if (!hasHydratedRef.current || !hasChanges) return

    const timer = window.setTimeout(async () => {
      setSaveState('saving')
      setSaveError(null)

      try {
        const response = await agentApi.update(agent.id, {
          speechConfig: fromVoicePanelConfig(voiceConfig),
        })
        if (!response.success || !response.data) {
          throw new Error(response.error || '语音设置保存失败')
        }
        lastSavedConfigRef.current = JSON.stringify(voiceConfig)
        setSaveState('saved')
        await onUpdate?.(response.data)
      } catch (error) {
        const message = error instanceof Error ? error.message : '语音设置保存失败'
        setSaveState('error')
        setSaveError(message)
        toast.error(message)
      }
    }, 500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [agent.id, hasChanges, onUpdate, voiceConfig])

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

        <div className="space-y-6 p-6">
          <div className="rounded-xl border border-border bg-muted/40 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/5">
                  <Mic2 className="size-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">开启语音</p>
                  <p className="mt-1 text-sm text-muted-foreground">开启后，助手消息可以手动或自动播报。</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {voiceConfig.enabled ? '已开启' : '已关闭'}
                </span>
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
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-primary" />
                <h4 className="font-medium text-foreground">播报方式</h4>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">决定助手回答是手动播放还是自动播报。</p>
            </div>
            <div className="p-5">
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
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h4 className="font-medium text-foreground">内置语音风格</h4>
              <p className="mt-1 text-sm text-muted-foreground">先用现成风格快速跑起来，复杂语音参数先收在系统内部。</p>
            </div>
            <div className="grid gap-3 p-5 md:grid-cols-2">
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
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-border bg-background hover:border-primary/20 hover:bg-accent/40',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{preset.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{preset.description}</p>
                      </div>
                      {active && (
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                          当前
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-foreground">试听与保存状态</p>
                <p className="mt-1 text-sm text-muted-foreground">切换语音后会自动保存，你可以随时试听当前效果。</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!voiceConfig.enabled || isPreviewing}
                  onClick={handlePreview}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  {isPreviewing ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
                  试听
                </button>
                <div className="min-h-5 text-sm">
                  {saveState === 'saving' && (
                    <span className="inline-flex items-center gap-2 text-primary">
                      <Loader2 className="size-4 animate-spin" />
                      正在自动保存
                    </span>
                  )}
                  {saveState === 'saved' && !hasChanges && (
                    <span className="inline-flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 className="size-4" />
                      已自动保存
                    </span>
                  )}
                  {saveState === 'error' && (
                    <span className="text-red-500">
                      {saveError || '自动保存失败'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
