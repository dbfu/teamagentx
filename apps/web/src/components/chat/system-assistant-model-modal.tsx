import { useEffect, useLayoutEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, Settings, X } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  AcpToolInfo,
  acpToolsApi,
  type Agent,
  type AgentThinkingMode,
  type ImageGenerationCapabilityRequest,
} from '@/lib/agent-api'
import { getCodexModelOptions } from '@/lib/codex-models'
import { getClaudeModelOptions } from '@/lib/claude-models'
import { llmProviderApi, type LlmProvider } from '@/lib/llm-provider-api'
import { getProviderProtocolHint, isProviderCompatibleWithAgent } from '@/lib/llm-provider-compat'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

const NO_PROVIDER_VALUE = '__none__'

export interface SystemAssistantRuntimeConfig {
  type: 'acp'
  acpTool: string
  proxyConfig: string | null
  codexModel: string | null
  codexFastMode: boolean
  claudeModel: string | null
  thinkingMode: AgentThinkingMode
  llmProviderId: string | null
  imageGeneration: ImageGenerationCapabilityRequest
}

interface SystemAssistantModelModalProps {
  isOpen: boolean
  assistant: Agent | null
  onClose: () => void
  onSubmit: (data: SystemAssistantRuntimeConfig) => Promise<boolean>
}

