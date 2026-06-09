import { Button } from '@/components/ui/button';
import { llmProviderApi, type AudioUsage, type CreateLlmProviderRequest, type LlmProvider, type UpdateLlmProviderRequest } from '@/lib/llm-provider-api';
import { tokenUsageApi, type TokenUsageByProvider } from '@/lib/token-usage-api';
import { getProviderMeta as getAudioProviderMeta } from '@/lib/voice-provider-metadata';
import { cn } from '@/lib/utils';
import { Activity, BadgeCheck, Copy, Cpu, Download, Eye, EyeOff, Image, Mic, Pencil, Plus, Power, RefreshCw, Search, ServerCog, Sparkles, Star, Trash2, Upload, Video, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const IMAGE_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  apimart: 'https://api.apimart.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  bailian: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
  xai: 'https://api.x.ai/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
}

function imageProviderBaseUrl(provider: string | null | undefined): string {
  return IMAGE_PROVIDER_BASE_URLS[provider || ''] || ''
}

function imageProviderPlaceholder(provider: string | null | undefined): string {
  return imageProviderBaseUrl(provider) || 'https://api.openai.com/v1'
}

function imageProviderSubmitPath(provider: string | null | undefined, apiType: CreateLlmProviderRequest['imageApiType'] | null | undefined): string {
  if (provider === 'openrouter') return '/chat/completions'
  if (provider === 'bailian') {
    return apiType === 'async' || apiType === 'auto'
      ? '/image-generation/generation'
      : '/multimodal-generation/generation'
  }
  return '/images/generations'
}

function shouldReplaceImageApiUrl(currentUrl: string | null | undefined, previousProvider: string | null | undefined): boolean {
  const normalizedUrl = (currentUrl || '').trim()
  if (!normalizedUrl) return true

  const previousBaseUrl = imageProviderBaseUrl(previousProvider)
  return Boolean(previousBaseUrl) && normalizedUrl.replace(/\/+$/, '') === previousBaseUrl.replace(/\/+$/, '')
}

function applyImageProviderBaseUrl(
  prev: CreateLlmProviderRequest,
  nextProvider: string | null | undefined,
): CreateLlmProviderRequest {
  const baseUrl = imageProviderBaseUrl(nextProvider)
  if (!baseUrl) {
    return { ...prev, imageProvider: nextProvider || prev.imageProvider }
  }

  if (!shouldReplaceImageApiUrl(prev.apiUrl, prev.imageProvider)) {
    return { ...prev, imageProvider: nextProvider || prev.imageProvider }
  }

  return {
    ...prev,
    imageProvider: nextProvider || prev.imageProvider,
    apiUrl: baseUrl,
  }
}

type ExportableProvider = Required<Pick<
  CreateLlmProviderRequest,
  'name' | 'apiKey' | 'model'
>> & Pick<
  CreateLlmProviderRequest,
  'type' | 'modelType' | 'apiProtocol' | 'apiUrl' | 'sttModel' | 'imageProvider' | 'imageApiType' | 'isActive' | 'isDefault'
>

interface ModelProvidersImportPayload {
  version: 1
  exportedAt: string
  providers: ExportableProvider[]
}

function isAudioSttDefaultEligible(provider: Pick<LlmProvider, 'modelType' | 'audioUsage'>): boolean {
  return provider.modelType !== 'audio' || provider.audioUsage !== 'tts'
}

function isMaskedApiKey(value: string | null | undefined): boolean {
  if (!value) return false
  return value === '****' || /^.{3}\*\*\*.{4}$/.test(value)
}

function getAudioUsageLabel(audioUsage: AudioUsage, t: (key: string) => string): string {
  switch (audioUsage) {
    case 'tts':
      return t('model.audioUsageTts')
    case 'stt':
      return t('model.audioUsageStt')
    default:
      return t('model.audioUsageBoth')
  }
}

function toExportableProvider(provider: LlmProvider): ExportableProvider {
  return {
    name: provider.name,
    type: provider.type || 'custom',
    modelType: provider.modelType || 'text',
    apiProtocol: provider.apiProtocol || 'anthropic',
    apiUrl: provider.apiUrl || '',
    apiKey: provider.apiKey,
    model: provider.model,
    sttModel: provider.sttModel,
    imageProvider: provider.imageProvider,
    imageApiType: provider.imageApiType,
    isActive: provider.isActive,
    isDefault: provider.isDefault,
  }
}

