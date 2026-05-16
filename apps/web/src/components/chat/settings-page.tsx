import { UserAvatar, UserAvatarSelector } from '@/components/chat/user-avatar';
import { useTheme } from '@/components/theme-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { acpToolsApi, type AcpToolInfo } from '@/lib/agent-api';
import { authApi } from '@/lib/auth-api';
import { openExternalUrl, TEAMAGENTX_DOCS_URL, TEAMAGENTX_WEBSITE_URL } from '@/lib/site-links';
import { cn } from '@/lib/utils';
import { useAuthStore, useUIStore } from '@/stores';
import { BookOpenText, Check, Download, ExternalLink, Globe2, Loader2, LogOut, Monitor, Moon, Palette, RefreshCw, Settings, Smartphone, Sun, Terminal, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

// 二维码组件
function QRCodeDisplay({ data }: { data: { serverUrl: string; qrUrl: string } }) {
  const [qrImage, setQrImage] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return

    // 动态导入 qrcode-generator
    import('qrcode-generator').then((QRCode) => {
      const qr = QRCode.default(0, 'M')
      qr.addData(data.qrUrl)
      qr.make()

      // 生成 SVG
      const cellSize = 4
      const margin = 8
      const size = qr.getModuleCount() * cellSize + margin * 2

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
      svg += `<rect width="${size}" height="${size}" fill="white"/>`

      for (let row = 0; row < qr.getModuleCount(); row++) {
        for (let col = 0; col < qr.getModuleCount(); col++) {
          if (qr.isDark(row, col)) {
            svg += `<rect x="${margin + col * cellSize}" y="${margin + row * cellSize}" width="${cellSize}" height="${cellSize}" fill="black"/>`
          }
        }
      }
      svg += '</svg>'

      setQrImage(`data:image/svg+xml;base64,${btoa(svg)}`)
    })
  }, [data])

  if (!qrImage) return null

  return (
    <div className="flex flex-col items-center">
      <img src={qrImage} alt="QR Code" className="w-48 h-48" />
    </div>
  )
}

