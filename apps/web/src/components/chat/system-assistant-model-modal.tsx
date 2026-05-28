import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Image, Loader2, Settings, X } from 'lucide-react'
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
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [acpTool, setAcpTool] = useState('claude')
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [thinkingMode, setThinkingMode] = useState<AgentThinkingMode>('high')
  const [codexModel, setCodexModel] = useState('')
  const [codexFastMode, setCodexFastMode] = useState(false)
  const [claudeModel, setClaudeModel] = useState('')
  const [proxyConfig, setProxyConfig] = useState('')
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(false)
  const [imageProviderId, setImageProviderId] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const compatibleProviders = providers.filter(
    (provider) => provider.isActive && isProviderCompatibleWithAgent(provider, 'acp', acpTool)
  )
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const displayedProviders = useMemo(() => [
    ...(
      selectedProvider
        && !compatibleProviders.some((provider) => provider.id === selectedProvider.id)
        ? [selectedProvider]
        : []
    ),
    ...compatibleProviders,
  ], [compatibleProviders, selectedProvider])
  const imageProviders = providers.filter(
    (provider) => provider.isActive && provider.modelType === 'image'
  )
  const selectedAcpTool = acpTools.find((tool) => tool.id === acpTool)
  const selectedAcpToolLabel = selectedAcpTool?.name
    || (acpTool === 'codex' ? 'Codex' : acpTool === 'claude' ? 'Claude' : acpTool)
  const hasSelectedAcpToolOption = acpTools.some((tool) => tool.id === acpTool)
  const showLocalCodexConfig = acpTool === 'codex' && !selectedProviderId
  const showCodexFastMode = acpTool === 'codex'
  const showLocalClaudeConfig = acpTool === 'claude' && !selectedProviderId

  useEffect(() => {
    if (!isOpen || !assistant) return

    const imageCapability = assistant.capabilities?.find((capability) => capability.capabilityType === 'image')
    setAcpTool(assistant.acpTool || 'claude')
    setSelectedProviderId(assistant.llmProviderId || assistant.llmProvider?.id || '')
    setThinkingMode(assistant.thinkingMode || 'high')
    setCodexModel(assistant.codexModel || '')
    setCodexFastMode(Boolean(assistant.codexFastMode))
    setClaudeModel(assistant.claudeModel || '')
    setProxyConfig(assistant.proxyConfig || '')
    setImageGenerationEnabled(Boolean(imageCapability?.enabled))
    setImageProviderId(imageCapability?.llmProviderId || imageCapability?.llmProvider?.id || '')
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
          setProviders(providersRes.data)
        } else {
          toast.error(providersRes.error || '加载模型供应商失败')
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
    if (!selectedProviderId) return
    const provider = providers.find((item) => item.id === selectedProviderId)
    if (provider && !isProviderCompatibleWithAgent(provider, 'acp', acpTool)) {
      setSelectedProviderId('')
      toast.warning('已清除不兼容的模型供应商')
    }
  }, [acpTool, providers, selectedProviderId])

  if (!isOpen || !assistant) return null

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    if (imageGenerationEnabled && !imageProviderId) {
      toast.error('请先选择图片模型')
      return
    }

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
        llmProviderId: selectedProviderId || null,
        imageGeneration: {
          enabled: imageGenerationEnabled,
          llmProviderId: imageGenerationEnabled ? imageProviderId || null : null,
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
            <h2 className="text-lg font-semibold text-foreground">编辑{assistant.name}</h2>
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
                  <SelectValue placeholder="选择 Agent">
                    {selectedAcpToolLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {!hasSelectedAcpToolOption && acpTool && (
                    <SelectItem value={acpTool}>{selectedAcpToolLabel}</SelectItem>
                  )}
                  {acpTools.length === 0 ? (
                    <SelectItem value="__loading__" disabled>加载中...</SelectItem>
                  ) : (
                    acpTools.map((tool) => (
                      <SelectItem key={tool.id} value={tool.id} disabled={!tool.installed && tool.id !== acpTool}>
                        <span className="flex items-center gap-2">
                          {tool.name}
                          {!tool.installed && (
                            <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                              未安装
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
                模型供应商
              </label>
              <Select
                value={selectedProviderId || '__none__'}
                onValueChange={(value) => setSelectedProviderId(value === '__none__' ? '' : value)}
                disabled={isLoading}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择模型供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不绑定模型供应商，使用本地 Agent 配置</SelectItem>
                  {displayedProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="flex items-center gap-2">
                        {provider.name}
                        <span className="text-xs text-muted-foreground">{provider.model}</span>
                        {provider.isDefault && (
                          <span className="rounded bg-primary/10 px-1 py-0.5 text-xs text-primary">默认</span>
                        )}
                        {!provider.isActive && (
                          <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">已停用</span>
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
                  暂无兼容文本模型，可先在模型配置中添加供应商
                </p>
              )}
            </div>

            {(acpTool === 'claude' || acpTool === 'codex') && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  思考模式
                </label>
                <Select value={thinkingMode} onValueChange={(value) => setThinkingMode(value as AgentThinkingMode)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择思考模式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">高（默认）</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="off">关</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {showCodexFastMode && (
              <div className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">Fast 模式</div>
                    <div className="text-xs text-muted-foreground">
                      开启后大约能提升 1.5 倍速度，但 token 消耗速度会变快
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
                    Codex 模型
                  </label>
                  <Select value={codexModel || '__default__'} onValueChange={(value) => setCodexModel(value === '__default__' ? '' : value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择 Codex 模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">使用本地默认模型</SelectItem>
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
                    代理地址
                  </label>
                  <textarea
                    value={proxyConfig}
                    onChange={(e) => setProxyConfig(e.target.value)}
                    placeholder="http://127.0.0.1:7890 或 export https_proxy=..."
                    rows={2}
                    className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            )}

            {showLocalClaudeConfig && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Claude 模型
                </label>
                <Select value={claudeModel || '__default__'} onValueChange={(value) => setClaudeModel(value === '__default__' ? '' : value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择 Claude 模型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">使用本地默认模型</SelectItem>
                    {getClaudeModelOptions(claudeModel).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  将使用本地 Claude 配置；模型留空时走本地默认模型
                </p>
              </div>
            )}

            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Image className="size-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium text-foreground">图片生成能力</div>
                    <div className="text-xs text-muted-foreground">开启后可通过受控工具生成图片</div>
                  </div>
                </div>
                <Switch checked={imageGenerationEnabled} onCheckedChange={setImageGenerationEnabled} />
              </div>
              {imageGenerationEnabled && (
                <div className="mt-3">
                  <Select value={imageProviderId || '__none__'} onValueChange={(value) => setImageProviderId(value === '__none__' ? '' : value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择图片模型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">选择图片模型</SelectItem>
                      {imageProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          <span className="flex items-center gap-2">
                            {provider.name}
                            <span className="text-xs text-muted-foreground">{provider.model}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {imageProviders.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">暂无可用图片模型，请先在模型配置中添加图片模型</p>
                  ) : !imageProviderId ? (
                    <p className="mt-1 text-xs text-red-500">开启图片能力后必须选择图片模型</p>
                  ) : null}
                </div>
              )}
            </div>
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
