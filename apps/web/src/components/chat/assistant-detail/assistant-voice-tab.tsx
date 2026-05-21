import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Cpu, Loader2, Mic2, PlayCircle, Radio, Volume2, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { Agent, agentApi } from '@/lib/agent-api'
import type { LlmProvider } from '@/lib/llm-provider-api'
import { llmProviderApi } from '@/lib/llm-provider-api'
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
import { getVoiceOptions, type VoiceOption, type VoiceProviderMeta } from '@/lib/voice-provider-metadata'
import { filterRemoteTtsProviders } from '@/lib/voice-catalog-client'
import { getBrowserSpeechVoices, speakText, type BrowserSpeechVoiceOption } from '@/lib/browser-speech'
import { cn } from '@/lib/utils'
import { getApiBaseUrl } from '@/lib/config'

interface AssistantVoiceTabProps {
  agent: Agent
  onUpdate?: (agent?: Agent) => void | Promise<void>
}

type RemoteCatalogEntry = {
  llmProviderId: string
  llmProviderName: string
  apiUrl: string | null
  providerLabel: string
  models: Array<{
    id: string
    voices: VoiceOption[]
  }>
}

const BROWSER_CLIENT_ID_STORAGE_KEY = 'teamagentx_browser_client_id'

function getBrowserClientId(): string {
  if (typeof window === 'undefined') return 'server'
  const existing = window.localStorage.getItem(BROWSER_CLIENT_ID_STORAGE_KEY)
  if (existing) return existing

  const nextId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  window.localStorage.setItem(BROWSER_CLIENT_ID_STORAGE_KEY, nextId)
  return nextId
}

