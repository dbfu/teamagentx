import { Check, ChevronDown, Download, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { UserAvatarSelector } from '@/components/chat/user-avatar'
import { getClaudeModelOptions } from '@/lib/claude-models'
import { setupApi, type AcpToolInfo } from '@/lib/setup-api'
import { getCodexModelOptions } from '@/lib/codex-models'

interface SetupWizardProps {
  onComplete: (data: { token: string; userId: string; username: string }) => void
  onSkip?: () => void
}

const STEP_WELCOME = 0
const STEP_TOOLS = 1
const STEP_MODEL = 2
const STEP_ACCOUNT = 3
const STEP_DONE = 4

const STEP_LABELS = ['欢迎', '工具检测', '模型配置', '创建账户', '完成']

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(STEP_WELCOME)
  const [tools, setTools] = useState<AcpToolInfo[]>([])
  const [selectedTool, setSelectedTool] = useState<string>('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState('0')
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')
  const [modelApiUrl, setModelApiUrl] = useState('')
  const [modelApiKey, setModelApiKey] = useState('')
  const [modelName, setModelName] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  // 安装状态：{ toolId: 'installing' | 'installed' | 'failed' }
  const [installStates, setInstallStates] = useState<Record<string, string>>({})
  const [installLog, setInstallLog] = useState<Record<string, string>>({})
  // 模型配置来源：'local' 使用本地 CLI 配置 | 'manual' 手动输入
  const [modelSource, setModelSource] = useState<'local' | 'manual'>('local')

  // 检测已安装工具
  const detectTools = useCallback(async () => {
    setDetecting(true)
    try {
      const status = await setupApi.getStatus()
      setTools(status.installedTools)
      // 默认选中第一个已安装的工具
      const installedIds = status.installedTools.filter(t => t.installed).map(t => t.id)
      const defaultToolId = installedIds.includes('claude') ? 'claude' : installedIds[0] || ''
      if (installedIds.length > 0 && !selectedTool) {
        setSelectedTool(defaultToolId)
      }
      // 根据本地配置情况设置模型来源
      const selectedToolInfo = status.installedTools.find(t => t.id === (selectedTool || defaultToolId))
      const localModels = selectedToolInfo?.localModels ?? []
      if (selectedToolInfo?.localConfigAvailable) {
        setModelSource('local')
        if ((selectedTool || defaultToolId) === 'claude' && localModels[0]?.name) {
          setModelName(localModels[0].name)
        }
      } else {
        setModelSource('manual')
      }
    } catch {
      setError('检测工具失败，请确认后端服务已启动')
    } finally {
      setDetecting(false)
    }
  }, [selectedTool])

  useEffect(() => {
    if (step === STEP_TOOLS && tools.length === 0) {
      detectTools()
    }
  }, [step, tools.length, detectTools])

  const installedTools = tools.filter(t => t.installed)
  const uninstalledTools = tools.filter(t => !t.installed)
  const hasInstalled = installedTools.length > 0

  // 安装工具
  const handleInstall = async (toolId: string) => {
    setInstallStates(prev => ({ ...prev, [toolId]: 'installing' }))
    setInstallLog(prev => ({ ...prev, [toolId]: '' }))
    try {
      const code = await setupApi.installTool(toolId, (text) => {
        setInstallLog(prev => ({ ...prev, [toolId]: (prev[toolId] || '') + text }))
      })
      if (code === 0) {
        setInstallStates(prev => ({ ...prev, [toolId]: 'installed' }))
        // 刷新工具列表
        await detectTools()
        // 3秒后清除成功状态
        setTimeout(() => {
          setInstallStates(prev => {
            const next = { ...prev }
            delete next[toolId]
            return next
          })
          setInstallLog(prev => {
            const next = { ...prev }
            delete next[toolId]
            return next
          })
        }, 3000)
      } else {
        setInstallStates(prev => ({ ...prev, [toolId]: 'failed' }))
      }
    } catch (err: any) {
      setInstallStates(prev => ({ ...prev, [toolId]: 'failed' }))
      setInstallLog(prev => ({ ...prev, [toolId]: (prev[toolId] || '') + '\n' + (err.message || '安装失败') }))
    }
  }

  // 完成引导
  const handleComplete = async () => {
    setError('')
    setLoading(true)
    try {
      const apiProtocol = selectedTool === 'codex' ? 'openai' : 'anthropic'
      // 只有手动配置时才创建 LlmProvider
      const hasManualConfig = modelSource === 'manual' && modelApiKey.trim() && modelName.trim()
      const result = await setupApi.completeSetup({
        username: username.trim(),
        password,
        avatar: selectedAvatar,
        defaultAcpTool: selectedTool,
        ...(hasManualConfig ? {
          modelConfig: {
            apiUrl: modelApiUrl.trim() || undefined,
            apiKey: modelApiKey.trim(),
            model: modelName.trim(),
            apiProtocol,
          },
        } : {}),
      })
      onComplete(result)
    } catch (err: any) {
      console.error('[SetupWizard] completeSetup error', err)
      setError(err.message || '设置失败')
    } finally {
      setLoading(false)
    }
  }

  // 验证账户信息
  const validateAccount = (): boolean => {
    if (!username.trim()) { setError('请输入用户名'); return false }
    if (username.length < 2 || username.length > 20) { setError('用户名长度需要在 2-20 个字符之间'); return false }
    if (password.length < 4) { setError('密码长度至少需要 4 个字符'); return false }
    if (password !== confirmPassword) { setError('两次输入的密码不一致'); return false }
    return true
  }

  const goNext = () => {
    setError('')
    if (step === STEP_TOOLS) {
      if (!selectedTool) { setError('请选择默认引擎'); return }
      setStep(STEP_MODEL)
    } else if (step === STEP_MODEL) {
      if (modelSource === 'manual') {
        // 手动配置时，apiKey 和模型都必须填。
        if (!modelApiKey.trim()) {
          setError('API Key 为必填项')
          return
        }
        if (!modelName.trim()) {
          setError('模型名称为必填项')
          return
        }
      }
      setStep(STEP_ACCOUNT)
    } else if (step === STEP_ACCOUNT) {
      if (!validateAccount()) return
      setStep(STEP_DONE)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
      <div className="w-[640px] shrink-0 rounded-2xl bg-card shadow-2xl">
        {/* 步骤指示器 */}
        <div className="flex items-center justify-center gap-1.5 border-b border-border px-6 py-4">
          {STEP_LABELS.map((label, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`flex size-6 items-center justify-center rounded-full text-xs font-medium ${
                i <= step ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
              }`}>
                {i < step ? <Check className="size-3.5" /> : i + 1}
              </div>
              <span className={`text-xs ${i <= step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {label}
              </span>
              {i < STEP_LABELS.length - 1 && <div className="h-px w-4 bg-border" />}
            </div>
          ))}
        </div>

        {/* 内容区 */}
        <div className="min-h-[340px] p-6">
          {/* Step 0: 欢迎 */}
          {step === STEP_WELCOME && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-blue-500 text-2xl text-white font-bold">
                T
              </div>
              <h1 className="mb-2 text-xl font-bold text-foreground">欢迎使用 TeamAgentX</h1>
              <p className="mb-8 max-w-sm text-center text-sm text-muted-foreground">
                多 Agent 协作平台。接下来将帮助你检测本地 AI 工具并完成初始配置。
              </p>
              <button
                onClick={() => setStep(STEP_TOOLS)}
                className="rounded-lg bg-blue-500 px-8 py-2.5 text-sm font-medium text-white hover:bg-blue-600"
              >
                开始设置
              </button>
            </div>
          )}

          {/* Step 1: 工具检测 */}
          {step === STEP_TOOLS && (
            <div>
              <h2 className="mb-1 text-lg font-semibold text-foreground">检测本地 AI 工具</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                选择一个已安装的 AI 工具作为默认引擎，系统内置助手将使用该引擎处理任务。
              </p>

              {detecting ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="mr-2 size-5 animate-spin text-blue-500" />
                  <span className="text-muted-foreground">正在检测...</span>
                </div>
              ) : (
                <>
                  {/* 已安装工具 */}
                  {installedTools.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-sm text-muted-foreground">已安装的工具</p>
                      <div className="space-y-2">
                        {installedTools.map(tool => (
                          <label
                            key={tool.id}
                            className={`flex cursor-pointer items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                              selectedTool === tool.id
                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                                : 'border-border hover:border-blue-300'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="defaultTool"
                                value={tool.id}
                                checked={selectedTool === tool.id}
                                onChange={() => setSelectedTool(tool.id)}
                                className="accent-blue-500"
                              />
                              <div>
                                <div className="text-sm font-medium text-foreground">{tool.name}</div>
                                <div className="text-xs text-muted-foreground">{tool.description}</div>
                              </div>
                            </div>
                            <span className="flex items-center gap-1 text-xs text-green-600">
                              <Check className="size-3.5" /> 已安装
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 未安装工具 */}
                  {uninstalledTools.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-sm text-muted-foreground">未安装的工具</p>
                      <div className="space-y-2">
                        {uninstalledTools.map(tool => {
                          const state = installStates[tool.id]
                          const log = installLog[tool.id]
                          const isInstalling = state === 'installing'
                          return (
                            <div key={tool.id} className="rounded-lg border border-border px-4 py-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <span className="text-sm font-medium text-foreground">{tool.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground">{tool.description}</span>
                                </div>
                                <button
                                  onClick={() => handleInstall(tool.id)}
                                  disabled={isInstalling || state === 'installed'}
                                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed ${
                                    state === 'installed'
                                      ? 'bg-green-500'
                                      : state === 'failed'
                                        ? 'bg-red-500 hover:bg-red-600'
                                        : 'bg-blue-500 hover:bg-blue-600 disabled:opacity-50'
                                  }`}
                                >
                                  {isInstalling ? (
                                    <><Loader2 className="size-3.5 animate-spin" /> 安装中...</>
                                  ) : state === 'installed' ? (
                                    <><Check className="size-3.5" /> 安装成功</>
                                  ) : state === 'failed' ? (
                                    <><Download className="size-3.5" /> 重试安装</>
                                  ) : (
                                    <><Download className="size-3.5" /> 安装</>
                                  )}
                                </button>
                              </div>
                              {log && (
                                <pre className="mt-2 max-h-24 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground whitespace-pre-wrap">{log}</pre>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 都没安装的提示 */}
                  {!hasInstalled && !detecting && Object.values(installStates).every(s => s !== 'installing') && (
                    <div className="mb-4 rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-200">
                      未检测到已安装的 AI 工具。请点击"安装"按钮下载安装。
                    </div>
                  )}

                  {/* 刷新按钮 */}
                  <div className="flex items-center justify-end">
                    <button
                      onClick={detectTools}
                      disabled={detecting}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <RefreshCw className={`size-3.5 ${detecting ? 'animate-spin' : ''}`} />
                      重新检测
                    </button>
                  </div>

                  {selectedTool && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      默认 Agent: <span className="font-medium text-foreground">{tools.find(t => t.id === selectedTool)?.name}</span>
                    </p>
                  )}
                </>
              )}

              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button onClick={() => setStep(STEP_WELCOME)} className="text-sm text-muted-foreground hover:text-foreground">
                  上一步
                </button>
                <button
                  onClick={goNext}
                  disabled={!hasInstalled || !selectedTool}
                  className="rounded-lg bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一步
                </button>
              </div>
            </div>
          )}

          {/* Step 2: 模型配置 */}
          {step === STEP_MODEL && (
            <div>
              <h2 className="mb-1 text-lg font-semibold text-foreground">配置默认模型</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                为所选引擎配置 API 模型，配置后将作为默认模型使用。也可以跳过，稍后在设置中配置。
              </p>

              {/* 配置方式选择 */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  配置方式
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {tools.find(t => t.id === selectedTool)?.localConfigAvailable && (
                    <button
                      type="button"
                      onClick={() => setModelSource('local')}
                      className={`flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors ${
                        modelSource === 'local'
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                          : 'border-border text-muted-foreground hover:border-blue-300'
                      }`}
                    >
                      使用本地配置
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setModelSource('manual')}
                    className={`flex h-9 items-center justify-center rounded-lg border px-3 text-xs font-medium transition-colors ${
                      modelSource === 'manual'
                        ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                        : 'border-border text-muted-foreground hover:border-blue-300'
                    }`}
                  >
                    手动配置
                  </button>
                </div>
              </div>

              {/* 使用本地 CLI 配置 */}
              {modelSource === 'local' && (() => {
                const selectedToolInfo = tools.find(t => t.id === selectedTool)
                const localModels = selectedToolInfo?.localModels || []
                const localModelNames = new Set(localModels.map(model => model.name))
                const isCodex = selectedTool === 'codex'
                return (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/30">
                      <div className="flex items-center gap-2">
                        <Check className="size-4 text-blue-600 dark:text-blue-400" />
                        <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                          已检测到 {selectedToolInfo?.localConfigLabel || '本地 CLI 配置'}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-blue-600/80 dark:text-blue-400/80">
                        配置文件路径: {selectedToolInfo?.localConfigPath}
                      </p>
                    </div>
                    {/* Codex 模型选择 */}
                    {isCodex && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">
                          Codex 模型
                        </label>
                        <div className="relative">
                          <select
                            value={modelName || '__default__'}
                            onChange={e => setModelName(e.target.value === '__default__' ? '' : e.target.value)}
                            className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:border-blue-500 focus:outline-none"
                          >
                            <option value="__default__">使用本地默认模型</option>
                            {getCodexModelOptions(modelName).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          将使用本地 auth.json 中的 API Key
                        </p>
                      </div>
                    )}
                    {!isCodex && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">
                          Claude 模型
                        </label>
                        <Select
                          value={modelName || '__default__'}
                          onValueChange={(value) => setModelName(value === '__default__' ? '' : value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择 Claude 模型" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">使用本地默认模型</SelectItem>
                            {localModels.map(model => (
                              <SelectItem key={model.id} value={model.name}>
                                {model.name}
                              </SelectItem>
                            ))}
                            {getClaudeModelOptions(modelName)
                              .filter(option => !localModelNames.has(option.value))
                              .map(option => (
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
                  </div>
                )
              })()}

              {/* 手动配置 */}
              {modelSource === 'manual' && (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      API 协议
                    </label>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                      {selectedTool === 'codex' ? 'OpenAI' : 'Anthropic'}
                      <span className="text-xs">（由所选引擎自动确定）</span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      API URL
                    </label>
                    <input
                      type="text"
                      value={modelApiUrl}
                      onChange={e => setModelApiUrl(e.target.value)}
                      placeholder={selectedTool === 'codex' ? 'https://api.openai.com' : 'https://api.anthropic.com'}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      API Key <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={modelApiKey}
                        onChange={e => setModelApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      模型 <span className="text-red-500">*</span>
                    </label>
                    {selectedTool === 'codex' ? (
                      <input
                        type="text"
                        value={modelName}
                        onChange={e => setModelName(e.target.value)}
                        placeholder="输入 Codex / OpenAI 模型 ID"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={modelName}
                        onChange={e => setModelName(e.target.value)}
                        placeholder="输入 Claude / 本地模型 ID"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                      />
                    )}
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button onClick={() => { setError(''); setStep(STEP_TOOLS) }} className="text-sm text-muted-foreground hover:text-foreground">
                  上一步
                </button>
                <button
                  onClick={goNext}
                  disabled={
                    (modelSource === 'manual' && (!modelApiKey.trim() || !modelName.trim()))
                  }
                  className="rounded-lg bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一步
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 创建账户 */}
          {step === STEP_ACCOUNT && (
            <div>
              <h2 className="mb-4 text-lg font-semibold text-foreground">创建管理员账户</h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    用户名 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="请输入用户名"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    密码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="请输入密码（至少 4 位）"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    确认密码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="请再次输入密码"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">头像</label>
                  <UserAvatarSelector
                    selectedAvatar={selectedAvatar}
                    onSelect={setSelectedAvatar}
                  />
                </div>
              </div>

              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button onClick={() => { setError(''); setStep(STEP_MODEL) }} className="text-sm text-muted-foreground hover:text-foreground">
                  上一步
                </button>
                <button
                  onClick={goNext}
                  className="rounded-lg bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  下一步
                </button>
              </div>
            </div>
          )}

          {/* Step 4: 完成 */}
          {step === STEP_DONE && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30">
                <Check className="size-8" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-foreground">配置完成</h2>
              <div className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
                <p>用户名: <span className="font-medium text-foreground">{username}</span></p>
                <p>默认引擎: <span className="font-medium text-foreground">{tools.find(t => t.id === selectedTool)?.name}</span></p>
                {modelSource === 'local' && selectedTool === 'codex' && (
                  <p>模型配置: <span className="font-medium text-foreground">{modelName || '本地默认模型'}</span></p>
                )}
                {modelSource === 'local' && selectedTool !== 'codex' && (() => {
                  const selectedToolInfo = tools.find(t => t.id === selectedTool)
                  const fallbackModel = selectedToolInfo?.localModels?.[0]?.name
                  return (
                    <p>默认模型: <span className="font-medium text-foreground">{modelName || fallbackModel || '本地默认模型'}</span></p>
                  )
                })()}
                {modelSource === 'manual' && modelName.trim() && (
                  <p>默认模型: <span className="font-medium text-foreground">{modelName}</span></p>
                )}
              </div>
              <button
                onClick={handleComplete}
                disabled={loading}
                className="rounded-lg bg-blue-500 px-8 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? '正在保存...' : '开始使用'}
              </button>
              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