function normalizeImportedProvider(raw: unknown, index: number, t: (key: string, options?: Record<string, unknown>) => string): ExportableProvider {
  if (!raw || typeof raw !== 'object') {
    throw new Error(t('model.invalidImportItem', { index: index + 1 }))
  }

  const item = raw as Record<string, unknown>
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  const apiKey = typeof item.apiKey === 'string' ? item.apiKey.trim() : ''
  const model = typeof item.model === 'string' ? item.model.trim() : ''
  const modelType = item.modelType === 'image' || item.modelType === 'video' || item.modelType === 'audio'
    ? item.modelType
    : 'text'
  const apiProtocol = item.apiProtocol === 'openai' ? 'openai' : 'anthropic'
  const apiUrl = typeof item.apiUrl === 'string' ? item.apiUrl.trim() : ''
  const imageProvider = typeof item.imageProvider === 'string' ? item.imageProvider : null
  const imageApiType = item.imageApiType === 'async' || item.imageApiType === 'auto' || item.imageApiType === 'sync'
    ? item.imageApiType
    : null
  const isActive = typeof item.isActive === 'boolean' ? item.isActive : true
  const isDefault = typeof item.isDefault === 'boolean' ? item.isDefault : false

  if (!name || !apiKey || !model || !apiUrl) {
    throw new Error(t('model.missingRequiredFields', { index: index + 1 }))
  }

  if (modelType === 'image' && (!imageProvider || !imageApiType)) {
    throw new Error(t('model.missingImageFields', { index: index + 1 }))
  }

  return {
    name,
    type: 'custom',
    modelType,
    apiProtocol,
    apiUrl,
    apiKey,
    model,
    imageProvider,
    imageApiType,
    isActive,
    isDefault,
  }
}

function parseImportPayload(rawText: string, t: (key: string) => string): ExportableProvider[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error(t('model.jsonParseFailed'))
  }

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as ModelProvidersImportPayload).providers))
      ? (parsed as ModelProvidersImportPayload).providers
      : null

  if (!list || list.length === 0) {
    throw new Error(t('model.noProvidersToImport'))
  }

  return list.map((item, index) => normalizeImportedProvider(item, index, t))
}

