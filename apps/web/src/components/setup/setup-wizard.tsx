import { useTranslation } from 'react-i18next'
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

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const { t, i18n } = useTranslation()
  const STEP_LABELS = t('setup.stepLabels', { returnObjects: true }) as string[]
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
      setError(t('setup.detectToolsFailed'))
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
      setInstallLog(prev => ({ ...prev, [toolId]: (prev[toolId] || '') + '\n' + (t('setup.installFailed')) }))
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
      setError(t('common.operationFailed'))
    } finally {
      setLoading(false)
    }
  }

  // 验证账户信息
  const validateAccount = (): boolean => {
    if (!username.trim()) { setError(t('auth.usernameRequired')); return false }
    if (username.length < 2 || username.length > 20) { setError(t('auth.usernameLengthRange')); return false }
    if (password.length < 4) { setError(t('validation.minLength', { min: 4 })); return false }
    if (password !== confirmPassword) { setError(t('auth.passwordMismatch')); return false }
    return true
  }

  const goNext = () => {
    setError('')
    if (step === STEP_TOOLS) {
      if (!selectedTool) { setError(t('setup.selectDefaultEngine')); return }
      setStep(STEP_MODEL)
    } else if (step === STEP_MODEL) {
      if (modelSource === 'manual') {
        // 手动配置时，apiKey 和模型都必须填。
        if (!modelApiKey.trim()) {
          setError(t('setup.apiKeyRequired'))
          return
        }
        if (!modelName.trim()) {
          setError(t('setup.modelRequired'))
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
              <h1 className="mb-2 text-xl font-bold text-foreground">{t('setup.welcomeTitle')}</h1>
              <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
                {t('setup.welcomeDescription')}
              </p>

              {/* 语言选择 */}
              <div className="mb-6 flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t('settings.language')}:</span>
                <Select
                  value={i18n.language || 'zh-CN'}
                  onValueChange={(lang) => {
                    i18n.changeLanguage(lang)
                    localStorage.setItem('teamagentx-lang', lang)
                  }}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh-CN">中文</SelectItem>
                    <SelectItem value="en-US">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <button
                onClick={() => setStep(STEP_TOOLS)}
                className="rounded-lg bg-blue-500 px-8 py-2.5 text-sm font-medium text-white hover:bg-blue-600"
              >
                {t('setup.beginSetup')}
              </button>
            </div>
          )}

          {/* Step 1: 工具检测 */}
          {step === STEP_TOOLS && (
            <div>
              <h2 className="mb-1 text-lg font-semibold text-foreground">{t('setup.detectToolsTitle')}</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                {t('setup.detectToolsHint')}
              </p>

              {detecting ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="mr-2 size-5 animate-spin text-blue-500" />
                  <span className="text-muted-foreground">{t('setup.checking')}</span>
                </div>
              ) : (
                <>
                  {/* 已安装工具 */}
                  {installedTools.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-sm text-muted-foreground">{t('setup.installedToolsLabel')}</p>
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
                              <Check className="size-3.5" /> {t('setup.installedStatus')}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 未安装工具 */}
                  {uninstalledTools.length > 0 && (
                    <div className="mb-4">
                      <p className="mb-2 text-sm text-muted-foreground">{t('setup.uninstalledToolsLabel')}</p>
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
                                    <><Loader2 className="size-3.5 animate-spin" /> {t('setup.installingTool')}</>
                                  ) : state === 'installed' ? (
                                    <><Check className="size-3.5" /> {t('setup.installSuccess')}</>
                                  ) : state === 'failed' ? (
                                    <><Download className="size-3.5" /> {t('setup.retryInstall')}</>
                                  ) : (
                                    <><Download className="size-3.5" /> {t('setup.installBtn')}</>
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
                      {t('setup.noToolsInstalledHint')}
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
                      {t('setup.redetect')}
                    </button>
                  </div>

                  {selectedTool && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t('setup.defaultAgent')}: <span className="font-medium text-foreground">{tools.find(t => t.id === selectedTool)?.name}</span>
                    </p>
                  )}
                </>
              )}

              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button onClick={() => setStep(STEP_WELCOME)} className="text-sm text-muted-foreground hover:text-foreground">
                  {t('setup.prevStep')}
                </button>
                <button
                  onClick={goNext}
                  disabled={!hasInstalled || !selectedTool}
                  className="rounded-lg bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('setup.nextStep')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: 模型配置 */}
          {step === STEP_MODEL && (
            <div>
              <h2 className="mb-1 text-lg font-semibold text-foreground">{t('setup.configDefaultModel')}</h2>
              <p className="mb-4 text-xs text-muted-foreground">
                {t('setup.configDefaultModelHint')}
              </p>

              {/* 配置方式选择 */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  {t('setup.configMethod')}
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
                      {t('setup.useLocalConfig')}
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
                    {t('setup.manualConfig')}
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
                          {t('setup.detectedLocalConfig', { label: selectedToolInfo?.localConfigLabel || t('setup.localConfigDefaultLabel') })}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-blue-600/80 dark:text-blue-400/80">
                        {t('setup.configFilePath')}: {selectedToolInfo?.localConfigPath}
                      </p>
                    </div>
                    {/* Codex 模型选择 */}
                    {isCodex && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">
                          {t('setup.codexModelLabel')}
                        </label>
                        <div className="relative">
                          <select
                            value={modelName || '__default__'}
                            onChange={e => setModelName(e.target.value === '__default__' ? '' : e.target.value)}
                            className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground focus:border-blue-500 focus:outline-none"
                          >
                            <option value="__default__">{t('setup.useLocalDefaultModel')}</option>
                            {getCodexModelOptions(modelName).map(option => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {t('setup.willUseLocalApiKey')}
                        </p>
                      </div>
                    )}
                    {!isCodex && (
                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-foreground">
                          {t('setup.claudeModelLabel')}
                        </label>
                        <Select
                          value={modelName || '__default__'}
                          onValueChange={(value) => setModelName(value === '__default__' ? '' : value)}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={t('setup.selectClaudeModelPlaceholder')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__default__">{t('setup.useLocalDefaultModel')}</SelectItem>
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
                          {t('setup.claudeConfigHint')}
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
                      {t('setup.apiProtocolLabel')}
                    </label>
                    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                      {selectedTool === 'codex' ? 'OpenAI' : 'Anthropic'}
                      <span className="text-xs">({t('setup.autoDeterminedByEngine')})</span>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">
                      {t('model.apiUrl')}
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
                      {t('model.apiKey')} <span className="text-red-500">*</span>
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
                      {t('model.model')} <span className="text-red-500">*</span>
                    </label>
                    {selectedTool === 'codex' ? (
                      <input
                        type="text"
                        value={modelName}
                        onChange={e => setModelName(e.target.value)}
                        placeholder={t('setup.placeholderCodexModel')}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={modelName}
                        onChange={e => setModelName(e.target.value)}
                        placeholder={t('setup.placeholderClaudeModel')}
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
                  {t('setup.prevStep')}
                </button>
                <button
                  onClick={goNext}
                  disabled={
                    (modelSource === 'manual' && (!modelApiKey.trim() || !modelName.trim()))
                  }
                  className="rounded-lg bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('setup.nextStep')}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 创建账户 */}
          {step === STEP_ACCOUNT && (
            <div>
              <h2 className="mb-4 text-lg font-semibold text-foreground">{t('setup.createAdminAccountTitle')}</h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('setup.usernameLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={t('setup.usernamePlaceholder')}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('setup.passwordLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={t('setup.passwordPlaceholderSetup')}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">
                    {t('setup.confirmPasswordLabel')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder={t('setup.confirmPasswordPlaceholder')}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground">{t('setup.avatarLabel')}</label>
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
                  {t('setup.prevStep')}
                </button>
                <button
                  onClick={goNext}
                  className="rounded-lg bg-blue-500 px-6 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  {t('setup.nextStep')}
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
              <h2 className="mb-2 text-lg font-semibold text-foreground">{t('setup.setupCompleteTitle')}</h2>
              <div className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
                <p>{t('setup.usernameSummary')}: <span className="font-medium text-foreground">{username}</span></p>
                <p>{t('setup.defaultEngineSummary')}: <span className="font-medium text-foreground">{tools.find(t => t.id === selectedTool)?.name}</span></p>
                {modelSource === 'local' && selectedTool === 'codex' && (
                  <p>{t('setup.modelConfigSummary')}: <span className="font-medium text-foreground">{modelName || t('setup.localDefaultModel')}</span></p>
                )}
                {modelSource === 'local' && selectedTool !== 'codex' && (() => {
                  const selectedToolInfo = tools.find(t => t.id === selectedTool)
                  const fallbackModel = selectedToolInfo?.localModels?.[0]?.name
                  return (
                    <p>{t('setup.defaultModelSummary')}: <span className="font-medium text-foreground">{modelName || fallbackModel || t('setup.localDefaultModel')}</span></p>
                  )
                })()}
                {modelSource === 'manual' && modelName.trim() && (
                  <p>{t('setup.defaultModelSummary')}: <span className="font-medium text-foreground">{modelName}</span></p>
                )}
              </div>
              <button
                onClick={handleComplete}
                disabled={loading}
                className="rounded-lg bg-blue-500 px-8 py-2.5 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? t('setup.saving') : t('setup.startUsing')}
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