export function SystemAssistantModelModal({
  isOpen,
  assistant,
  onClose,
  onSubmit,
}: SystemAssistantModelModalProps) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [acpTool, setAcpTool] = useState('claude')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [providerSelectionTouched, setProviderSelectionTouched] = useState(false)
  const [thinkingMode, setThinkingMode] = useState<AgentThinkingMode>('high')
  const [codexModel, setCodexModel] = useState('')
  const [codexFastMode, setCodexFastMode] = useState(false)
  const [claudeModel, setClaudeModel] = useState('')
  const [proxyConfig, setProxyConfig] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const compatibleProviders = providers.filter(
    (provider) => provider.isActive && isProviderCompatibleWithAgent(provider, 'acp', acpTool)
  )
  const boundProviderId = assistant?.llmProviderId || assistant?.llmProvider?.id || ''
  const effectiveSelectedProviderId = providerSelectionTouched
    ? selectedProviderId
    : (selectedProviderId || boundProviderId)
  const selectedProvider = providers.find((provider) => provider.id === effectiveSelectedProviderId)
    || (
      assistant?.llmProvider?.id === effectiveSelectedProviderId
        ? assistant.llmProvider
        : undefined
    )
  const displayedProviders = useMemo(() => [
    ...(
      selectedProvider
        && !compatibleProviders.some((provider) => provider.id === selectedProvider.id)
        ? [selectedProvider]
        : []
    ),
    ...compatibleProviders,
  ], [compatibleProviders, selectedProvider])
  const selectedAcpTool = acpTools.find((tool) => tool.id === acpTool)
  const selectedAcpToolLabel = selectedAcpTool?.name
    || (acpTool === 'codex' ? 'Codex' : acpTool === 'claude' ? 'Claude' : acpTool)
  const hasSelectedAcpToolOption = acpTools.some((tool) => tool.id === acpTool)
  const showLocalCodexConfig = acpTool === 'codex' && !effectiveSelectedProviderId
  const showCodexFastMode = acpTool === 'codex'
  const showLocalClaudeConfig = acpTool === 'claude' && !effectiveSelectedProviderId
  const providerSelectLabel = selectedProvider
    ? `${selectedProvider.name} · ${selectedProvider.model}`
    : t('assistant.noProviderUseLocalConfig')

  useLayoutEffect(() => {
    // DEBUG: 打印每次初始化 useEffect 运行
    console.log('[SystemAssistantModelModal] 初始化 useEffect 触发:', {
      isOpen,
      assistant: assistant ? {
        id: assistant.id,
        name: assistant.name,
        llmProviderId: assistant.llmProviderId,
      } : null,
    })

    if (!isOpen || !assistant) {
      console.log('[SystemAssistantModelModal] 初始化 useEffect guard 条件激活，跳过')
      return
    }

    // DEBUG: 打印 assistant 数据
    console.log('[SystemAssistantModelModal] 初始化 useEffect 执行:', {
      isOpen,
      assistantId: assistant.id,
      assistantName: assistant.name,
      llmProviderId: assistant.llmProviderId,
      llmProvider: assistant.llmProvider,
      acpTool: assistant.acpTool,
    })

    setAcpTool(assistant.acpTool || 'claude')
    const providerId = assistant.llmProviderId || assistant.llmProvider?.id || ''
    console.log('[SystemAssistantModelModal] 设置 selectedProviderId:', providerId)
    setSelectedProviderId(providerId)
    setProviderSelectionTouched(false)
    setThinkingMode(assistant.thinkingMode || 'high')
    setCodexModel(assistant.codexModel || '')
    setCodexFastMode(Boolean(assistant.codexFastMode))
    setClaudeModel(assistant.claudeModel || '')
    setProxyConfig(assistant.proxyConfig || '')
  }, [isOpen, assistant])

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false
    setIsLoading(true)
    Promise.all([
      llmProviderApi.getAll(),
      acpToolsApi.getAll(),
    ])
      .then(([providersRes, toolsRes]) => {
        if (cancelled) return
        if (providersRes.success && providersRes.data) {
          // DEBUG: 打印加载的 providers
          console.log('[SystemAssistantModelModal] 加载 providers:', providersRes.data.map(p => ({
            id: p.id,
            name: p.name,
            apiProtocol: p.apiProtocol,
            modelType: p.modelType,
            isActive: p.isActive,
          })))
          setProviders(providersRes.data)
        } else {
          console.log('[SystemAssistantModelModal] 加载 providers 失败:', providersRes.error)
          toast.error(t('assistant.loadModelProviderFailed'))
        }
        if (toolsRes.success && toolsRes.data) {
          setAcpTools(toolsRes.data)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  useEffect(() => {
    // DEBUG: 打印每次兼容性检查 useEffect 运行
    console.log('[SystemAssistantModelModal] 兼容性检查 useEffect 运行:', {
      selectedProviderId,
      effectiveSelectedProviderId,
      providerSelectionTouched,
      providersCount: providers.length,
      acpTool,
    })

    if (!effectiveSelectedProviderId) {
      console.log('[SystemAssistantModelModal] effectiveSelectedProviderId 为空，跳过检查')
      return
    }

    if (providers.length === 0) {
      console.log('[SystemAssistantModelModal] providers 尚未加载，跳过检查')
      return
    }

    const provider = providers.find((item) => item.id === effectiveSelectedProviderId)

    // DEBUG: 打印兼容性检查
    console.log('[SystemAssistantModelModal] 兼容性检查详情:', {
      selectedProviderId: effectiveSelectedProviderId,
      foundProvider: provider ? {
        id: provider.id,
        name: provider.name,
        apiProtocol: provider.apiProtocol,
        modelType: provider.modelType,
        isActive: provider.isActive,
      } : null,
      acpTool,
      providersCount: providers.length,
    })

    if (provider && !isProviderCompatibleWithAgent(provider, 'acp', acpTool)) {
      console.log('[SystemAssistantModelModal] 兼容性检查失败，清空 selectedProviderId')
      setSelectedProviderId('')
      setProviderSelectionTouched(true)
      toast.warning(t('assistant.incompatibleProviderCleared'))
    } else if (provider) {
      console.log('[SystemAssistantModelModal] 兼容性检查通过')
    }
  }, [acpTool, effectiveSelectedProviderId, providerSelectionTouched, providers, selectedProviderId])

  if (!isOpen || !assistant) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      const success = await onSubmit({
        type: 'acp',
        acpTool,
        proxyConfig: showLocalCodexConfig ? proxyConfig.trim() || null : null,
        codexModel: showLocalCodexConfig ? codexModel.trim() || null : null,
        codexFastMode: showCodexFastMode && codexFastMode,
        claudeModel: showLocalClaudeConfig ? claudeModel.trim() || null : null,
        thinkingMode,
        llmProviderId: effectiveSelectedProviderId || null,
        imageGeneration: {
          enabled: false,
          llmProviderId: null,
        },
      })
      if (success) onClose()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-[560px] shrink-0 rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500 text-white">
              <Settings className="size-4" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">{t('assistant.systemAssistantEditTitle', { name: assistant.name })}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Agent <span className="text-red-500">*</span>
              </label>
              <Select value={acpTool} onValueChange={setAcpTool} disabled={isLoading}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('assistant.selectAgentPlaceholder')}>
                    {selectedAcpToolLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {!hasSelectedAcpToolOption && acpTool && (
                    <SelectItem value={acpTool}>{selectedAcpToolLabel}</SelectItem>
                  )}
                  {acpTools.length === 0 ? (
                    <SelectItem value="__loading__" disabled>{t('assistant.loadingDots')}</SelectItem>
                  ) : (
                    acpTools.map((tool) => (
                      <SelectItem key={tool.id} value={tool.id} disabled={!tool.installed && tool.id !== acpTool}>
                        <span className="flex items-center gap-2">
                          {tool.name}
                          {!tool.installed && (
                            <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                              {t('assistant.notInstalledShort')}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('assistant.modelProviderLabel')}
              </label>
              <Select
                value={effectiveSelectedProviderId || NO_PROVIDER_VALUE}
                onValueChange={(value) => {
                  const nextProviderId = value === NO_PROVIDER_VALUE ? '' : value
                  console.log('[SystemAssistantModelModal] 模型供应商选择变更:', {
                    value,
                    nextProviderId,
                    previousProviderId: effectiveSelectedProviderId,
                  })
                  setProviderSelectionTouched(true)
                  setSelectedProviderId(nextProviderId)
                }}
                disabled={isLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('assistant.selectModelProviderPlaceholder')}>
                    {providerSelectLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PROVIDER_VALUE}>{t('assistant.noProviderUseLocalConfig')}</SelectItem>
                  {displayedProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="flex items-center gap-2">
                        {provider.name}
                        <span className="text-xs text-muted-foreground">{provider.model}</span>
                        {provider.isDefault && (
                          <span className="rounded bg-primary/10 px-1 py-0.5 text-xs text-primary">{t('assistant.defaultLabel')}</span>
                        )}
                        {!provider.isActive && (
                          <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">{t('assistant.deactivatedLabel')}</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {getProviderProtocolHint('acp', acpTool)}
              </p>
              {!isLoading && displayedProviders.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('assistant.noCompatibleTextModels')}
                </p>
              )}
            </div>

            {(acpTool === 'claude' || acpTool === 'codex') && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('assistant.thinkingModeLabel')}
                </label>
                <Select value={thinkingMode} onValueChange={(value) => setThinkingMode(value as AgentThinkingMode)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('assistant.selectThinkingModePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">{t('assistant.thinkingHighDefault')}</SelectItem>
                    <SelectItem value="medium">{t('assistant.thinkingMedium')}</SelectItem>
                    <SelectItem value="low">{t('assistant.thinkingLow')}</SelectItem>
                    <SelectItem value="off">{t('assistant.thinkingOff')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('assistant.thinkingModeHint')}
                </p>
              </div>
            )}

            {showCodexFastMode && (
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{t('assistant.fastModeLabel')}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('assistant.fastModeHint')}
                    </div>
                  </div>
                  <Switch checked={codexFastMode} onCheckedChange={setCodexFastMode} />
                </div>
              </div>
            )}

            {showLocalCodexConfig && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('assistant.codexModelLabel')}
                  </label>
                  <Select value={codexModel || '__default__'} onValueChange={(value) => setCodexModel(value === '__default__' ? '' : value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('assistant.selectCodexModelPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">{t('assistant.useLocalDefaultModel')}</SelectItem>
                      {getCodexModelOptions(codexModel).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('assistant.proxyAddressLabel')}
                  </label>
                  <textarea
                    value={proxyConfig}
                    onChange={(e) => setProxyConfig(e.target.value)}
                    placeholder={t('assistant.proxyPlaceholder')}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            )}

            {showLocalClaudeConfig && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('assistant.claudeModelLabel')}
                </label>
                <Select value={claudeModel || '__default__'} onValueChange={(value) => setClaudeModel(value === '__default__' ? '' : value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('assistant.selectClaudeModelPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">{t('assistant.useLocalDefaultModel')}</SelectItem>
                    {getClaudeModelOptions(claudeModel).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('assistant.claudeModelHint')}
                </p>
              </div>
            )}

          </div>

          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
