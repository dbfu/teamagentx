import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AcpToolInfo, AgentSpeechConfig, acpToolsApi, AgentCategory, categoryApi, type AgentThinkingMode } from '@/lib/agent-api';
import { AgentAvatarImage, agentAvatarOptions, getRandomAgentAvatarValue } from '@/lib/agent-avatars';
import { AvatarSelector } from './avatar-selector';
import { FallbackModelSelector } from './fallback-model-selector';
import { getCodexModelOptions } from '@/lib/codex-models';
import { getClaudeModelOptions } from '@/lib/claude-models';
import { llmProviderApi, type LlmProvider } from '@/lib/llm-provider-api';
import { getProviderProtocolHint, isProviderCompatibleWithAgent } from '@/lib/llm-provider-compat';
import { promptOptimizeApi } from '@/lib/prompt-optimize-api';
import { cn } from '@/lib/utils';
import { Image, Loader2, Maximize2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface CreateAssistantModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    avatar: string
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    proxyConfig?: string | null
    codexModel?: string | null
    codexFastMode?: boolean
    claudeModel?: string | null
    thinkingMode?: AgentThinkingMode | null
    categoryId: string | null
    llmProviderId: string | null
    fallbackLlmProviderIds: string[]
    imageGeneration?: {
      enabled: boolean
      llmProviderId: string | null
    }
    speechConfig: AgentSpeechConfig | null
  }) => Promise<boolean>  // 返回是否成功
  defaultCategoryId?: string  // 预设分类ID
}

