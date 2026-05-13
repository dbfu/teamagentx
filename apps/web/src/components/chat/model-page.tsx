import { Button } from '@/components/ui/button';
import { llmProviderApi, type CreateLlmProviderRequest, type LlmProvider, type UpdateLlmProviderRequest } from '@/lib/llm-provider-api';
import { tokenUsageApi, type TokenUsageByProvider } from '@/lib/token-usage-api';
import { cn } from '@/lib/utils';
import { Activity, BadgeCheck, Copy, Cpu, Eye, EyeOff, Image, Mic, Pencil, Plus, Power, RefreshCw, ServerCog, Sparkles, Star, Trash2, Video, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

export function ModelPage() {
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
    apiUrl: '',
    apiKey: '',
    model: '',
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

  // AI 创建状态
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [isAiParsing, setIsAiParsing] = useState(false)

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
      toast.error(providersResponse.error || '加载失败')
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

  const getProviderMeta = (provider: LlmProvider) => {
    if (provider.modelType === 'image') {
      return {
        label: '图片模型',
        icon: <Image className="size-4 text-sky-600 dark:text-sky-400" />,
        badge: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
      }
    }
    if (provider.modelType === 'video') {
      return {
        label: '视频模型',
        icon: <Video className="size-4 text-fuchsia-600 dark:text-fuchsia-400" />,
        badge: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300',
      }
    }
    if (provider.modelType === 'audio') {
      return {
        label: '语音模型',
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
      apiUrl: '',
      apiKey: '',
      model: '',
      imageProvider: 'openai',
      imageApiType: 'sync',
      isActive: true,
      isDefault: false,
    })
    setIsDialogOpen(true)
  }

  // 打开编辑对话框
  const openEditDialog = (provider: LlmProvider) => {
    setEditingProvider(provider)
    setFormData({
      name: provider.name,
      type: 'custom',
      modelType: provider.modelType || 'text',
      apiProtocol: provider.apiProtocol || 'anthropic',
      apiUrl: provider.apiUrl || '',
      apiKey: provider.apiKey,
      model: provider.model,
      imageProvider: provider.imageProvider || 'openai',
      imageApiType: provider.imageApiType || 'sync',
      isActive: provider.isActive,
      isDefault: provider.isDefault,
    })
    setIsDialogOpen(true)
  }

  // 复制模型配置（创建副本）
  const handleCopy = async (provider: LlmProvider) => {
    // 打开创建对话框，预填充原数据
    setEditingProvider(null)
    setFormData({
      name: `${provider.name} (副本)`,
      type: 'custom',
      modelType: provider.modelType || 'text',
      apiProtocol: provider.apiProtocol || 'anthropic',
      apiUrl: provider.apiUrl || '',
      apiKey: provider.apiKey,
      model: provider.model,
      imageProvider: provider.imageProvider || 'openai',
      imageApiType: provider.imageApiType || 'sync',
      isActive: true,
      isDefault: false, // 副本不设为默认
    })
    setIsDialogOpen(true)
  }

  // 提交表单
  const handleSubmit = async () => {
    if (!formData.name || !formData.apiKey || !formData.model || !formData.apiUrl) {
      toast.error('请填写必填字段：名称、API URL、API Key、模型')
      return
    }
    if (formData.modelType === 'image' && (!formData.imageProvider || !formData.imageApiType)) {
      toast.error('请填写图片模型的供应商类型和调用方式')
      return
    }

    if (editingProvider) {
      // 更新
      const response = await llmProviderApi.update(editingProvider.id, formData as UpdateLlmProviderRequest)
      if (response.success) {
        toast.success('更新成功')
        setIsDialogOpen(false)
        loadProviders()
      } else {
        toast.error(response.error || '更新失败')
      }
    } else {
      // 创建
      const response = await llmProviderApi.create(formData)
      if (response.success) {
        toast.success('创建成功')
        setIsDialogOpen(false)
        loadProviders()
      } else {
        toast.error(response.error || '创建失败')
      }
    }
  }

  // 删除模型
  const handleDelete = async (provider: LlmProvider) => {
    if (!confirm(`确定删除模型 "${provider.name}"？\n关联的助手将失去 LLM 配置。`)) {
      return
    }

    const response = await llmProviderApi.delete(provider.id)
    if (response.success) {
      toast.success('删除成功')
      loadProviders()
    } else {
      toast.error(response.error || '删除失败')
    }
  }

  // 激活/停用
  const handleToggleActive = async (provider: LlmProvider) => {
    const response = await llmProviderApi.setStatus(provider.id, !provider.isActive)
    if (response.success) {
      toast.success(provider.isActive ? '已停用' : '已激活')
      loadProviders()
    } else {
      toast.error(response.error || '操作失败')
    }
  }

  // 设为默认
  const handleSetDefault = async (provider: LlmProvider) => {
    const response = await llmProviderApi.setDefault(provider.id)
    if (response.success) {
      toast.success('已设为默认')
      loadProviders()
    } else {
      toast.error(response.error || '操作失败')
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
        toast.success(`${provider.name} 连接成功`)
      } else {
        toast.error(`${provider.name}: ${response.data.message}`)
      }
    } else {
      toast.error(response.error || '测试失败')
    }
  }

  // AI 解析配置描述
  const handleAiParse = async () => {
    if (!aiDescription.trim()) {
      toast.error('请输入配置描述')
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
      toast.success('AI 已解析配置，请确认后创建')
    } else {
      toast.error(response.error || '解析失败，请提供更详细的信息')
    }
  }

  // 打开 AI 创建对话框
  const openAiDialog = () => {
    setAiDescription('')
    setIsAiDialogOpen(true)
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
          <span className="text-sm font-bold text-foreground">模型管理</span>
        </div>
        <div
          className="ml-auto flex items-center gap-1.5"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={loadProviders}
            disabled={isLoading}
            className="h-8"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            刷新
          </Button>
          <Button size="sm" className="h-8 bg-primary text-primary-foreground hover:bg-primary/90" onClick={openCreateDialog}>
            <Plus className="size-3.5" />
            新增模型
          </Button>
          {hasDefaultProvider && (
            <Button variant="outline" size="sm" className="h-8" onClick={openAiDialog}>
              <Sparkles className="size-3.5" />
              AI创建
            </Button>
          )}
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
      ) : providers.length === 0 ? (
        <div className="ta-page-section flex h-full flex-col items-center justify-center text-muted-foreground">
          <Cpu className="size-12 mb-2 opacity-50" />
          <p>暂无模型配置</p>
          <p className="text-sm mt-1">请创建一个模型以使用原生助手</p>
        </div>
      ) : (
        <div className="ta-page-section">
          <div className="overflow-x-auto rounded-md border border-border bg-[var(--surface-raised)]">
            <div className="grid min-w-[820px] grid-cols-[minmax(220px,1.35fr)_minmax(180px,1fr)_120px_120px_176px] border-b border-border bg-[var(--surface-subtle)] px-3 py-2 text-xs font-medium text-muted-foreground">
              <div>模型配置</div>
              <div>模型</div>
              <div>Token</div>
              <div>状态</div>
              <div className="text-right">操作</div>
            </div>
            {providers.map(provider => {
              const usage = getTokenUsage(provider.id)
              const meta = getProviderMeta(provider)
              return (
                <div key={provider.id} className="grid min-w-[820px] grid-cols-[minmax(220px,1.35fr)_minmax(180px,1fr)_120px_120px_176px] items-center border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-accent/60">
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
                            默认
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("rounded px-1.5 py-0.5 font-medium", meta.badge)}>{meta.label}</span>
                        {provider.modelType === 'text' ? (
                          <span>{provider._count?.agents || 0} 个助手</span>
                        ) : provider.modelType === 'image' ? (
                          <span>{provider.imageProvider || 'custom'} / {provider.imageApiType || 'sync'}</span>
                        ) : (
                          <span>预留配置</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 text-xs text-muted-foreground">
                    <div className="truncate font-mono text-foreground">{provider.model}</div>
                    <div className="truncate">{provider.apiUrl || '未设置 API URL'}</div>
                  </div>
                  <div className="text-xs">
                    {usage && usage.totalTokens > 0 ? (
                      <div className="flex items-center gap-1.5 text-foreground">
                        <Activity className="size-3.5 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{tokenUsageApi.formatTokens(usage.totalTokens)}</div>
                          <div className="text-muted-foreground/70">{usage.executionCount} 次</div>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">暂无</span>
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
                      {provider.isActive ? '已启用' : '已停用'}
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
                        title={testResults[provider.id]?.connected ? '连接正常' : '测试连接'}
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
                        title="编辑"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleCopy(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground"
                        title="复制配置"
                      >
                        <Copy className="size-3.5" />
                      </button>
                      {!provider.isDefault && provider.isActive && (
                        <button
                          onClick={() => handleSetDefault(provider)}
                          className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-primary"
                          title="设为默认"
                        >
                          <Star className="size-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-muted-foreground transition-colors hover:bg-[var(--surface-subtle)] hover:text-foreground"
                        title={provider.isActive ? '停用' : '激活'}
                      >
                        <Power className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(provider)}
                        className="inline-flex size-7 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                  </div>
                </div>
              )
            })}
          </div>
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
                {editingProvider ? '编辑模型' : '新增模型'}
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
                    名称 <span className="text-red-500">*</span>
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
                    模型类型 <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { value: 'text', label: '文本', icon: Cpu },
                      { value: 'image', label: '图片', icon: Image },
                      { value: 'video', label: '视频', icon: Video },
                      { value: 'audio', label: '语音', icon: Mic },
                    ].map(item => {
                      const Icon = item.icon
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            modelType: item.value as CreateLlmProviderRequest['modelType'],
                            apiProtocol: item.value === 'text' ? (prev.apiProtocol || 'anthropic') : 'openai',
                            imageProvider: item.value === 'image' ? (prev.imageProvider || 'openai') : prev.imageProvider,
                            imageApiType: item.value === 'image' ? (prev.imageApiType || 'sync') : prev.imageApiType,
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
                </div>

                {/* API URL */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    API URL <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.apiUrl}
                    onChange={e => setFormData(prev => ({ ...prev, apiUrl: e.target.value }))}
                    placeholder="https://api.anthropic.com"
                    className="ta-input w-full shadow-none"
                  />
                </div>

                {/* API Key */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    API Key <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={formData.apiKey}
                      onChange={e => setFormData(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="sk-..."
                      className="ta-input flex-1 shadow-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="ta-icon-button"
                      title={showApiKey ? '隐藏密码' : '显示密码'}
                    >
                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* 模型 */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    模型 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={e => setFormData(prev => ({ ...prev, model: e.target.value }))}
                    className="ta-input w-full shadow-none"
                  />
                </div>

                {/* API 协议 */}
                {formData.modelType === 'text' && (
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    API 协议 <span className="text-red-500">*</span>
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
                    Anthropic 协议支持 Claude 特性（thinking、prompt caching），OpenAI 协议兼容更多模型
                  </p>
                </div>
                )}

                {formData.modelType === 'image' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        图片供应商 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.imageProvider || 'openai'}
                        onChange={e => setFormData(prev => ({ ...prev, imageProvider: e.target.value }))}
                        className="ta-input w-full shadow-none"
                      >
                        <option value="openai">OpenAI</option>
                        <option value="apimart">APIMart</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="gemini">Gemini</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        调用方式 <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={formData.imageApiType || 'sync'}
                        onChange={e => setFormData(prev => ({ ...prev, imageApiType: e.target.value as CreateLlmProviderRequest['imageApiType'] }))}
                        className="ta-input w-full shadow-none"
                      >
                        <option value="sync">同步返回图片</option>
                        <option value="async">返回任务 ID 后轮询</option>
                        <option value="auto">自动识别</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* 默认模型 */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.isDefault}
                    onChange={e => setFormData(prev => ({ ...prev, isDefault: e.target.checked }))}
                    className="rounded border-input"
                  />
                  <label htmlFor="isDefault" className="text-sm text-foreground">
                    设为默认模型
                  </label>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  className="ta-button-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="ta-button-primary"
                >
                  {editingProvider ? '保存' : '创建'}
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
                <h2 className="text-lg font-semibold text-foreground">AI 创建模型配置</h2>
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
                输入您的 API 配置信息描述，AI 会自动解析并填充表单。例如：
              </p>
              <div className="mb-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                <p>"我有一个 DeepSeek API，地址是 https://api.deepseek.com，API Key 是 sk-xxx，模型是 deepseek-chat"</p>
                <p className="mt-1">"我的 Claude API key 是 sk-ant-xxx"</p>
              </div>
              <textarea
                value={aiDescription}
                onChange={e => setAiDescription(e.target.value)}
                placeholder="描述您的 API 配置信息..."
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
                取消
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
                {isAiParsing ? '解析中...' : '解析配置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
