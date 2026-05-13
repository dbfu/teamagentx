import { Check, Download, Loader2, RefreshCw } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { UserAvatarSelector } from '@/components/chat/user-avatar'
import { setupApi, type AcpToolInfo } from '@/lib/setup-api'

interface SetupWizardProps {
  onComplete: (data: { token: string; userId: string; username: string }) => void
  onSkip?: () => void
}

const STEP_WELCOME = 0
const STEP_TOOLS = 1
const STEP_ACCOUNT = 2
const STEP_DONE = 3

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState(STEP_WELCOME)
  const [tools, setTools] = useState<AcpToolInfo[]>([])
  const [selectedTool, setSelectedTool] = useState<string>('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState('')
  // 安装状态：{ toolId: 'installing' | 'installed' | 'failed' }
  const [installStates, setInstallStates] = useState<Record<string, string>>({})
  const [installLog, setInstallLog] = useState<Record<string, string>>({})

  // 检测已安装工具
  const detectTools = useCallback(async () => {
    setDetecting(true)
    try {
      const status = await setupApi.getStatus()
      setTools(status.installedTools)
      // 默认选中第一个已安装的工具
      const installedIds = status.installedTools.filter(t => t.installed).map(t => t.id)
      if (installedIds.length > 0 && !selectedTool) {
        setSelectedTool(installedIds.includes('claude') ? 'claude' : installedIds[0])
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
      console.log('[SetupWizard] calling completeSetup', { username: username.trim(), defaultAcpTool: selectedTool })
      const result = await setupApi.completeSetup({
        username: username.trim(),
        password,
        avatar: String(selectedAvatarIndex),
        defaultAcpTool: selectedTool,
      })
      console.log('[SetupWizard] completeSetup success', result)
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
      if (!selectedTool) { setError('请选择默认 Agent'); return }
      setStep(STEP_ACCOUNT)
    } else if (step === STEP_ACCOUNT) {
      if (!validateAccount()) return
      setStep(STEP_DONE)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800">
      <div className="w-[520px] shrink-0 rounded-2xl bg-card shadow-2xl">
        {/* 步骤指示器 */}
        <div className="flex items-center justify-center gap-2 border-b border-border px-6 py-4">
          {['欢迎', '工具检测', '创建账户', '完成'].map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex size-7 items-center justify-center rounded-full text-xs font-medium ${
                i <= step ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
              }`}>
                {i < step ? <Check className="size-4" /> : i + 1}
              </div>
              <span className={`text-xs ${i <= step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                {label}
              </span>
              {i < 3 && <div className="h-px w-6 bg-border" />}
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
              <h2 className="mb-4 text-lg font-semibold text-foreground">检测本地 AI 工具</h2>

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

          {/* Step 2: 创建账户 */}
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
                    selectedIndex={selectedAvatarIndex}
                    onSelect={setSelectedAvatarIndex}
                  />
                </div>
              </div>

              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
              )}

              <div className="mt-4 flex items-center justify-between">
                <button onClick={() => { setError(''); setStep(STEP_TOOLS) }} className="text-sm text-muted-foreground hover:text-foreground">
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

          {/* Step 3: 完成 */}
          {step === STEP_DONE && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30">
                <Check className="size-8" />
              </div>
              <h2 className="mb-2 text-lg font-semibold text-foreground">配置完成</h2>
              <div className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
                <p>用户名: <span className="font-medium text-foreground">{username}</span></p>
                <p>默认 Agent: <span className="font-medium text-foreground">{tools.find(t => t.id === selectedTool)?.name}</span></p>
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