// 全屏编辑模态框
function FullscreenPromptModal({
  isOpen,
  prompt,
  onClose,
  onConfirm,
}: {
  isOpen: boolean
  prompt: string
  onClose: () => void
  onConfirm: (prompt: string) => void
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

  // AI 优化提示词（流式）
  const handleOptimize = async () => {
    if (!editPrompt.trim() || isOptimizing) return

    setIsOptimizing(true)
    // 清空当前内容，准备接收流式输出
    setEditPrompt('')

    await promptOptimizeApi.optimizeStream(
      editPrompt,
      // onChunk: 每次收到内容块时追加
      (content) => {
        setEditPrompt((prev) => prev + content)
        // 自动滚动到底部
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight
        }
      },
      // onDone: 完成时
      () => {
        setIsOptimizing(false)
        toast.success(t('assistant.promptOptimized'))
      },
      // onError: 错误时
      (error) => {
        setIsOptimizing(false)
        toast.error(error || t('assistant.optimizeFailed'))
      }
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{t('assistant.editPrompt')}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-6">
          <textarea
            ref={textareaRef}
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder={t('assistant.promptPlaceholder')}
            className="h-full w-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleOptimize}
            disabled={!editPrompt.trim() || isOptimizing}
            className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-600 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900"
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
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              {t('common.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CreateAssistantModal({ isOpen, onClose, onSubmit, defaultCategoryId }: CreateAssistantModalProps) {
  const { t } = useTranslation()
  // 直接在 useState 初始化时使用 defaultCategoryId
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState(() => getRandomAgentAvatarValue())
  const [assistantType, setAssistantType] = useState<'builtin' | 'acp'>('acp')
  const [acpTool, setAcpTool] = useState('claude')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [categories, setCategories] = useState<AgentCategory[]>([])
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([])
  const [llmProviderId, setLlmProviderId] = useState<string>('')
  const [fallbackLlmProviderIds, setFallbackLlmProviderIds] = useState<string[]>([])
  const [codexModel, setCodexModel] = useState('')
  const [codexFastMode, setCodexFastMode] = useState(false)
  const [claudeModel, setClaudeModel] = useState('')
  const [thinkingMode, setThinkingMode] = useState<AgentThinkingMode>('high')
  const [proxyConfig, setProxyConfig] = useState('')
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(false)
  const [imageProviderId, setImageProviderId] = useState<string>('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const compatibleLlmProviders = llmProviders.filter(
    (provider) => provider.isActive && isProviderCompatibleWithAgent(provider, assistantType, acpTool)
  )
  const compatibleFallbackProviders = compatibleLlmProviders.filter((provider) => provider.id !== llmProviderId)
  const imageProviders = llmProviders.filter(
    (provider) => provider.isActive && provider.modelType === 'image'
  )
  const selectedAcpTool = acpTools.find((tool) => tool.id === acpTool)
  const showLocalCodexConfig = assistantType === 'acp' && acpTool === 'codex' && !llmProviderId
  const showCodexFastMode = assistantType === 'acp' && acpTool === 'codex'
  const showLocalClaudeConfig = assistantType === 'acp' && acpTool === 'claude' && !llmProviderId

  // 当 defaultCategoryId 变化时更新 categoryId（组件重新挂载后）
  useEffect(() => {
    if (isOpen) {
      setCategoryId(defaultCategoryId ?? '')
    }
  }, [isOpen, defaultCategoryId])

  // 获取分类列表
  useEffect(() => {
    if (isOpen) {
      categoryApi.getAll().then(res => {
        if (res.success && res.data) {
          setCategories(res.data)
        }
      })
      // 获取 LLM 供应商列表
      llmProviderApi.getAll().then(res => {
        if (res.success && res.data) {
          setLlmProviders(res.data)
        }
      })
    }
  }, [isOpen])

  // 获取 ACP 工具列表
  const fetchAcpTools = async () => {
    try {
      const res = await acpToolsApi.getAll()
      if (res.success && res.data) {
        setAcpTools(res.data)
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (isOpen && assistantType === 'acp') {
      fetchAcpTools()
    }
  }, [isOpen, assistantType])

  useEffect(() => {
    if (!llmProviderId) return
    const selectedProvider = llmProviders.find((provider) => provider.id === llmProviderId)
    if (selectedProvider && !isProviderCompatibleWithAgent(selectedProvider, assistantType, acpTool)) {
      setLlmProviderId('')
      toast.warning(t('assistant.incompatibleProviderCleared'))
    }
  }, [assistantType, acpTool, llmProviderId, llmProviders])

  useEffect(() => {
    const compatibleIds = new Set(compatibleFallbackProviders.map((provider) => provider.id))
    const nextIds = fallbackLlmProviderIds.filter((id) => compatibleIds.has(id))
    if (nextIds.length !== fallbackLlmProviderIds.length) {
      setFallbackLlmProviderIds(nextIds)
    }
  }, [compatibleFallbackProviders, fallbackLlmProviderIds])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || isSubmitting) return
    if (imageGenerationEnabled && !imageProviderId) {
      toast.error(t('assistant.selectImageProviderFirst'))
      return
    }

    setIsSubmitting(true)
    try {
      const success = await onSubmit({
        name: name.trim(),
        avatar: selectedAvatar,
        description: description.trim(),
        prompt,
        type: assistantType,
        acpTool: assistantType === 'acp' ? acpTool : '',
        proxyConfig: showLocalCodexConfig ? proxyConfig.trim() || null : null,
        codexModel: showLocalCodexConfig ? codexModel.trim() || null : null,
        codexFastMode: showCodexFastMode && codexFastMode,
        claudeModel: showLocalClaudeConfig ? claudeModel.trim() || null : null,
        thinkingMode,
        categoryId: categoryId || null,
        llmProviderId: llmProviderId || null,
        fallbackLlmProviderIds,
        imageGeneration: {
          enabled: imageGenerationEnabled,
          llmProviderId: imageGenerationEnabled ? imageProviderId || null : null,
        },
        speechConfig: null,
      })

      if (success) {
        // Reset form
        setName('')
        setDescription('')
        setPrompt('')
        setSelectedAvatar(getRandomAgentAvatarValue())
        setAssistantType('acp')
        setAcpTool('claude')
        setCategoryId('')
        setLlmProviderId('')
        setFallbackLlmProviderIds([])
        setCodexModel('')
        setCodexFastMode(false)
        setClaudeModel('')
        setThinkingMode('high')
        setProxyConfig('')
        setImageGenerationEnabled(false)
        setImageProviderId('')
        onClose()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-[560px] shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <AgentAvatarImage avatar={selectedAvatar} className="size-9" />
            <h2 className="text-lg font-semibold text-foreground">{t('assistant.createTitle')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="max-h-[50vh] overflow-y-auto p-6">
            {/* Name */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('assistant.name')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('assistant.namePlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('assistant.acpTool')} <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <Select value={acpTool} onValueChange={setAcpTool}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t('assistant.selectAgent')} />
                  </SelectTrigger>
                  <SelectContent>
                    {acpTools.length === 0 ? (
                      <SelectItem value="claude" disabled>
                        {t('common.loading')}
                      </SelectItem>
                    ) : (
                      acpTools.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id} disabled={!tool.installed}>
                          <span className="flex items-center gap-2">
                            {tool.name}
                            {!tool.installed && (
                              <span className="rounded bg-muted px-1 py-0.5 text-xs text-muted-foreground">
                                {t('assistant.notInstalled')}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* LLM Provider selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                {t('assistant.modelProvider')}
              </label>
              <Select value={llmProviderId || '__none__'} onValueChange={(v) => setLlmProviderId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('assistant.selectProvider')} />
                </SelectTrigger>
                <SelectContent>
                  {selectedAcpTool?.localConfigAvailable && (
                    <SelectItem value="__none__">
                      {t('assistant.useLocalAgentConfig')}
                    </SelectItem>
                  )}
                  {compatibleLlmProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="flex items-center gap-2">
                        {provider.name}
                        {provider.isDefault && (
                          <span className="rounded bg-primary/10 px-1 py-0.5 text-xs text-primary">
                            {t('common.default')}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {compatibleLlmProviders.length === 0 && !selectedAcpTool?.localConfigAvailable && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('assistant.noCompatibleProviders')}
                </p>
              )}
              {!llmProviderId && selectedAcpTool && !selectedAcpTool.localConfigAvailable && (
                <p className="mt-1 text-xs text-red-500">
                  {t('assistant.localAgentNotDetected', { name: selectedAcpTool.localConfigLabel || selectedAcpTool.name })}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {getProviderProtocolHint(assistantType, acpTool)}
              </p>
            </div>

            <FallbackModelSelector
              providers={compatibleFallbackProviders}
              primaryProviderId={llmProviderId}
              selectedIds={fallbackLlmProviderIds}
              onChange={setFallbackLlmProviderIds}
            />

            {assistantType === 'acp' && (acpTool === 'claude' || acpTool === 'codex') && (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('assistant.thinkingMode')}
                </label>
                <Select value={thinkingMode} onValueChange={(value) => setThinkingMode(value as AgentThinkingMode)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('assistant.selectThinkingMode')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">{t('assistant.thinkingHigh')}</SelectItem>
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
              <div className="mb-4 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{t('assistant.fastModeLabel')}</div>
                    <div className="text-xs text-muted-foreground">
                      {t('assistant.fastModeHint')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCodexFastMode(v => !v)}
                    className={cn(
                      'relative h-5 w-10 rounded-full transition-colors',
                      codexFastMode ? 'bg-blue-500' : 'bg-gray-200'
                    )}
                    aria-pressed={codexFastMode}
                  >
                    <span
                      className={cn(
                        'absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform',
                        codexFastMode ? 'translate-x-5' : 'translate-x-0'
                      )}
                    />
                  </button>
                </div>
              </div>
            )}

            {showLocalCodexConfig && (
              <div className="mb-4 space-y-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('assistant.codexModel')}
                  </label>
                  <Select value={codexModel || '__default__'} onValueChange={(v) => setCodexModel(v === '__default__' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('assistant.selectCodexModel')} />
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
                    {t('assistant.proxyAddress')}
                  </label>
                  <textarea
                    value={proxyConfig}
                    onChange={(e) => setProxyConfig(e.target.value)}
                    placeholder={t('assistant.proxyPlaceholder')}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            )}

            {showLocalClaudeConfig && (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('assistant.claudeModel')}
                </label>
                <Select value={claudeModel || '__default__'} onValueChange={(v) => setClaudeModel(v === '__default__' ? '' : v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('assistant.selectClaudeModel')} />
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

            {/* Image generation capability */}
            <div className="mb-4 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Image className="size-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium text-foreground">{t('assistant.imageGenerationCapability')}</div>
                    <div className="text-xs text-muted-foreground">{t('assistant.imageGenerationHint')}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setImageGenerationEnabled(v => !v)}
                  className={cn(
                    'relative h-5 w-10 rounded-full transition-colors',
                    imageGenerationEnabled ? 'bg-blue-500' : 'bg-gray-200'
                  )}
                  aria-pressed={imageGenerationEnabled}
                >
                  <span
                    className={cn(
                      'absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform',
                      imageGenerationEnabled ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
              </div>
              {imageGenerationEnabled && (
                <div className="mt-3">
                  <Select value={imageProviderId || '__none__'} onValueChange={(v) => setImageProviderId(v === '__none__' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('assistant.selectImageModel')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('assistant.selectImageModel')}</SelectItem>
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
                    <p className="mt-1 text-xs text-muted-foreground">{t('assistant.noImageModels')}</p>
                  ) : !imageProviderId ? (
                    <p className="mt-1 text-xs text-red-500">{t('assistant.imageProviderRequired')}</p>
                  ) : null}
                </div>
              )}
            </div>

            {/* Avatar selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('assistant.avatar')}</label>
              <AvatarSelector
                value={selectedAvatar}
                onChange={setSelectedAvatar}
                options={agentAvatarOptions}
                optionAriaLabel={(index) => t('assistant.selectAvatarIndex', { index: index + 1 })}
                renderAvatar={(avatar, className) => (
                  <AgentAvatarImage avatar={avatar} className={className} />
                )}
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('assistant.description')}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('assistant.descriptionPlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* Category */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('assistant.category')}</label>
              <Select value={categoryId || '__none__'} onValueChange={(v) => setCategoryId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('assistant.selectCategoryOptional')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t('assistant.uncategorized')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prompt */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  {t('assistant.prompt')}
                </label>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title={t('assistant.fullscreenEdit')}
                >
                  <Maximize2 className="size-4" />
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t('assistant.promptPlaceholderOptional')}
                rows={4}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? t('common.creating') : t('common.create')}
            </button>
          </div>
        </form>
      </div>

      {/* 全屏编辑模态框 */}
      <FullscreenPromptModal
        isOpen={isFullscreen}
        prompt={prompt}
        onClose={() => setIsFullscreen(false)}
        onConfirm={(newPrompt) => {
          setPrompt(newPrompt)
          setIsFullscreen(false)
        }}
      />
    </div>
  )
}
