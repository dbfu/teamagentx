import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AcpToolInfo, acpToolsApi, AgentCategory, categoryApi } from '@/lib/agent-api';
import { AgentAvatarImage, agentAvatarOptions } from '@/lib/agent-avatars';
import { llmProviderApi, type LlmProvider } from '@/lib/llm-provider-api';
import { getProviderProtocolHint, isProviderCompatibleWithAgent } from '@/lib/llm-provider-compat';
import { promptOptimizeApi } from '@/lib/prompt-optimize-api';
import { cn } from '@/lib/utils';
import { Check, Image, Loader2, Maximize2, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface CreateAssistantModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    avatarIndex: number
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    categoryId: string | null
    llmProviderId: string | null
    imageGeneration?: {
      enabled: boolean
      llmProviderId: string | null
    }
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
        toast.success('提示词已优化')
      },
      // onError: 错误时
      (error) => {
        setIsOptimizing(false)
        toast.error(error || '优化失败')
      }
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">编辑提示词</h2>
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
            placeholder="请输入助手的提示词，用于定义助手的行为和角色"
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
            AI 优化
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onConfirm(editPrompt)}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function CreateAssistantModal({ isOpen, onClose, onSubmit, defaultCategoryId }: CreateAssistantModalProps) {
  // 直接在 useState 初始化时使用 defaultCategoryId
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(0)
  const [assistantType, setAssistantType] = useState<'builtin' | 'acp'>('acp')
  const [acpTool, setAcpTool] = useState('claude')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [categories, setCategories] = useState<AgentCategory[]>([])
  const [llmProviders, setLlmProviders] = useState<LlmProvider[]>([])
  const [llmProviderId, setLlmProviderId] = useState<string>('')
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(false)
  const [imageProviderId, setImageProviderId] = useState<string>('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const compatibleLlmProviders = llmProviders.filter(
    (provider) => provider.isActive && isProviderCompatibleWithAgent(provider, assistantType, acpTool)
  )
  const imageProviders = llmProviders.filter(
    (provider) => provider.isActive && provider.modelType === 'image'
  )
  const selectedAcpTool = acpTools.find((tool) => tool.id === acpTool)

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
      toast.warning('已清除不兼容的 LLM 供应商')
    }
  }, [assistantType, acpTool, llmProviderId, llmProviders])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || isSubmitting) return
    if (imageGenerationEnabled && !imageProviderId) {
      toast.error('请先选择图片模型')
      return
    }

    setIsSubmitting(true)
    try {
      const success = await onSubmit({
        name: name.trim(),
        avatarIndex: selectedAvatarIndex,
        description: description.trim(),
        prompt,
        type: assistantType,
        acpTool: assistantType === 'acp' ? acpTool : '',
        categoryId: categoryId || null,
        llmProviderId: llmProviderId || null,
        imageGeneration: {
          enabled: imageGenerationEnabled,
          llmProviderId: imageGenerationEnabled ? imageProviderId || null : null,
        },
      })

      if (success) {
        // Reset form
        setName('')
        setDescription('')
        setPrompt('')
        setSelectedAvatarIndex(0)
        setAssistantType('acp')
        setAcpTool('claude')
        setCategoryId('')
        setLlmProviderId('')
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
            <AgentAvatarImage avatar={selectedAvatarIndex} className="size-9" />
            <h2 className="text-lg font-semibold text-foreground">创建助手</h2>
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
                名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入助手名称"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Agent <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <Select value={acpTool} onValueChange={setAcpTool}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="选择 Agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {acpTools.length === 0 ? (
                      <SelectItem value="claude" disabled>
                        加载中...
                      </SelectItem>
                    ) : (
                      acpTools.map((tool) => (
                        <SelectItem key={tool.id} value={tool.id} disabled={!tool.installed}>
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
            </div>

            {/* LLM Provider selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                模型供应商
              </label>
              <Select value={llmProviderId || '__none__'} onValueChange={(v) => setLlmProviderId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择模型供应商" />
                </SelectTrigger>
                <SelectContent>
                  {selectedAcpTool?.localConfigAvailable && (
                    <SelectItem value="__none__">
                      使用本地 Agent 配置
                    </SelectItem>
                  )}
                  {compatibleLlmProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      <span className="flex items-center gap-2">
                        {provider.name}
                        {provider.isDefault && (
                          <span className="rounded bg-primary/10 px-1 py-0.5 text-xs text-primary">
                            默认
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {compatibleLlmProviders.length === 0 && !selectedAcpTool?.localConfigAvailable && (
                <p className="mt-1 text-xs text-muted-foreground">
                  暂无兼容供应商，请先配置模型或登录本地 Agent
                </p>
              )}
              {!llmProviderId && selectedAcpTool && !selectedAcpTool.localConfigAvailable && (
                <p className="mt-1 text-xs text-red-500">
                  未检测到 {selectedAcpTool.localConfigLabel || selectedAcpTool.name}，请先登录本地 Agent 或选择一个模型供应商
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {getProviderProtocolHint(assistantType, acpTool)}
              </p>
            </div>

            {/* Image generation capability */}
            <div className="mb-4 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Image className="size-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium text-foreground">图片生成能力</div>
                    <div className="text-xs text-muted-foreground">开启后助手可通过受控工具生成图片</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setImageGenerationEnabled(v => !v)}
                  className={cn(
                    'relative h-5 w-10 rounded-full transition-colors',
                    imageGenerationEnabled ? 'bg-primary' : 'bg-muted'
                  )}
                  aria-pressed={imageGenerationEnabled}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 size-4 rounded-full bg-white transition-transform',
                      imageGenerationEnabled ? 'translate-x-5' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
              {imageGenerationEnabled && (
                <div className="mt-3">
                  <Select value={imageProviderId || '__none__'} onValueChange={(v) => setImageProviderId(v === '__none__' ? '' : v)}>
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

            {/* Avatar selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">头像</label>
              <div className="grid max-h-64 grid-cols-6 gap-2 overflow-y-auto rounded-lg border border-input bg-background p-2">
                {agentAvatarOptions.map((index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`选择头像 ${index + 1}`}
                    onClick={() => setSelectedAvatarIndex(index)}
                    className={cn(
                      'relative flex size-12 items-center justify-center rounded-full transition-all hover:ring-2 hover:ring-primary/30',
                      selectedAvatarIndex === index && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                  >
                    <AgentAvatarImage avatar={index} className="size-12" />
                    {selectedAvatarIndex === index && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-white shadow-sm">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">描述</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="请输入助手描述"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* Category */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">分类</label>
              <Select value={categoryId || '__none__'} onValueChange={(v) => setCategoryId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择分类（可选）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分类</SelectItem>
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
                  提示词
                </label>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(true)}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="全屏编辑"
                >
                  <Maximize2 className="size-4" />
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="请输入助手的提示词，用于定义助手的行为和角色（可选）"
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
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? '创建中...' : '创建'}
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