function normalizeServerUrl(url: string) {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function getBrowserApiServerUrl(webUrl: string) {
  const normalizedWebUrl = normalizeServerUrl(webUrl)
  if (!normalizedWebUrl) return ''

  if (import.meta.env.DEV) {
    const parsedUrl = new URL(normalizedWebUrl)
    return `${parsedUrl.protocol}//${parsedUrl.hostname}:3001`
  }

  return normalizedWebUrl
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

function replaceUrlHostname(url: string, hostname: string) {
  const parsedUrl = new URL(normalizeServerUrl(url))
  parsedUrl.hostname = hostname
  return parsedUrl.toString().replace(/\/+$/, '')
}

async function getLocalNetworkIp() {
  try {
    const apiUrl = getBrowserApiServerUrl(window.location.origin)
    const response = await fetch(`${apiUrl}/network-info`)
    const data = await response.json() as { localIp?: string | null; localIps?: string[] }
    return {
      localIp: data.localIp || data.localIps?.[0] || null,
      localIps: data.localIps || (data.localIp ? [data.localIp] : []),
    }
  } catch {
    return { localIp: null, localIps: [] }
  }
}

function buildQrLoginUrl(webUrl: string, token: string, username: string, apiServerUrl?: string) {
  const normalizedWebUrl = normalizeServerUrl(webUrl)
  const normalizedApiServerUrl = apiServerUrl ? normalizeServerUrl(apiServerUrl) : normalizedWebUrl
  const qrUrl = new URL('/', normalizedWebUrl)
  qrUrl.searchParams.set('qrLogin', '1')
  qrUrl.searchParams.set('token', token)
  qrUrl.searchParams.set('username', username)
  if (normalizedApiServerUrl !== normalizedWebUrl) {
    qrUrl.searchParams.set('serverUrl', normalizedApiServerUrl)
  }
  return {
    serverUrl: normalizedApiServerUrl,
    qrUrl: qrUrl.toString(),
  }
}

interface SettingsPageProps {
  isMobile?: boolean
}

export function SettingsPage({ isMobile }: SettingsPageProps) {
  const navigate = useNavigate()
  const { theme, setTheme, brandTheme, setBrandTheme } = useTheme()
  const { user, token, logout, setUser } = useAuthStore()
  const { soundEnabled, setSoundEnabled } = useUIStore()
  const [username, setUsername] = useState(user?.username || '')
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar || '0')
  const [isUpdating, setIsUpdating] = useState(false)
  const [mobileWebUrl, setMobileWebUrl] = useState<string | null>(null)
  const [customServerUrl, setCustomServerUrl] = useState<string>('')
  const [generatedQRData, setGeneratedQRData] = useState<{ serverUrl: string; qrUrl: string } | null>(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [localNetworkIps, setLocalNetworkIps] = useState<string[]>([])
  const [selectedLocalIp, setSelectedLocalIp] = useState<string>('')
  const [refreshingIps, setRefreshingIps] = useState(false)
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [loadingAcpTools, setLoadingAcpTools] = useState(false)
  const [installingToolId, setInstallingToolId] = useState<string | null>(null)
  const [installLog, setInstallLog] = useState<Record<string, string>>({})

  const handleUpdateProfile = async () => {
    if (!token || !user) return
    if (!username.trim()) {
      toast.error('用户名不能为空')
      return
    }

    setIsUpdating(true)
    try {
      const response = await authApi.updateProfile(token, {
        username: username.trim(),
        avatar: selectedAvatar,
      })

      if (response.success && response.data) {
        setUser(response.data)
        toast.success('个人信息已更新')
      } else {
        toast.error(response.error || '更新失败')
      }
    } finally {
      setIsUpdating(false)
    }
  }

  const handleLogout = () => {
    // 如果在 React Native WebView 中，通知原生端退出登录
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'logout' }))
    }
    logout()
    navigate('/')
  }

  const handleOpenExternalLink = async (url: string, fallbackError: string) => {
    const result = await openExternalUrl(url)
    if (!result.success) {
      toast.error(result.error || fallbackError)
    }
  }

  // 获取局域网地址和版本号
  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getMobileWebUrl().then((url) => {
        setMobileWebUrl(url)
        // 默认使用局域网地址
        setCustomServerUrl(url || '')
      })
      window.electronAPI.getAppVersion().then((version) => {
        setAppVersion(version)
      })
      // Electron 也通过后端 API 获取局域网 IP 列表
      refreshLocalIps()
    } else if (window.location.protocol.startsWith('http')) {
      if (isLoopbackHost(window.location.hostname)) {
        refreshLocalIps()
      } else {
        setCustomServerUrl(window.location.origin)
      }
    }
  }, [])

  const refreshLocalIps = async () => {
    setRefreshingIps(true)
    try {
      if (window.electronAPI?.isElectron) {
        // Electron 通过内嵌后端 API 获取
        const apiUrl = mobileWebUrl || `http://localhost:11053`
        const apiServerUrl = getBrowserApiServerUrl(apiUrl)
        const response = await fetch(`${apiServerUrl}/network-info`)
        const data = await response.json() as { localIp?: string | null; localIps?: string[] }
        const localIps = data.localIps || (data.localIp ? [data.localIp] : [])
        setLocalNetworkIps(localIps)
        if (localIps.length > 0 && !selectedLocalIp) {
          const defaultIp = data.localIp || localIps[0]
          setSelectedLocalIp(defaultIp)
          // 更新 customServerUrl 使用局域网 IP
          if (mobileWebUrl) {
            const parsed = new URL(mobileWebUrl)
            parsed.hostname = defaultIp
            setCustomServerUrl(parsed.toString().replace(/\/+$/, ''))
          }
        }
      } else {
        const { localIp, localIps } = await getLocalNetworkIp()
        setLocalNetworkIps(localIps)
        if (!selectedLocalIp) {
          setSelectedLocalIp(localIp || '')
          setCustomServerUrl(localIp ? replaceUrlHostname(window.location.origin, localIp) : window.location.origin)
        }
      }
    } catch {
      // ignore
    } finally {
      setRefreshingIps(false)
    }
  }

  // 二维码数据使用的服务器地址
  const qrServerUrl = customServerUrl || mobileWebUrl || ''
  const qrApiServerUrl = window.electronAPI?.isElectron ? qrServerUrl : getBrowserApiServerUrl(qrServerUrl)
  const canShowMobileConnect = Boolean(qrServerUrl && token && user)

  // 本地地址（用于打开网页按钮）
  const localServerUrl = mobileWebUrl ? (() => {
    const parsed = new URL(mobileWebUrl)
    parsed.hostname = '127.0.0.1'
    return parsed.toString().replace(/\/+$/, '')
  })() : null

  // 生成二维码
  const handleGenerateQRCode = () => {
    if (!qrServerUrl || !token || !user) {
      toast.error('请输入服务器地址')
      return
    }
    try {
      setGeneratedQRData(buildQrLoginUrl(qrServerUrl, token, user.username, qrApiServerUrl))
    } catch {
      toast.error('服务器地址格式不正确')
    }
  }

  const handleLocalIpChange = (localIp: string) => {
    setSelectedLocalIp(localIp)
    if (window.electronAPI?.isElectron && mobileWebUrl) {
      const parsed = new URL(mobileWebUrl)
      parsed.hostname = localIp
      setCustomServerUrl(parsed.toString().replace(/\/+$/, ''))
    } else {
      setCustomServerUrl(replaceUrlHostname(window.location.origin, localIp))
    }
    setGeneratedQRData(null)
  }

  const handleCheckUpdate = async () => {
    const api = window.electronAPI
    if (!api?.isElectron || !api.checkForUpdates) {
      toast.error('仅桌面客户端支持检查更新')
      return
    }

    setCheckingUpdate(true)
    try {
      const result = await api.checkForUpdates()
      if (!result.success) {
        toast.error(result.error || '检查更新失败')
        return
      }

      if (result.data?.hasUpdate && result.data.update) {
        window.dispatchEvent(new CustomEvent('teamagentx-update-found', {
          detail: {
            currentVersion: result.data.currentVersion,
            update: result.data.update,
          },
        }))
        toast.success(`发现新版本 ${result.data.update.version}，请查看右上角更新提示`)
        return
      }

      toast.success('当前已是最新版本')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const refreshAcpTools = async () => {
    setLoadingAcpTools(true)
    try {
      const response = await acpToolsApi.getAll()
      if (response.success && response.data) {
        setAcpTools(response.data)
      } else {
        toast.error(response.error || '获取 SDK 状态失败')
      }
    } finally {
      setLoadingAcpTools(false)
    }
  }

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      refreshAcpTools()
    }
  }, [])

  const handleInstallAcpSdk = async (toolId: string) => {
    setInstallingToolId(toolId)
    setInstallLog(prev => ({ ...prev, [toolId]: '' }))
    try {
      const exitCode = await acpToolsApi.installTool(toolId, (text) => {
        setInstallLog(prev => ({ ...prev, [toolId]: (prev[toolId] || '') + text }))
      })
      if (exitCode === 0) {
        toast.success('SDK 安装成功，助手将优先使用 SDK')
        await refreshAcpTools()
        return
      }
      toast.error('SDK 安装失败，请查看安装日志')
    } catch (error: any) {
      toast.error(error.message || 'SDK 安装失败')
    } finally {
      setInstallingToolId(null)
    }
  }

  const themeOptions = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'system', label: '跟随系统', icon: Monitor },
  ] as const
  const brandOptions = [
    {
      value: 'enterprise',
      label: '商务蓝',
      description: '稳健、清晰，适合默认团队协作场景',
      swatches: ['oklch(0.55 0.22 250)', 'oklch(0.72 0.12 250)', 'oklch(0.96 0.012 245)'],
    },
    {
      value: 'graphite',
      label: '石墨灰',
      description: '克制、中性，适合正式办公与长时间使用',
      swatches: ['oklch(0.36 0.018 260)', 'oklch(0.72 0.02 260)', 'oklch(0.945 0.004 260)'],
    },
    {
      value: 'emerald',
      label: '翡翠绿',
      description: '专业、冷静，适合运营和增长团队',
      swatches: ['oklch(0.55 0.16 158)', 'oklch(0.72 0.15 158)', 'oklch(0.955 0.016 176)'],
    },
    {
      value: 'ruby',
      label: '曜石红',
      description: '精致、有决策感，适合高层汇报环境',
      swatches: ['oklch(0.55 0.2 18)', 'oklch(0.7 0.18 18)', 'oklch(0.96 0.015 35)'],
    },
  ] as const

  const getRuntimeLabel = (tool: AcpToolInfo) => {
    if (tool.preferredRuntime === 'sdk') return '默认使用 SDK'
    if (tool.preferredRuntime === 'cli') return '默认使用 CLI'
    return '未可用'
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border h-14",
          isMobile ? "px-4" : "px-6"
        )}
        style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
      >
        <div className="flex items-center gap-3">
          <Settings className="size-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold text-foreground">设置</h2>
        </div>
      </div>

      {/* Content */}
      <div className={cn("flex-1 overflow-y-auto", isMobile ? "p-4 pb-20" : "p-4")}>
        {/* 用户信息部分 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">个人信息</h2>

          {/* 用户名 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入用户名"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* 头像选择 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium">头像</label>
            <UserAvatarSelector
              selectedAvatar={selectedAvatar}
              onSelect={setSelectedAvatar}
            />
          </div>

          {/* 预览 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium">预览</label>
            <div className="flex items-center gap-3">
              <UserAvatar avatar={selectedAvatar} size="lg" />
              <span className="text-sm font-medium">{username || '用户名'}</span>
            </div>
          </div>

          {/* 更新按钮 */}
          <button
            onClick={handleUpdateProfile}
            disabled={isUpdating || (username === user?.username && selectedAvatar === (user?.avatar || '0'))}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUpdating ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                更新中...
              </span>
            ) : '保存修改'}
          </button>
        </div>

        {/* 主题设置部分 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-[var(--control-shadow)]">
          <div className="mb-4 flex items-center gap-2">
            <Palette className="size-4 text-primary" />
            <h2 className="text-sm font-medium text-muted-foreground">外观</h2>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            {themeOptions.map((option) => {
              const Icon = option.icon
              return (
                <button
                  key={option.value}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border px-3 py-3 text-center transition-colors',
                    theme === option.value
                      ? 'border-primary bg-[var(--brand-soft)] text-primary shadow-[var(--control-shadow)]'
                      : 'border-border hover:bg-accent'
                  )}
                >
                  <Icon className="size-4" />
                  <span className="text-xs font-medium">{option.label}</span>
                </button>
              )
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {brandOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setBrandTheme(option.value)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  brandTheme === option.value
                    ? 'border-primary bg-[var(--brand-soft)] shadow-[var(--control-shadow)]'
                    : 'border-border hover:bg-accent'
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex overflow-hidden rounded-full border border-border">
                      {option.swatches.map((color) => (
                        <span key={color} className="size-4" style={{ background: color }} />
                      ))}
                    </div>
                    <span className="text-sm font-medium text-foreground">{option.label}</span>
                  </div>
                  {brandTheme === option.value && <Check className="size-4 text-primary" />}
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{option.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 提示音设置 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">通知</h2>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={cn(
              'flex items-center justify-between rounded-lg border border-border px-3 py-2 transition-colors w-full',
              soundEnabled
                ? 'bg-primary/10 border-primary'
                : 'hover:bg-accent'
            )}
          >
            <div className="flex items-center gap-2">
              {soundEnabled ? (
                <Volume2 className="size-4" />
              ) : (
                <VolumeX className="size-4" />
              )}
              <span className="text-sm">消息提示音</span>
            </div>
            {soundEnabled && (
              <Check className="size-4 text-primary" />
            )}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            收到助手回复时播放提示音
          </p>
        </div>

        {/* SDK 管理 */}
        {window.electronAPI?.isElectron && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-primary" />
                <h2 className="text-sm font-medium text-muted-foreground">AI 工具运行方式</h2>
              </div>
              <button
                onClick={refreshAcpTools}
                disabled={loadingAcpTools || installingToolId !== null}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={cn('size-3.5', loadingAcpTools && 'animate-spin')} />
                重新检测
              </button>
            </div>

            <div className="space-y-3">
              {acpTools.map((tool) => {
                const isInstalling = installingToolId === tool.id
                const log = installLog[tool.id]
                return (
                  <div key={tool.id} className="rounded-lg border border-border bg-background p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{tool.name}</span>
                          <span className={cn(
                            'rounded-full px-2 py-0.5 text-xs',
                            tool.preferredRuntime === 'sdk'
                              ? 'bg-blue-500/10 text-blue-600'
                              : tool.preferredRuntime === 'cli'
                                ? 'bg-emerald-500/10 text-emerald-600'
                                : 'bg-muted text-muted-foreground'
                          )}>
                            {getRuntimeLabel(tool)}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span className={cn(tool.cliInstalled && 'text-emerald-600')}>
                            CLI: {tool.cliInstalled ? (tool.cliVersion || '已检测到') : '未检测到'}
                          </span>
                          <span className={cn(tool.sdkInstalled && 'text-blue-600')}>
                            SDK: {tool.sdkInstalled ? (tool.sdkVersion || '已安装') : '未安装'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleInstallAcpSdk(tool.id)}
                        disabled={isInstalling || installingToolId !== null}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isInstalling ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" />
                            安装中
                          </>
                        ) : tool.sdkInstalled ? (
                          <>
                            <Download className="size-3.5" />
                            重新安装 SDK
                          </>
                        ) : (
                          <>
                            <Download className="size-3.5" />
                            安装 SDK
                          </>
                        )}
                      </button>
                    </div>

                    {log && (
                      <pre className="mt-3 max-h-32 overflow-y-auto rounded-md bg-muted/50 p-2 text-xs text-muted-foreground whitespace-pre-wrap">{log}</pre>
                    )}
                  </div>
                )
              })}

              {!loadingAcpTools && acpTools.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  暂未获取到 AI 工具状态
                </div>
              )}
            </div>

            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              已安装应用本地 SDK 时，Claude/Codex 助手会优先使用 SDK；未安装 SDK 但宿主机 CLI 可用时，会继续使用宿主机 CLI。
            </p>
          </div>
        )}

        {/* 移动端连接 */}
        {canShowMobileConnect && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">移动端连接</span>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-3">
                使用手机 TeamAgentX App 扫描二维码，即可自动登录并连接
              </p>

              {/* 局域网地址选择 + 刷新 */}
              {localNetworkIps.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium">局域网地址</label>
                    <button
                      onClick={refreshLocalIps}
                      disabled={refreshingIps}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={cn('size-3', refreshingIps && 'animate-spin')} />
                      刷新
                    </button>
                  </div>
                  {localNetworkIps.length > 1 ? (
                    <Select
                      value={selectedLocalIp}
                      onValueChange={handleLocalIpChange}
                    >
                      <SelectTrigger className="w-full rounded-lg border-border bg-background">
                        <SelectValue placeholder="选择局域网地址" />
                      </SelectTrigger>
                      <SelectContent>
                        {localNetworkIps.map((ip) => (
                          <SelectItem key={ip} value={ip}>
                            {ip}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                      {localNetworkIps[0]}
                    </div>
                  )}
                </div>
              )}

              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium">服务器地址</label>
                <input
                  type="text"
                  value={customServerUrl}
                  onChange={(e) => setCustomServerUrl(e.target.value)}
                  placeholder="请输入服务器地址"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  默认为局域网地址，可修改为其他地址
                </p>
              </div>

              {/* 生成二维码按钮 */}
              <button
                onClick={() => {
                  handleGenerateQRCode()
                  setShowQRModal(true)
                }}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
              >
                生成二维码
              </button>

              {/* 打开网页按钮 - 仅客户端支持 */}
              {window.electronAPI?.isElectron && localServerUrl && token && user && (
                <button
                  onClick={() => {
                    // 构建带登录参数的 URL
                    const loginUrl = buildQrLoginUrl(localServerUrl, token, user.username)
                    window.electronAPI?.openExternal(loginUrl.qrUrl)
                      .then((result) => {
                        if (!result?.success) {
                          toast.error(result?.error || '打开网页失败')
                        }
                      })
                      .catch(() => {
                        toast.error('打开网页失败')
                      })
                  }}
                  className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
                >
                  <span className="flex items-center justify-center gap-2">
                    <ExternalLink className="size-4" />
                    打开网页
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 二维码弹框 */}
        {showQRModal && generatedQRData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-[360px] rounded-2xl bg-card shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">扫码连接</h3>
                <button
                  onClick={() => setShowQRModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                使用手机 TeamAgentX App 扫描下方二维码
              </p>
              <QRCodeDisplay data={generatedQRData} />
            </div>
          </div>
        )}

        {/* 退出登录 */}
        {window.electronAPI?.isElectron && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-muted-foreground">客户端更新</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  当前版本 {appVersion || '未知'}
                </p>
              </div>
              <Download className="size-4 text-primary" />
            </div>
            <button
              onClick={handleCheckUpdate}
              disabled={checkingUpdate}
              className="w-full rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center justify-center gap-2">
                {checkingUpdate ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {checkingUpdate ? '检查中...' : '检查更新'}
              </span>
            </button>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <BookOpenText className="size-4 text-primary" />
            <h2 className="text-sm font-medium text-muted-foreground">官网与文档</h2>
          </div>
          <p className="mb-4 text-xs leading-5 text-muted-foreground">
            查看官网介绍、下载入口和最新使用文档。文档内容按当前客户端功能整理，适合新成员上手和团队内部流转。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => handleOpenExternalLink(TEAMAGENTX_WEBSITE_URL, '打开官网失败')}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
            >
              <Globe2 className="size-4" />
              官网主页
            </button>
            <button
              onClick={() => handleOpenExternalLink(TEAMAGENTX_DOCS_URL, '打开使用文档失败')}
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
            >
              <BookOpenText className="size-4" />
              使用文档
            </button>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-red-500 hover:bg-red-500/10"
        >
          <span className="flex items-center justify-center gap-2">
            <LogOut className="size-4" />
            退出登录
          </span>
        </button>

        {/* 版本号 */}
        {appVersion && (
          <div className="mt-4 text-center text-xs text-muted-foreground">
            版本 {appVersion}
          </div>
        )}
      </div>
    </div>
  )
}