export function AssistantVoiceTab({ agent, onUpdate }: AssistantVoiceTabProps) {
  const [voiceConfig, setVoiceConfig] = useState<AgentVoicePanelConfig>(
    toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig()),
  )
  const [selectedPresetId, setSelectedPresetId] = useState<AgentVoicePresetId | null>(
    inferVoicePresetId(toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())),
  )
  const [audioProviders, setAudioProviders] = useState<LlmProvider[]>([])
  const [localVoices, setLocalVoices] = useState<BrowserSpeechVoiceOption[]>([])
  // 从服务端获取的供应商元数据（含 voices），静态文件作 fallback
  const [serverMeta, setServerMeta] = useState<VoiceProviderMeta[]>([])
  const [remoteCatalog, setRemoteCatalog] = useState<RemoteCatalogEntry[]>([])
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lastSavedConfigJson, setLastSavedConfigJson] = useState(
    () => JSON.stringify(toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())),
  )
  const hasHydratedRef = useRef(false)
  const saveRequestIdRef = useRef(0)
  // #32: 用 ref 存储 onUpdate 回调，避免自动保存 effect 依赖 onUpdate 引用导致 timer 永重置
  const onUpdateRef = useRef(onUpdate)
  useEffect(() => { onUpdateRef.current = onUpdate }, [onUpdate])

  useEffect(() => {
    let cancelled = false

    const syncBrowserLocalVoices = async () => {
      const voices = getBrowserSpeechVoices()
      if (cancelled) return
      setLocalVoices(voices)

      if (voices.length === 0) return

      try {
        const baseUrl = await getApiBaseUrl()
        const token = localStorage.getItem('auth_token') ?? ''
        const browserClientId = getBrowserClientId()
        await fetch(`${baseUrl}/speech/catalog/browser-local`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Browser-Client-Id': browserClientId,
          },
          body: JSON.stringify({ voices }),
        })
      } catch {
        // 静默失败，不阻塞本地配置
      }
    }

    void syncBrowserLocalVoices()

    const speechSynthesisRef = typeof window !== 'undefined' ? window.speechSynthesis : null
    const handleVoicesChanged = () => {
      void syncBrowserLocalVoices()
    }
    speechSynthesisRef?.addEventListener?.('voiceschanged', handleVoicesChanged)

    return () => {
      cancelled = true
      speechSynthesisRef?.removeEventListener?.('voiceschanged', handleVoicesChanged)
    }
  }, [])

  useEffect(() => {
    llmProviderApi.getAll().then((res) => {
      if (res.success && res.data) {
        setAudioProviders(res.data.filter((p) => p.modelType === 'audio' && p.isActive))
      }
    }).catch(() => {
      toast.error('加载语音供应商列表失败，请刷新重试')
    })

    // 从服务端拉取供应商元数据（含模型和音色列表），失败时降级到静态文件
    let cancelled = false
    ;(async () => {
      try {
        const baseUrl = await getApiBaseUrl()
        const token = localStorage.getItem('auth_token') ?? ''
        const browserClientId = getBrowserClientId()
        const res = await fetch(`${baseUrl}/speech/providers`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const json = await res.json() as { success: boolean; data: VoiceProviderMeta[] }
        if (json.success && Array.isArray(json.data) && !cancelled) {
          setServerMeta(json.data)
        }

        const catalogRes = await fetch(`${baseUrl}/speech/catalog`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Browser-Client-Id': browserClientId,
          },
        })
        if (!catalogRes.ok || cancelled) return
        const catalogJson = await catalogRes.json() as {
          success: boolean
          data?: {
            remoteProviders?: RemoteCatalogEntry[]
          }
        }
        if (catalogJson.success && catalogJson.data?.remoteProviders && !cancelled) {
          setRemoteCatalog(catalogJson.data.remoteProviders)
        }
      } catch {
        // 静默降级到静态 voice-provider-metadata.ts
      }
    })()
    return () => { cancelled = true }
  }, [])

  // TTS 供应商（用途为 tts 或 both）
  const ttsProviders = useMemo(
    () => filterRemoteTtsProviders(audioProviders, remoteCatalog),
    [audioProviders, remoteCatalog],
  )

  // 当前选中的 TTS provider 对象
  const selectedTtsProvider = useMemo(
    () => ttsProviders.find((p) => p.id === voiceConfig.ttsProviderId) ?? null,
    [ttsProviders, voiceConfig.ttsProviderId],
  )

  const remoteModelOptions = useMemo((): string[] => {
    if (!selectedTtsProvider) return []
    const remoteEntry = remoteCatalog.find((item) => item.llmProviderId === selectedTtsProvider.id)
    if (remoteEntry) return remoteEntry.models.map((item) => item.id)

    const url = selectedTtsProvider.apiUrl?.toLowerCase() ?? ''
    const meta = serverMeta.find((item) => url.includes(item.urlPattern))
    return Array.from(new Set([
      selectedTtsProvider.model,
      ...(meta?.ttsModels ?? []),
    ].filter((value): value is string => !!value)))
  }, [remoteCatalog, selectedTtsProvider, serverMeta])

  // 根据选中 TTS provider 的模型获取音色列表（优先服务端元数据，fallback 静态文件）
  const voiceOptions = useMemo((): VoiceOption[] | null => {
    if (!selectedTtsProvider) return null
    const remoteEntry = remoteCatalog.find((item) => item.llmProviderId === selectedTtsProvider.id)
    const model = voiceConfig.model ?? selectedTtsProvider.model
    const modelEntry = remoteEntry?.models.find((item) => item.id === model)
    if (modelEntry) return modelEntry.voices
    const url = selectedTtsProvider.apiUrl?.toLowerCase() ?? ''
    // 优先用服务端动态数据
    if (serverMeta.length > 0) {
      const meta = serverMeta.find((m) => url.includes(m.urlPattern))
      if (meta?.voices && model && meta.voices[model]) return meta.voices[model]
    }
    // fallback 到静态文件
    return getVoiceOptions(selectedTtsProvider.apiUrl, model)
  }, [remoteCatalog, selectedTtsProvider, serverMeta, voiceConfig.model])

  useEffect(() => {
    const incoming = toVoicePanelConfig(agent.speechConfig || createDefaultAgentSpeechConfig())
    // #34: hydrate 时若正在保存或有未提交变更，跳过覆盖，避免与自动保存竞态
    if (saveState === 'saving') return
    setVoiceConfig(incoming)
    setSelectedPresetId(inferVoicePresetId(incoming))
    setLastSavedConfigJson(JSON.stringify(incoming))
    setSaveState('idle')
    setSaveError(null)
    hasHydratedRef.current = true
    // #33: 依赖精确到 agent.id 和 agent.speechConfig，避免 agent 对象引用变化触发不必要的 hydrate
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, agent.speechConfig])

  const hasChanges = useMemo(
    () => JSON.stringify(voiceConfig) !== lastSavedConfigJson,
    [voiceConfig, lastSavedConfigJson],
  )

  const handlePresetSelect = (presetId: AgentVoicePresetId) => {
    setSelectedPresetId(presetId)
    setVoiceConfig((prev) => ({
      ...applyVoicePreset(prev, presetId),
      enabled: true,
      outputMode: prev.outputMode === 'off' ? 'manual' : prev.outputMode,
    }))
  }

  // 切换到远程供应商：自动填充 ttsProviderId、model、voiceId（优先服务端元数据）
  const handleTtsProviderSelect = (providerId: string) => {
    const p = ttsProviders.find((x) => x.id === providerId)
    if (!p) return
    const remoteEntry = remoteCatalog.find((item) => item.llmProviderId === providerId)
    const url = p.apiUrl?.toLowerCase() ?? ''
    const serverProviderMeta = serverMeta.find((m) => url.includes(m.urlPattern))
    const firstModel = remoteEntry?.models[0]?.id ?? serverProviderMeta?.ttsModels[0] ?? p.model ?? null
    const voices = firstModel
      ? (remoteEntry?.models.find((item) => item.id === firstModel)?.voices
        ?? serverProviderMeta?.voices?.[firstModel]
        ?? getVoiceOptions(p.apiUrl, firstModel))
      : null
    setVoiceConfig((prev) => ({
      ...prev,
      provider: 'openai-compatible-tts',
      ttsProviderId: providerId,
      model: firstModel,
      voiceId: voices?.[0]?.id ?? null,
      fallbackProvider: 'browser-local',
    }))
    setSelectedPresetId(null)
  }

  useEffect(() => {
    if (!hasHydratedRef.current || !hasChanges) return

    const timer = window.setTimeout(async () => {
      const requestId = ++saveRequestIdRef.current
      setSaveState('saving')
      setSaveError(null)

      try {
        const nextSpeechConfig = fromVoicePanelConfig(voiceConfig)
        const response = await agentApi.update(agent.id, { speechConfig: nextSpeechConfig })
        if (requestId !== saveRequestIdRef.current) return
        if (!response.success || !response.data) {
          throw new Error(response.error || '语音设置保存失败')
        }
        setLastSavedConfigJson(JSON.stringify(voiceConfig))
        setSaveState('saved')
        // #32: 通过 ref 调用 onUpdate，避免 effect 依赖 onUpdate 引用导致 timer 永重置
        await onUpdateRef.current?.(response.data)
      } catch (error) {
        if (requestId !== saveRequestIdRef.current) return
        const message = error instanceof Error ? error.message : '语音设置保存失败'
        setSaveState('error')
        setSaveError(message)
        toast.error(message)
      }
    }, 500)

    return () => window.clearTimeout(timer)
    // #32: 从依赖中移除 onUpdate（改用 onUpdateRef），避免 timer 永重置
  }, [agent.id, hasChanges, voiceConfig])

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

  const isRemote = voiceConfig.provider === 'openai-compatible-tts'

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

          {/* 开启语音 */}
          <div className="rounded-xl border border-border bg-muted/40 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/5">
                  <Mic2 className="size-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-foreground">开启语音播报</p>
                  <p className="mt-1 text-sm text-muted-foreground">开启后，助手消息可以手动或自动播报。</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {voiceConfig.enabled ? '已开启' : '已关闭'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={voiceConfig.enabled}
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
                  <span className={cn(
                    'absolute top-0.5 size-4 rounded-full bg-white transition-transform',
                    voiceConfig.enabled ? 'translate-x-5' : 'translate-x-0.5',
                  )} />
                </button>
              </div>
            </div>
          </div>

          {/* 播报方式 */}
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

          {/* TTS 语音来源 */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <Cpu className="size-4 text-primary" />
                <h4 className="font-medium text-foreground">TTS 朗读来源</h4>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">选择助手朗读消息时使用的语音引擎。</p>
            </div>
            <div className="flex gap-3 p-5">
              {/* 浏览器本地 */}
              <button
                type="button"
                disabled={!voiceConfig.enabled}
                onClick={() => {
                  setVoiceConfig((prev) => ({
                    ...prev,
                    provider: 'browser-local',
                    ttsProviderId: null,
                    fallbackProvider: null,
                  }))
                  setSelectedPresetId(null)
                }}
                className={cn(
                  'flex flex-1 items-center gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-60',
                  !isRemote
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border bg-background hover:border-primary/20 hover:bg-accent/40',
                )}
              >
                <Mic2 className="size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">浏览器本地</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">免费，无需配置，音色有限</p>
                </div>
              </button>

              {/* 远程语音模型 */}
              <button
                type="button"
                disabled={!voiceConfig.enabled || ttsProviders.length === 0}
                onClick={() => {
                  if (ttsProviders.length > 0 && !voiceConfig.ttsProviderId) {
                    handleTtsProviderSelect(ttsProviders[0].id)
                  } else {
                    setVoiceConfig((prev) => ({
                      ...prev,
                      provider: 'openai-compatible-tts',
                      fallbackProvider: 'browser-local',
                      ttsProviderId: prev.ttsProviderId ?? ttsProviders[0]?.id ?? null,
                    }))
                  }
                }}
                title={ttsProviders.length === 0 ? '请先在模型管理中添加语音类型（TTS/both）模型' : undefined}
                className={cn(
                  'flex flex-1 items-center gap-3 rounded-xl border p-4 text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  isRemote
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border bg-background hover:border-primary/20 hover:bg-accent/40',
                )}
              >
                <Wifi className="size-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">远程语音模型</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {ttsProviders.length === 0
                      ? '请先在模型管理中配置语音模型'
                      : `${ttsProviders.length} 个可用供应商`}
                  </p>
                </div>
              </button>
            </div>

            {/* 远程模式：供应商下拉 + 音色下拉 */}
            {isRemote && ttsProviders.length > 0 && (
              <div className="space-y-4 border-t border-border px-5 pb-5 pt-4">
                {/* 供应商选择 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">供应商</label>
                  <select
                    value={voiceConfig.ttsProviderId ?? ''}
                    disabled={!voiceConfig.enabled}
                    onChange={(e) => handleTtsProviderSelect(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                  >
                    {ttsProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — {p.model}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">模型</label>
                  <select
                    value={voiceConfig.model ?? ''}
                    disabled={!voiceConfig.enabled || remoteModelOptions.length === 0}
                    onChange={(e) => {
                      const nextModel = e.target.value || null
                      const nextVoices = remoteCatalog
                        .find((item) => item.llmProviderId === voiceConfig.ttsProviderId)
                        ?.models.find((item) => item.id === nextModel)
                        ?.voices
                        ?? (selectedTtsProvider ? getVoiceOptions(selectedTtsProvider.apiUrl, nextModel) : null)
                      setVoiceConfig((prev) => ({
                        ...prev,
                        model: nextModel,
                        voiceId: nextVoices?.[0]?.id ?? null,
                      }))
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                  >
                    {remoteModelOptions.map((modelId) => (
                      <option key={modelId} value={modelId}>{modelId}</option>
                    ))}
                  </select>
                </div>

                {/* 音色选择 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">音色</label>
                  {voiceOptions && voiceOptions.length > 0 ? (
                    <select
                      value={voiceConfig.voiceId ?? ''}
                      disabled={!voiceConfig.enabled}
                      onChange={(e) => setVoiceConfig((prev) => ({ ...prev, voiceId: e.target.value || null }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                    >
                      <option value="">供应商默认</option>
                      {voiceOptions.map((v) => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      disabled={!voiceConfig.enabled}
                      value={voiceConfig.voiceId ?? ''}
                      onChange={(e) => setVoiceConfig((prev) => ({ ...prev, voiceId: e.target.value || null }))}
                      placeholder="留空使用供应商默认音色"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                    />
                  )}
                </div>
              </div>
            )}

            {/* 浏览器本地：预设风格 */}
            {!isRemote && (
              <div className="border-t border-border p-5">
                <p className="mb-3 text-sm font-medium text-foreground">内置语音风格</p>
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
                            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">当前</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">本地音色</label>
                  {localVoices.length > 0 ? (
                    <select
                      value={voiceConfig.voiceId ?? ''}
                      disabled={!voiceConfig.enabled}
                      onChange={(e) => setVoiceConfig((prev) => ({ ...prev, voiceId: e.target.value || null }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                    >
                      <option value="">系统默认音色</option>
                      {localVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name} {voice.lang ? `(${voice.lang})` : ''}{voice.default ? ' · 默认' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      disabled={!voiceConfig.enabled}
                      value={voiceConfig.voiceId ?? ''}
                      onChange={(e) => setVoiceConfig((prev) => ({ ...prev, voiceId: e.target.value || null }))}
                      placeholder="未检测到本地音色时可手动填写，留空使用系统默认"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 试听 & 保存状态 */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-medium text-foreground">试听与保存状态</p>
                <p className="mt-1 text-sm text-muted-foreground">切换设置后自动保存，可随时试听当前效果。</p>
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
                      正在保存
                    </span>
                  )}
                  {saveState === 'saved' && !hasChanges && (
                    <span className="inline-flex items-center gap-2 text-emerald-600">
                      <CheckCircle2 className="size-4" />
                      已保存
                    </span>
                  )}
                  {saveState === 'error' && (
                    <span className="text-red-500">{saveError || '保存失败'}</span>
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
