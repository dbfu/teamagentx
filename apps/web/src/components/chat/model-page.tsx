import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { llmProviderApi, type CreateLlmProviderRequest, type LlmProvider, type UpdateLlmProviderRequest } from '@/lib/llm-provider-api';
import { tokenUsageApi, type TokenUsageByProvider } from '@/lib/token-usage-api';
import { cn } from '@/lib/utils';
import { Check, Copy, Cpu, Eye, EyeOff, Pencil, Plus, Power, RefreshCw, Sparkles, Star, Trash2, Wifi, WifiOff, X } from 'lucide-react';
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
    apiProtocol: 'anthropic',
    apiUrl: '',
    apiKey: '',
    model: '',
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
  const hasDefaultProvider = providers.some(p => p.isDefault && p.isActive)

  // 打开创建对话框
  const openCreateDialog = () => {
    setEditingProvider(null)
    setFormData({
      name: '',
      type: 'custom',
      apiProtocol: 'anthropic',
      apiUrl: '',
      apiKey: '',
      model: '',
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
      apiProtocol: provider.apiProtocol || 'anthropic',
      apiUrl: provider.apiUrl || '',
      apiKey: provider.apiKey,
      model: provider.model,
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
      apiProtocol: provider.apiProtocol || 'anthropic',
      apiUrl: provider.apiUrl || '',
      apiKey: provider.apiKey,
      model: provider.model,
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
        apiProtocol: response.data.apiProtocol ?? 'anthropic',
        apiUrl: response.data.apiUrl ?? '',
        apiKey: response.data.apiKey ?? '',
        model: response.data.model ?? '',
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
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* 头部 */}
      <div
        className="flex items-center justify-between px-6 h-14 border-b border-border"
        style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
      >
        <div className="flex items-center gap-3">
          <Cpu className="size-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold text-foreground">模型管理</h2>
        </div>
        <div
          className="flex items-center gap-2"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Button
            variant="outline"
            onClick={loadProviders}
            disabled={isLoading}
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
            刷新
          </Button>
          <Button className="bg-primary text-white hover:bg-primary/90" onClick={openCreateDialog}>
            <Plus className="size-4" />
            新增模型
          </Button>
          {hasDefaultProvider && (
            <Button variant="outline" onClick={openAiDialog}>
              <Sparkles className="size-4" />
              AI创建
            </Button>
          )}
        </div>
      </div>

      {/* 供应商列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
        <div className="flex items-center justify-center h-full text-muted-foreground">加载中...</div>
      ) : providers.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <Cpu className="size-12 mb-2 opacity-50" />
          <p>暂无模型配置</p>
          <p className="text-sm mt-1">请创建一个模型以使用原生助手</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>供应商</TableHead>
                <TableHead>模型</TableHead>
                <TableHead>Token 使用</TableHead>
                <TableHead>关联助手</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-40">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map(provider => (
                <TableRow key={provider.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {provider.name}
                      {provider.isDefault && (
                        <span className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          <Star className="size-3" />
                          默认
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">自定义</TableCell>
                  <TableCell className="text-muted-foreground">{provider.model}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {(() => {
                      const usage = getTokenUsage(provider.id)
                      if (!usage || usage.totalTokens === 0) {
                        return <span className="text-muted-foreground/60">-</span>
                      }
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-medium text-foreground">
                            {tokenUsageApi.formatTokens(usage.totalTokens)}
                          </span>
                          <span className="text-xs text-muted-foreground/60">
                            {usage.executionCount} 次执行
                          </span>
                        </div>
                      )
                    })()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {provider._count?.agents || 0}
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded px-2 py-1 text-xs',
                      provider.isActive
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {provider.isActive ? <Check className="size-3" /> : <Power className="size-3" />}
                      {provider.isActive ? '激活' : '停用'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleTestConnection(provider)}
                        disabled={testingProvider === provider.id}
                        className={cn(
                          'flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground',
                          testingProvider === provider.id && 'opacity-50 cursor-wait'
                        )}
                        title={testResults[provider.id]?.connected ? '连接正常' : '测试连接'}
                      >
                        {testingProvider === provider.id ? (
                          <RefreshCw className="size-4 animate-spin" />
                        ) : testResults[provider.id]?.connected ? (
                          <Wifi className="size-4 text-green-500" />
                        ) : testResults[provider.id] ? (
                          <WifiOff className="size-4 text-red-500" />
                        ) : (
                          <Wifi className="size-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openEditDialog(provider)}
                        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="编辑"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => handleCopy(provider)}
                        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="复制配置"
                      >
                        <Copy className="size-4" />
                      </button>
                      {!provider.isDefault && provider.isActive && (
                        <button
                          onClick={() => handleSetDefault(provider)}
                          className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-primary"
                          title="设为默认"
                        >
                          <Star className="size-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleActive(provider)}
                        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        title={provider.isActive ? '停用' : '激活'}
                      >
                        <Power className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(provider)}
                        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      </div>

      {/* 创建/编辑对话框 */}
      {!isDialogOpen ? null : (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
          <div className="w-[800px] shrink-0 rounded-2xl bg-background shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">
                {editingProvider ? '编辑模型' : '新增模型'}
              </h2>
              <button
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
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
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
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
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="flex size-9 items-center justify-center rounded-lg border border-input text-muted-foreground hover:bg-accent"
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
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                </div>

                {/* API 协议 */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    API 协议 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-4">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, apiProtocol: 'anthropic' }))}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors',
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
                        'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors',
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
                  className="rounded-lg border border-input px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
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
          <div className="w-[500px] rounded-2xl bg-background shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">AI 创建模型配置</h2>
              </div>
              <button
                onClick={() => setIsAiDialogOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <p className="mb-4 text-sm text-muted-foreground">
                输入您的 API 配置信息描述，AI 会自动解析并填充表单。例如：
              </p>
              <div className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <p>"我有一个 DeepSeek API，地址是 https://api.deepseek.com，API Key 是 sk-xxx，模型是 deepseek-chat"</p>
                <p className="mt-1">"我的 Claude API key 是 sk-ant-xxx"</p>
              </div>
              <textarea
                value={aiDescription}
                onChange={e => setAiDescription(e.target.value)}
                placeholder="描述您的 API 配置信息..."
                rows={4}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={() => setIsAiDialogOpen(false)}
                className="rounded-lg border border-input px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAiParse}
                disabled={isAiParsing}
                className={cn(
                  'flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90',
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