export function ModelPage() {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<LlmProvider[]>([])
  const [tokenUsage, setTokenUsage] = useState<TokenUsageByProvider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<LlmProvider | null>(null)

  // 表单状态
  const [formData, setFormData] = useState<CreateLlmProviderRequest>({
    name: '',
    type: 'custom',
    modelType: 'text',
    apiProtocol: 'anthropic',
    codexWireApi: 'responses',
    apiUrl: '',
    apiKey: '',
    model: '',
    sttModel: null,
    audioUsage: 'both',
    imageProvider: 'openai',
    imageApiType: 'sync',
    isActive: true,
    isDefault: false,
  })

  // 测试连接状态
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { connected: boolean; message: string }>>({})

  // 密码可见性
  const [showApiKey, setShowApiKey] = useState(false)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  // AI 创建状态
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [isAiParsing, setIsAiParsing] = useState(false)

  // 搜索与筛选
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'text' | 'image' | 'video' | 'audio'>('all')

  // 导出选择
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 自动填充音频模型名：当 apiUrl 匹配已知供应商时，填入推荐模型名
  const autoFilledUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (formData.modelType !== 'audio') return
    const url = (formData.apiUrl ?? '').trim()
    if (!url || url === autoFilledUrlRef.current) return
    const meta = getAudioProviderMeta(url)
    if (!meta) return
    autoFilledUrlRef.current = url
    setFormData((prev) => ({
      ...prev,
      model: prev.model || (meta.ttsModels[0] ?? ''),
      sttModel: prev.sttModel ?? (meta.sttModels[0] ?? null),
    }))
  }, [formData.apiUrl, formData.modelType])

  // 加载供应商列表
  useEffect(() => {
    loadProviders()
  }, [])

  const loadProviders = async () => {
    setIsLoading(true)
    const [providersResponse, tokenUsageResponse] = await Promise.all([
      llmProviderApi.getAll(),
      tokenUsageApi.getByProvider(),
    ])
    if (providersResponse.success && providersResponse.data) {
      setProviders(providersResponse.data)
    } else {
      toast.error(t('model.loadFailed'))
    }
    if (tokenUsageResponse.success && tokenUsageResponse.data) {
      setTokenUsage(tokenUsageResponse.data)
    }
    setIsLoading(false)
  }

  // 获取 Provider 的 token 使用数据
  const getTokenUsage = (providerId: string) => {
    return tokenUsage.find(t => t.provider.id === providerId)?.stats
  }

  // 是否存在默认模型配置（AI 创建需要依赖默认模型来解析）
  const hasDefaultProvider = providers.some(p => p.isDefault && p.isActive && (p.modelType || 'text') === 'text')

  const filteredProviders = providers.filter(p => {
    if (filterType !== 'all' && (p.modelType || 'text') !== filterType) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      return p.name.toLowerCase().includes(q)
        || p.model.toLowerCase().includes(q)
        || (p.apiUrl || '').toLowerCase().includes(q)
    }
    return true
  })

  const getProviderMeta = (provider: LlmProvider, t: (key: string) => string) => {
    if (provider.modelType === 'image') {
      return {
        label: t('model.imageModel'),
        icon: <Image className="size-4 text-sky-600 dark:text-sky-400" />,
        badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      }
    }
    if (provider.modelType === 'video') {
      return {
        label: t('model.videoModel'),
        icon: <Video className="size-4 text-fuchsia-600 dark:text-fuchsia-400" />,
        badge: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
      }
    }
    if (provider.modelType === 'audio') {
      return {
        label: t('model.audioModel'),
        icon: <Mic className="size-4 text-amber-600 dark:text-amber-400" />,
        badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      }
    }
    const protocol = provider.apiProtocol || 'anthropic'
    if (protocol === 'openai') {
      return {
        label: 'OpenAI',
        icon: <ServerCog className="size-4 text-emerald-600 dark:text-emerald-400" />,
        badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      }
    }
    return {
      label: 'Anthropic',
      icon: <Cpu className="size-4 text-primary" />,
      badge: 'bg-primary/10 text-primary',
    }
  }

  // 打开创建对话框
  const openCreateDialog = () => {
    setEditingProvider(null)
    setFormData({
      name: '',
      type: 'custom',
      modelType: 'text',
      apiProtocol: 'anthropic',
      codexWireApi: 'responses',
      apiUrl: '',
      apiKey: '',
      model: '',
      sttModel: null,
      audioUsage: 'both' as AudioUsage,
      imageProvider: 'openai',
      imageApiType: 'sync',
      isActive: true,
      isDefault: false,
    })
    setIsDialogOpen(true)
  }

  // 打开编辑对话框
  const openEditDialog = (provider: LlmProvider) => {
    const imageProvider = provider.imageProvider || 'openai'
    const apiUrl = provider.apiUrl || ((provider.modelType || 'text') === 'image' ? imageProviderBaseUrl(imageProvider) : '')
    setEditingProvider(provider)
    setFormData({
      name: provider.name,
      type: 'custom',
      modelType: provider.modelType || 'text',
      apiProtocol: provider.apiProtocol || 'anthropic',
      codexWireApi: provider.codexWireApi || 'responses',
      apiUrl,
      apiKey: '',
      model: provider.model,
      sttModel: provider.sttModel ?? null,
      audioUsage: ((provider as any).audioUsage ?? 'both') as AudioUsage,
      imageProvider,
      imageApiType: provider.imageApiType || 'sync',
      isActive: provider.isActive,
      isDefault: provider.isDefault,
    })
    setIsDialogOpen(true)
  }

  // 复制模型配置（创建副本）
  const handleCopy = async (provider: LlmProvider) => {
    const imageProvider = provider.imageProvider || 'openai'
    const apiUrl = provider.apiUrl || ((provider.modelType || 'text') === 'image' ? imageProviderBaseUrl(imageProvider) : '')
    // 打开创建对话框，预填充原数据
    setEditingProvider(null)
    setFormData({
      name: `${provider.name} ${t('model.copySuffix')}`,
      type: 'custom',
      modelType: provider.modelType || 'text',
      apiProtocol: provider.apiProtocol || 'anthropic',
      codexWireApi: provider.codexWireApi || 'responses',
      apiUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      sttModel: provider.sttModel ?? null,
      audioUsage: ((provider as any).audioUsage ?? 'both') as AudioUsage,
      imageProvider,
      imageApiType: provider.imageApiType || 'sync',
      isActive: true,
      isDefault: false, // 副本不设为默认
    })
    setIsDialogOpen(true)
  }

  // 提交表单
  const handleSubmit = async () => {
    const apiKeyInput = formData.apiKey.trim()
    const keepsExistingApiKey = Boolean(editingProvider && (!apiKeyInput || isMaskedApiKey(apiKeyInput)))
    if (!formData.name || (!apiKeyInput && !keepsExistingApiKey) || !formData.model || !formData.apiUrl) {
      toast.error(t('model.requiredFields'))
      return
    }
    if (!editingProvider && isMaskedApiKey(apiKeyInput)) {
      toast.error(t('model.apiKeyMasked'))
      return
    }
    if (formData.modelType === 'image' && (!formData.imageProvider || !formData.imageApiType)) {
      toast.error(t('model.imageFieldsRequired'))
      return
    }

    const payload = formData.modelType === 'audio' && formData.audioUsage === 'tts'
      ? { ...formData, isDefault: false }
      : { ...formData }
    payload.apiKey = apiKeyInput
    if (editingProvider && (!payload.apiKey || isMaskedApiKey(payload.apiKey))) {
      delete (payload as Partial<typeof formData>).apiKey
    }

    if (editingProvider) {
      // 更新
      const response = await llmProviderApi.update(editingProvider.id, payload as UpdateLlmProviderRequest)
      if (response.success) {
        toast.success(t('model.updateSuccess'))
        setIsDialogOpen(false)
        loadProviders()
      } else {
        toast.error(t('model.updateFailed'))
      }
    } else {
      // 创建
      const response = await llmProviderApi.create(payload)
      if (response.success) {
        toast.success(t('model.createSuccess'))
        setIsDialogOpen(false)
        loadProviders()
      } else {
        toast.error(t('model.createFailed'))
      }
    }
  }

  // 删除模型
  const handleDelete = async (provider: LlmProvider) => {
    if (!confirm(t('model.deleteConfirm', { name: provider.name }))) {
      return
    }

    const response = await llmProviderApi.delete(provider.id)
    if (response.success) {
      toast.success(t('model.deleteSuccess'))
      loadProviders()
    } else {
      toast.error(t('model.deleteFailed'))
    }
  }

  // 激活/停用
  const handleToggleActive = async (provider: LlmProvider) => {
    const response = await llmProviderApi.setStatus(provider.id, !provider.isActive)
    if (response.success) {
      toast.success(provider.isActive ? t('model.deactivated') : t('model.activated'))
      loadProviders()
    } else {
      toast.error(t('common.operationFailed'))
    }
  }

  // 设为默认
  const handleSetDefault = async (provider: LlmProvider) => {
    const response = await llmProviderApi.setDefault(provider.id)
    if (response.success) {
      toast.success(provider.modelType === 'audio' ? t('model.setDefaultSttSuccess') : t('model.setDefaultSuccess'))
      loadProviders()
    } else {
      toast.error(t('common.operationFailed'))
    }
  }

  // 测试连接
  const handleTestConnection = async (provider: LlmProvider) => {
    setTestingProvider(provider.id)
    const response = await llmProviderApi.testConnection(provider.id)
    setTestingProvider(null)

    if (response.success && response.data) {
      setTestResults(prev => ({
        ...prev,
        [provider.id]: response.data!,
      }))
      if (response.data.connected) {
        toast.success(t('model.connectionTestSuccess', { name: provider.name }))
      } else {
        toast.error(t('model.connectionTestFailed', { name: provider.name, message: response.data.message }))
      }
    } else {
      toast.error(t('model.testFailed'))
    }
  }

  // AI 解析配置描述
  const handleAiParse = async () => {
    if (!aiDescription.trim()) {
      toast.error(t('model.aiInputRequired'))
      return
    }

    setIsAiParsing(true)
    const response = await llmProviderApi.parseConfig(aiDescription)
    setIsAiParsing(false)

    if (response.success && response.data) {
      // 用解析结果填充表单
      setFormData({
        name: response.data.name ?? '',
        type: 'custom',
        modelType: 'text',
        apiProtocol: response.data.apiProtocol ?? 'anthropic',
        apiUrl: response.data.apiUrl ?? '',
        apiKey: response.data.apiKey ?? '',
        model: response.data.model ?? '',
        imageProvider: 'openai',
        imageApiType: 'sync',
        isActive: true,
        isDefault: false,
      })
      setIsAiDialogOpen(false)
      setAiDescription('')
      setIsDialogOpen(true) // 打开表单对话框让用户确认
      toast.success(t('model.aiParseSuccess'))
    } else {
      toast.error(t('model.aiParseFailed'))
    }
  }

  // 打开 AI 创建对话框
  const openAiDialog = () => {
    setAiDescription('')
    setIsAiDialogOpen(true)
  }

  const handleExport = () => {
    const toExport = selectedIds.size > 0
      ? providers.filter(p => selectedIds.has(p.id))
      : providers

    if (toExport.length === 0) {
      toast.error(t('model.exportSelectRequired'))
      return
    }

    const payload: ModelProvidersImportPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      providers: toExport.map(toExportableProvider),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `teamagentx-model-providers-${date}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast.success(t('model.exportSuccessCount', { count: toExport.length }))
    setSelectedIds(new Set())
  }

  const triggerImport = () => {
    importInputRef.current?.click()
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    let importedProviders: ExportableProvider[]
    try {
      importedProviders = parseImportPayload(await file.text(), t)
    } catch (error) {
      toast.error(t('model.importFailed'))
      return
    }

    const defaults = importedProviders.filter((provider) => provider.isDefault)
    const nonDefaults = importedProviders.filter((provider) => !provider.isDefault)
    const orderedProviders = [...nonDefaults, ...defaults]

    let successCount = 0
    const failedItems: string[] = []

    for (const provider of orderedProviders) {
      const response = await llmProviderApi.create(provider)
      if (response.success) {
        successCount += 1
      } else {
        failedItems.push(`${provider.name}: ${t('model.importCreateFailed')}`)
      }
    }

    if (successCount > 0) {
      await loadProviders()
    }

    if (failedItems.length === 0) {
      toast.success(t('model.importSuccessCount', { count: successCount }))
      return
    }

    toast.error(t('model.importPartialSuccess', { success: successCount, failed: failedItems.length }))
    failedItems.slice(0, 3).forEach((message) => toast.error(message))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--surface)]">
      {/* 头部 */}
      <div
        className="flex h-[52px] items-center border-b border-border px-4 shrink-0 bg-[var(--surface-raised)]"
        style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
      >
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" />
          <span className="text-base font-semibold text-foreground">{t('nav.modelManagement')}</span>
          {!isLoading && (
            <span className="text-xs text-muted-foreground">{filteredProviders.length}/{providers.length}</span>
          )}
        </div>
        <div
          className="ml-auto flex items-center gap-1.5"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <div className="ta-search-shell h-8">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('model.searchModelsPlaceholder')}
              className="w-40 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={loadProviders}
            disabled={isLoading}
            className="h-8"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            {t('model.refresh')}
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-xs text-muted-foreground">
              {t('model.selectedCount', { count: selectedIds.size })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleExport} className="h-8">
            <Download className="size-3.5" />
            {selectedIds.size > 0 ? t('model.exportSelectedCount', { count: selectedIds.size }) : t('model.exportAll')}
          </Button>
          <Button variant="outline" size="sm" onClick={triggerImport} className="h-8">
            <Upload className="size-3.5" />
            {t('model.import')}
          </Button>
          <Button size="sm" className="h-8 bg-primary text-primary-foreground hover:bg-primary/90" onClick={openCreateDialog}>
            <Plus className="size-3.5" />
            {t('model.addModel')}
          </Button>
          {hasDefaultProvider && (
            <Button variant="outline" size="sm" className="h-8" onClick={openAiDialog}>
              <Sparkles className="size-3.5" />
              {t('model.aiCreateButton')}
            </Button>
          )}
        </div>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          className="hidden"
        />
      </div>

      {/* 供应商列表 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">{t('model.loading')}</div>
      ) : providers.length === 0 ? (
        <div className="ta-page-section flex h-full flex-col items-center justify-center text-muted-foreground">
          <Cpu className="size-12 mb-2 opacity-50" />
          <p>{t('model.noModels')}</p>
          <p className="text-sm mt-1">{t('model.createFirstModel')}</p>
        </div>
      ) : (
        <div className="ta-page-section">
          {/* 类型筛选 */}
          <div className="mb-3 flex items-center gap-1.5">
            {([
              { value: 'all' as const, label: t('model.all') },
              { value: 'text' as const, label: t('model.text') },
              { value: 'image' as const, label: t('model.image') },
              { value: 'video' as const, label: t('model.video') },
              { value: 'audio' as const, label: t('model.audio') },
            ] as const).map(item => {
              const count = item.value === 'all'
                ? providers.length
                : providers.filter(p => (p.modelType || 'text') === item.value).length
              return (
                <button
                  key={item.value}
                  onClick={() => setFilterType(item.value)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                    filterType === item.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  {item.label}
                  <span className={cn(
                    'rounded-sm px-1 py-0.5 text-[10px] leading-none',
                    filterType === item.value
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  )}>{count}</span>
                </button>
              )
            })}
          </div>
          {filteredProviders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Search className="size-10 mb-2 opacity-40" />
              <p className="text-sm">{t('model.noMatchingModels')}</p>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-[var(--surface-raised)]">
            <div className="grid min-w-[860px] grid-cols-[36px_minmax(220px,1.35fr)_minmax(180px,1fr)_120px_120px_176px] border-b border-border bg-[var(--surface-subtle)] px-3 py-2 text-xs font-medium text-muted-foreground">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredProviders.length && filteredProviders.length > 0}
                  onChange={e => {
                    if (e.target.checked) {
                      setSelectedIds(new Set(filteredProviders.map(p => p.id)))
                    } else {
                      setSelectedIds(new Set())
                    }
                  }}
                  className="size-4 rounded border-input"
                />
              </div>
              <div>{t('model.modelConfig')}</div>
              <div>{t('model.modelLabel')}</div>
              <div>{t('model.tokenLabel')}</div>
              <div>{t('model.statusLabel')}</div>
              <div className="text-right">{t('model.actionsLabel')}</div>
            </div>
            {filteredProviders.map(provider => {
              const usage = getTokenUsage(provider.id)
              const meta = getProviderMeta(provider, t)
              const isSelected = selectedIds.has(provider.id)
              return (
                <div key={provider.id} className={cn(
                  "grid min-w-[860px] grid-cols-[36px_minmax(220px,1.35fr)_minmax(180px,1fr)_120px_120px_176px] items-center border-b border-border/60 px-3 py-2.5 last:border-b-0",
                  isSelected ? "bg-primary/5" : "hover:bg-accent/60"
                )}>
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={e => {
                        const newSet = new Set(selectedIds)
                        if (e.target.checked) {
                          newSet.add(provider.id)
                        } else {
                          newSet.delete(provider.id)
                        }
                        setSelectedIds(newSet)
                      }}
                      className="size-4 rounded border-input"
                    />
                  </div>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">{provider.name}</span>
                        {provider.isDefault && (
                          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            <Star className="size-3" />
                            {provider.modelType === 'audio' ? t('model.defaultStt') : t('common.default')}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("rounded px-1.5 py-0.5 font-medium", meta.badge)}>{meta.label}</span>
                        {provider.modelType === 'text' ? (
                          <span>{t('model.agentsCount', { count: provider._count?.agents || 0 })}</span>
                        ) : provider.modelType === 'image' ? (
                          <span>{provider.imageProvider || 'custom'} / {provider.imageApiType || 'sync'}</span>
                        ) : provider.modelType === 'audio' ? (
                          <span>{getAudioUsageLabel(provider.audioUsage, t)}</span>
                        ) : (
                          <span>{t('model.reservedConfig')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <div className="truncate font-mono text-foreground">{provider.model}</div>
                    <div className="truncate">{provider.apiUrl || t('model.noApiUrl')}</div>
                  </div>
                  <div className="text-xs">
                    {usage && usage.totalTokens > 0 ? (
                      <div className="flex items-center gap-1.5 text-foreground">
                        <Activity className="size-3.5 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{tokenUsageApi.formatTokens(usage.totalTokens)}</div>
                          <div className="text-muted-foreground/70">{t('model.times', { count: usage.executionCount })}</div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">{t('model.noUsage')}</span>
                    )}
                  </div>
                  <div>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium',
                      provider.isActive
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {provider.isActive ? <BadgeCheck className="size-3" /> : <Power className="size-3" />}
                      {provider.isActive ? t('model.enabled') : t('model.disabled')}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={() => handleTestConnection(provider)}
                        disabled={testingProvider === provider.id}
                        className={cn(
                          'inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground',
                          testingProvider === provider.id && 'opacity-50 cursor-wait'
                        )}
                        title={testResults[provider.id]?.connected ? t('model.connectionOk') : t('model.testConnection')}
                      >
                        {testingProvider === provider.id ? (
                          <RefreshCw className="size-3.5 animate-spin" />
                        ) : testResults[provider.id]?.connected ? (
                          <Wifi className="size-3.5 text-green-500" />
                        ) : testResults[provider.id] ? (
                          <WifiOff className="size-3.5 text-red-500" />
                        ) : (
                          <Wifi className="size-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => openEditDialog(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground"
                        title={t('model.editTooltip')}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleCopy(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground"
                        title={t('model.copyConfigTooltip')}
                      >
                        <Copy className="size-3.5" />
                      </button>
                      {!provider.isDefault && provider.isActive && isAudioSttDefaultEligible(provider) && (
                        <button
                          onClick={() => handleSetDefault(provider)}
                          className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-primary"
                          title={provider.modelType === 'audio' ? t('model.setDefaultSttTooltip') : t('model.setDefaultTooltip')}
                        >
                          <Star className="size-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground"
                        title={provider.isActive ? t('model.disableTooltip') : t('model.enableTooltip')}
                      >
                        <Power className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title={t('model.deleteTooltip')}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </div>
      )}
      </div>

      {/* 创建/编辑对话框 */}
      {!isDialogOpen ? null : (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
          <div className="w-[800px] shrink-0 rounded-md bg-background shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">
                {editingProvider ? t('model.editModel') : t('model.addModel')}
              </h2>
              <button
                onClick={() => setIsDialogOpen(false)}
                className="ta-icon-button-compact"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={e => { e.preventDefault(); handleSubmit(); }}>
              <div className="max-h-[50vh] overflow-y-auto p-6">
                {/* 名称 */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('model.name')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="ta-input w-full shadow-none"
                  />
                </div>

                {/* 模型类型 */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('model.modelType')} <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'text', label: t('model.text'), icon: Cpu },
                      { value: 'image', label: t('model.image'), icon: Image },
                      { value: 'audio', label: t('model.audio'), icon: Mic },
                    ].map(item => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setFormData(prev => ({
                            ...(item.value === 'image'
                              ? applyImageProviderBaseUrl({
                                ...prev,
                                modelType: 'image',
                                apiProtocol: 'openai',
                                imageProvider: prev.imageProvider || 'openai',
                                imageApiType: prev.imageApiType || 'sync',
                              }, prev.imageProvider || 'openai')
                              : item.value === 'audio'
                              ? {
                                ...prev,
                                modelType: 'audio',
                                apiProtocol: 'openai',
                                model: '',
                                apiUrl: '',
                              }
                              : {
                                ...prev,
                                modelType: 'text',
                                apiProtocol: prev.apiProtocol || 'anthropic',
                              }),
                          }))}
                          className={cn(
                            'flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors',
                            formData.modelType === item.value
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-accent'
                          )}
                        >
                          <Icon className="size-3.5" />
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                  {formData.modelType === 'audio' && (formData.apiUrl ?? '').trim() && (() => {
                    const base = (formData.apiUrl ?? '').trim().replace(/\/+$/, '')
                    return (
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <p>{t('model.audioBaseUrlHint')}</p>
                        {(formData.audioUsage === 'tts' || formData.audioUsage === 'both') && (
                          <p className="font-mono">
                            {t('model.audioTtsPath', { base })}
                          </p>
                        )}
                        {(formData.audioUsage === 'stt' || formData.audioUsage === 'both') && (
                          <p className="font-mono">
                            {t('model.audioSttPath', { base })}
                          </p>
                        )}
                      </div>
                    )
                  })()}
                  {formData.modelType === 'audio' && !(formData.apiUrl ?? '').trim() && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {t('model.audioOpenaiProtocolHint')}
                    </p>
                  )}
                </div>

                {formData.modelType === 'audio' && (
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">{t('model.usage')}</label>
                  <div className="flex gap-2">
                    {([
                      { value: 'tts', label: t('model.ttsOnlyLabel') },
                      { value: 'stt', label: t('model.sttOnlyLabel') },
                      { value: 'both', label: t('model.ttsAndSttLabel') },
                    ] as const).map(item => (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => setFormData(prev => ({
                          ...prev,
                          audioUsage: item.value,
                          isDefault: item.value === 'tts' ? false : prev.isDefault,
                        }))}
                        className={cn(
                          'flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors',
                          formData.audioUsage === item.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-accent'
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                )}

                {formData.modelType === 'image' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t('model.imageProvider')} <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.imageProvider || 'openai'}
                        onChange={e => setFormData(prev => applyImageProviderBaseUrl(prev, e.target.value))}
                        className="ta-input w-full shadow-none"
                      >
                        <option value="openai">OpenAI</option>
                        <option value="apimart">APIMart</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="gemini">Gemini</option>
                        <option value="zhipu">Zhipu</option>
                        <option value="bailian">Bailian</option>
                        <option value="xai">xAI</option>
                        <option value="volcengine">Volcengine Ark</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        {t('model.imageApiTypeLabel')} <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.imageApiType || 'sync'}
                        onChange={e => setFormData(prev => ({ ...prev, imageApiType: e.target.value as CreateLlmProviderRequest['imageApiType'] }))}
                        className="ta-input w-full shadow-none"
                      >
                        <option value="sync">{t('model.syncReturnImage')}</option>
                        <option value="async">{t('model.asyncReturnTaskId')}</option>
                        <option value="auto">{t('model.autoDetect')}</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* API URL */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    API URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.apiUrl}
                    onChange={e => setFormData(prev => ({ ...prev, apiUrl: e.target.value }))}
                    placeholder={formData.modelType === 'image'
                      ? imageProviderPlaceholder(formData.imageProvider)
                      : formData.modelType === 'audio'
                      ? 'https://api.siliconflow.cn/v1'
                      : 'https://api.anthropic.com'}
                    className="ta-input w-full shadow-none"
                  />
                  {formData.modelType === 'image' && (() => {
                    const base = (formData.apiUrl || '').replace(/\/+$/, '') || '<base-url>';
                    const submitPath = imageProviderSubmitPath(formData.imageProvider, formData.imageApiType);
                    const isAsync = formData.imageApiType === 'async' || formData.imageApiType === 'auto';
                    return (
                      <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                        <p>{t('model.imageBaseUrlHint')}</p>
                        <p className="font-mono text-foreground">
                          {t('model.imageSubmitPath', { base, path: submitPath })}
                        </p>
                        {isAsync && (
                          <>
                            <p className="font-mono text-foreground">
                              {t('model.imagePollPath', { base, taskId: '{task_id}' })}
                            </p>
                            <p className="font-mono text-foreground">
                              {t('model.imageCancelPath', { base, taskId: '{task_id}' })}
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* API Key */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('model.apiKey')} {editingProvider ? (
                      <span className="text-xs font-normal text-muted-foreground">{t('model.apiKeyHint')}</span>
                    ) : (
                      <span className="text-red-500">*</span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={formData.apiKey}
                      onChange={e => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder={editingProvider ? t('model.apiKeyPlaceholder') : 'sk-...'}
                      className="ta-input flex-1 shadow-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="ta-icon-button"
                      title={showApiKey ? t('model.hideApiKey') : t('model.showApiKey')}
                    >
                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* 模型 */}
                {formData.modelType !== 'audio' || formData.audioUsage !== 'stt' ? (
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {formData.modelType === 'audio' ? t('model.ttsModelLabel') : t('model.modelLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={e => setFormData(prev => ({ ...prev, model: e.target.value }))}
                    placeholder={formData.modelType === 'audio' ? 'FunAudioLLM/CosyVoice2-0.5B' : t('model.modelPlaceholder')}
                    className="ta-input w-full shadow-none"
                  />
                </div>
                ) : null}

                {formData.modelType === 'audio' && (formData.audioUsage === 'stt' || formData.audioUsage === 'both') && (
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('model.sttModelLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.audioUsage === 'stt' ? formData.model : (formData.sttModel ?? '')}
                    onChange={e => {
                      if (formData.audioUsage === 'stt') {
                        setFormData(prev => ({ ...prev, model: e.target.value }))
                      } else {
                        setFormData(prev => ({ ...prev, sttModel: e.target.value || null }))
                      }
                    }}
                    placeholder="FunAudioLLM/SenseVoiceSmall"
                    className="ta-input w-full shadow-none"
                  />
                  {formData.audioUsage === 'both' && (
                    <p className="mt-1.5 text-xs text-muted-foreground">{t('model.sttModelHint')}</p>
                  )}
                </div>
                )}

                {formData.modelType !== 'audio' && <div className="mb-4">
                  {formData.modelType === 'image' && formData.imageProvider === 'openrouter' && (
                    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      <p>{t('model.openrouterModelHint')}</p>
                      <p>{t('model.openrouterModelExamples')}</p>
                    </div>
                  )}
                  {formData.modelType === 'image' && formData.imageProvider === 'bailian' && (
                    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      <p>{t('model.bailianModelHint')}</p>
                      <p>{t('model.bailianSyncAsyncHint')}</p>
                    </div>
                  )}
                  {formData.modelType === 'image' && formData.imageProvider === 'zhipu' && (
                    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      <p>{t('model.zhipuModelHint')}</p>
                      <p>{t('model.zhipuSizeHint')}</p>
                    </div>
                  )}
                  {formData.modelType === 'image' && formData.imageProvider === 'xai' && (
                    <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                      <p>{t('model.xaiModelHint')}</p>
                      <p>{t('model.xaiSizeHint')}</p>
                    </div>
                  )}
                </div>}

                {/* API 协议 */}
                {formData.modelType === 'text' && (
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('model.apiProtocol')} <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, apiProtocol: 'anthropic' }))}
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors',
                        formData.apiProtocol === 'anthropic'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-accent'
                      )}
                    >
                      <span className="font-medium">Anthropic</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, apiProtocol: 'openai' }))}
                      className={cn(
                        'flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-medium transition-colors',
                        formData.apiProtocol === 'openai'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50 hover:bg-accent'
                      )}
                    >
                      <span className="font-medium">OpenAI</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('model.apiProtocolHint')}
                  </p>
                </div>
                )}

                {/* Codex 路由模式：仅 openai 协议文本模型可见 */}
                {formData.modelType === 'text' && formData.apiProtocol === 'openai' && (
                <div className="mb-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-foreground">
                      {t('model.codexRouting')}
                    </label>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        codexWireApi: prev.codexWireApi === 'chat' ? 'responses' : 'chat',
                      }))}
                      className={cn(
                        'relative h-5 w-10 shrink-0 rounded-full transition-colors',
                        formData.codexWireApi === 'chat' ? 'bg-primary' : 'bg-muted'
                      )}
                      aria-pressed={formData.codexWireApi === 'chat'}
                    >
                      <span
                        className={cn(
                          'absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform',
                          formData.codexWireApi === 'chat' ? 'translate-x-5' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {t('model.codexRoutingHint')}
                  </p>
                </div>
                )}

                {/* 默认模型 */}
                {!(formData.modelType === 'audio' && formData.audioUsage === 'tts') && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="isDefault"
                      checked={formData.isDefault}
                      onChange={e => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                      className="rounded border-input"
                    />
                    <label htmlFor="isDefault" className="text-sm text-foreground">
                      {formData.modelType === 'audio' ? t('model.setAsDefaultStt') : t('model.setAsDefaultModel')}
                    </label>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  className="ta-button-secondary"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="ta-button-primary"
                >
                  {editingProvider ? t('common.save') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI 创建对话框 */}
      {!isAiDialogOpen ? null : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[500px] rounded-md bg-background shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">{t('model.aiCreateDialogTitle')}</h2>
              </div>
              <button
                onClick={() => setIsAiDialogOpen(false)}
                className="ta-icon-button-compact"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="mb-4 text-sm text-muted-foreground">
                {t('model.aiCreateDialogHint')}
              </p>
              <div className="mb-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p>{t('model.aiCreateDialogExample1')}</p>
                <p className="mt-1">{t('model.aiCreateDialogExample2')}</p>
              </div>
              <textarea
                value={aiDescription}
                onChange={e => setAiDescription(e.target.value)}
                placeholder={t('model.aiCreateDialogPlaceholder')}
                rows={4}
                className="ta-input w-full resize-none shadow-none"
              />
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setIsAiDialogOpen(false)}
                className="ta-button-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAiParse}
                disabled={isAiParsing}
                className={cn(
                  'ta-button-primary',
                  isAiParsing && 'opacity-50 cursor-wait'
                )}
              >
                {isAiParsing ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {isAiParsing ? t('model.parsing') : t('model.parseConfig')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
