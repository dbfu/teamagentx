import { UserAvatar, UserAvatarSelector } from '@/components/chat/user-avatar';
import { useTheme } from '@/components/theme-provider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { acpToolsApi, settingsApi, type AcpToolInfo } from '@/lib/agent-api';
import { authApi } from '@/lib/auth-api';
import {
  getDesktopNotificationSettingsUrl,
  getDesktopNotificationStatus,
  shouldShowDesktopNotificationControls,
} from '@/lib/desktop-notification-settings';
import { TERMINAL_OPEN_OPTIONS, type TerminalOpenTarget } from '@/lib/open-targets';
import { openExternalUrl, TEAMAGENTX_DOCS_URL, TEAMAGENTX_WEBSITE_URL } from '@/lib/site-links';
import { cn } from '@/lib/utils';
import { useAuthStore, useUIStore } from '@/stores';
import { BookOpenText, Check, Download, ExternalLink, GitBranch, Globe2, Loader2, LogOut, Monitor, Moon, Palette, Power, RefreshCw, Settings, Smartphone, Sun, Terminal, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

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
  const { t, i18n } = useTranslation()
  const { theme, setTheme, brandTheme, setBrandTheme } = useTheme()
  const { user, token, logout, setUser } = useAuthStore()
  const { soundEnabled, setSoundEnabled, showGitBranch, setShowGitBranch, terminalOpenTarget, setTerminalOpenTarget } = useUIStore()
  const [username, setUsername] = useState(user?.username || '')
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatar || '0')
  const [isUpdating, setIsUpdating] = useState(false)
  const [mobileWebUrl, setMobileWebUrl] = useState<string | null>(null)
  const [customServerUrl, setCustomServerUrl] = useState<string>('')
  const [generatedQRData, setGeneratedQRData] = useState<{ serverUrl: string; qrUrl: string } | null>(null)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showQRConfirmModal, setShowQRConfirmModal] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [localNetworkIps, setLocalNetworkIps] = useState<string[]>([])
  const [selectedLocalIp, setSelectedLocalIp] = useState<string>('')
  const [refreshingIps, setRefreshingIps] = useState(false)
  const [acpTools, setAcpTools] = useState<AcpToolInfo[]>([])
  const [loadingAcpTools, setLoadingAcpTools] = useState(false)
  const [installingToolId, setInstallingToolId] = useState<string | null>(null)
  const [installLog, setInstallLog] = useState<Record<string, string>>({})
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [openAtLoginSupported, setOpenAtLoginSupported] = useState(true)
  const [savingOpenAtLogin, setSavingOpenAtLogin] = useState(false)
  const [openingNotificationSettings, setOpeningNotificationSettings] = useState(false)
  const [diaryEnabled, setDiaryEnabled] = useState(false)
  const [savingDiary, setSavingDiary] = useState(false)

  // 读取助手日记全局开关
  useEffect(() => {
    settingsApi.get('diaryEnabled').then((res) => {
      if (res.success && res.data) setDiaryEnabled(res.data.value === 'true')
    }).catch(() => {})
  }, [])

  // 切换助手日记全局开关
  const handleToggleDiary = async (next: boolean) => {
    setSavingDiary(true)
    const prev = diaryEnabled
    setDiaryEnabled(next)
    try {
      const res = await settingsApi.set('diaryEnabled', next ? 'true' : 'false')
      if (res.success) {
        toast.success(t('settings.diaryFeatureToggled'))
      } else {
        setDiaryEnabled(prev)
        toast.error(t('common.saveFailed'))
      }
    } catch {
      setDiaryEnabled(prev)
      toast.error(t('common.saveFailed'))
    } finally {
      setSavingDiary(false)
    }
  }

  // 语言选项
  const languageOptions = [
    { value: 'zh-CN', label: '中文' },
    { value: 'en-US', label: 'English' },
  ] as const

  // 切换语言
  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('teamagentx-lang', lang)
    toast.success(t('settings.languageChanged'))
  }

  const isElectronDesktop = window.electronAPI?.isElectron ?? false
  const notificationPermission = typeof Notification === 'undefined' ? 'default' : Notification.permission
  const desktopNotificationStatus = getDesktopNotificationStatus({
    isElectron: isElectronDesktop,
    platform: window.electronAPI?.platform,
    permission: notificationPermission,
  })
  const desktopNotificationSettingsUrl = window.electronAPI?.platform
    ? getDesktopNotificationSettingsUrl(window.electronAPI.platform)
    : null
  const desktopPlatform = window.electronAPI?.platform

  const handleUpdateProfile = async () => {
    if (!token || !user) return
    if (!username.trim()) {
      toast.error(t('settings.usernameRequired'))
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
        toast.success(t('settings.profileUpdated'))
      } else {
        toast.error(t('settings.profileUpdateFailed'))
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

  const handleOpenNotificationSettings = async () => {
    if (!desktopNotificationSettingsUrl) {
      toast.info(t('settings.notificationSettingsNotSupported'))
      return
    }

    setOpeningNotificationSettings(true)
    try {
      const result = await openExternalUrl(desktopNotificationSettingsUrl)
      if (!result.success) {
        toast.error(t('settings.notificationSettingsFailed'))
        return
      }
      toast.success(t('settings.notificationSettingsOpened'))
    } finally {
      setOpeningNotificationSettings(false)
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
      toast.error(t('settings.inputServerAddress'))
      return
    }
    try {
      setGeneratedQRData(buildQrLoginUrl(qrServerUrl, token, user.username, qrApiServerUrl))
    } catch {
      toast.error(t('settings.invalidServerAddress'))
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
      toast.error(t('settings.updateSupportOnlyDesktop'))
      return
    }

    setCheckingUpdate(true)
    try {
      const result = await api.checkForUpdates()
      if (!result.success) {
        toast.error(t('settings.checkUpdateFailed'))
        return
      }

      if (result.data?.hasUpdate && result.data.update) {
        window.dispatchEvent(new CustomEvent('teamagentx-update-found', {
          detail: {
            currentVersion: result.data.currentVersion,
            update: result.data.update,
          },
        }))
        toast.success(t('settings.updateAvailableHint', { version: result.data.update.version }))
        return
      }

      toast.success(t('settings.noUpdate'))
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
        toast.error(t('toast.loadFailed'))
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

  useEffect(() => {
    if (!window.electronAPI?.isElectron || !window.electronAPI.getOpenAtLoginSettings) return

    window.electronAPI.getOpenAtLoginSettings()
      .then((result) => {
        if (!result.success || !result.data) {
          setOpenAtLoginSupported(false)
          return
        }
        setOpenAtLoginSupported(result.data.supported)
        setOpenAtLogin(result.data.openAtLogin)
      })
      .catch(() => {
        setOpenAtLoginSupported(false)
      })
  }, [])

  const handleOpenAtLoginChange = async (checked: boolean) => {
    const api = window.electronAPI
    if (!api?.isElectron || !api.setOpenAtLogin) {
      toast.error(t('settings.openAtLoginSupportOnlyDesktop'))
      return
    }

    const previous = openAtLogin
    setOpenAtLogin(checked)
    setSavingOpenAtLogin(true)
    try {
      const result = await api.setOpenAtLogin(checked)
      if (!result.success || !result.data) {
        setOpenAtLogin(previous)
        toast.error(t('settings.openAtLoginFailed'))
        return
      }

      setOpenAtLoginSupported(result.data.supported)
      setOpenAtLogin(result.data.openAtLogin)
      toast.success(result.data.openAtLogin ? t('settings.openAtLoginEnabled') : t('settings.openAtLoginDisabled'))
    } catch (error: any) {
      setOpenAtLogin(previous)
      toast.error(error?.message || t('settings.openAtLoginError'))
    } finally {
      setSavingOpenAtLogin(false)
    }
  }

  const handleInstallAcpSdk = async (toolId: string) => {
    setInstallingToolId(toolId)
    setInstallLog(prev => ({ ...prev, [toolId]: '' }))
    try {
      const exitCode = await acpToolsApi.installTool(toolId, (text) => {
        setInstallLog(prev => ({ ...prev, [toolId]: (prev[toolId] || '') + text }))
      })
      if (exitCode === 0) {
        toast.success(t('settings.sdkInstallSuccess'))
        await refreshAcpTools()
        return
      }
      toast.error(t('settings.sdkInstallFailed'))
    } catch (error: any) {
      toast.error(error.message || t('settings.sdkInstallError'))
    } finally {
      setInstallingToolId(null)
    }
  }

  const themeOptions = [
    { value: 'light', label: t('settings.themeLight'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), icon: Moon },
    { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
  ] as const
  const brandOptions = [
    {
      value: 'enterprise',
      label: t('settings.brandEnterprise'),
      description: t('settings.brandEnterpriseDesc'),
      swatches: ['oklch(0.55 0.22 250)', 'oklch(0.72 0.12 250)', 'oklch(0.96 0.012 245)'],
    },
    {
      value: 'graphite',
      label: t('settings.brandGraphite'),
      description: t('settings.brandGraphiteDesc'),
      swatches: ['oklch(0.36 0.018 260)', 'oklch(0.72 0.02 260)', 'oklch(0.945 0.004 260)'],
    },
    {
      value: 'violet',
      label: t('settings.brandViolet'),
      description: t('settings.brandVioletDesc'),
      swatches: ['oklch(0.54 0.28 293)', 'oklch(0.7 0.19 293)', 'oklch(0.96 0.02 300)'],
    },
    {
      value: 'emerald',
      label: t('settings.brandEmerald'),
      description: t('settings.brandEmeraldDesc'),
      swatches: ['oklch(0.55 0.16 158)', 'oklch(0.72 0.15 158)', 'oklch(0.955 0.016 176)'],
    },
    {
      value: 'ruby',
      label: t('settings.brandRuby'),
      description: t('settings.brandRubyDesc'),
      swatches: ['oklch(0.55 0.2 18)', 'oklch(0.7 0.18 18)', 'oklch(0.96 0.015 35)'],
    },
  ] as const

  const getRuntimeLabel = (tool: AcpToolInfo) => {
    if (tool.preferredRuntime === 'sdk') return t('settings.runtimeSdk')
    if (tool.preferredRuntime === 'cli') return t('settings.runtimeCli')
    return t('settings.runtimeUnavailable')
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
          <h2 className="text-xl font-semibold text-foreground">{t('settings.pageTitle')}</h2>
        </div>
      </div>

      {/* Content */}
      <div className={cn("flex-1 overflow-y-auto", isMobile ? "p-4 pb-20" : "p-4")}>
        {/* 用户信息部分 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('settings.userInfo')}</h2>

          {/* 用户名 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium">{t('settings.username')}</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('settings.usernamePlaceholder')}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          {/* 头像选择 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium">{t('settings.avatar')}</label>
            <UserAvatarSelector
              selectedAvatar={selectedAvatar}
              onSelect={setSelectedAvatar}
            />
          </div>

          {/* 预览 */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium">{t('settings.preview')}</label>
            <div className="flex items-center gap-3">
              <UserAvatar avatar={selectedAvatar} size="lg" />
              <span className="text-sm font-medium">{username || t('settings.previewUsername')}</span>
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
                {t('settings.updating')}
              </span>
            ) : t('settings.saveChanges')}
          </button>
        </div>

        {/* 主题设置部分 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-[var(--control-shadow)]">
          <div className="mb-4 flex items-center gap-2">
            <Palette className="size-4 text-primary" />
            <h2 className="text-sm font-medium text-muted-foreground">{t('settings.appearance')}</h2>
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

          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2">
              <GitBranch className="size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">{t('settings.gitBranchDisplay')}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.gitBranchDisplayHint')}
                </p>
              </div>
            </div>
            <Switch
              checked={showGitBranch}
              onCheckedChange={setShowGitBranch}
              aria-label={t('settings.gitBranchDisplay')}
            />
          </div>

          {/* 语言设置 */}
          <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2">
              <Globe2 className="size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">{t('settings.language')}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.languageHint')}
                </p>
              </div>
            </div>
            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 助手日记 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('settings.diaryFeature')}</h2>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2">
              <BookOpenText className="size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">{t('settings.diaryFeature')}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.diaryFeatureDesc')}
                </p>
              </div>
            </div>
            <Switch
              checked={diaryEnabled}
              disabled={savingDiary}
              onCheckedChange={handleToggleDiary}
              aria-label={t('settings.diaryFeature')}
            />
          </div>
        </div>

        {/* 提示音设置 */}
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('settings.notification')}</h2>

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
              <span className="text-sm">{t('settings.messageSound')}</span>
            </div>
            {soundEnabled && (
              <Check className="size-4 text-primary" />
            )}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('settings.messageSoundHint')}
          </p>

          <div className="mt-4 rounded-lg border border-border bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Monitor className="size-4 text-primary" />
                  <span className="text-sm font-medium text-foreground">{t('settings.desktopNotification')}</span>
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs',
                  desktopNotificationStatus.tone === 'success'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : desktopNotificationStatus.tone === 'warning'
                      ? 'bg-amber-500/10 text-amber-600'
                      : 'bg-blue-500/10 text-blue-600',
                )}
              >
                {desktopNotificationStatus.title}
              </span>
            </div>

            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {desktopNotificationStatus.description}
            </p>

            {desktopPlatform === 'darwin' && (
              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {t('settings.notificationMacPath')}
                {t('settings.notificationMacHint')}
              </div>
            )}

            {desktopPlatform === 'win32' && (
              <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {t('settings.notificationWinPath')}
                {t('settings.notificationWinHint')}
              </div>
            )}

            {shouldShowDesktopNotificationControls(isElectronDesktop) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleOpenNotificationSettings}
                  disabled={openingNotificationSettings}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {openingNotificationSettings ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('settings.opening')}
                    </>
                  ) : (
                    <>
                      <ExternalLink className="size-3.5" />
                      {t('settings.systemSettings')}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 客户端设置 */}
        {window.electronAPI?.isElectron && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <Power className="size-4 text-primary" />
              <h2 className="text-sm font-medium text-muted-foreground">{t('settings.client')}</h2>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-3">
              <div>
                <div className="text-sm font-medium text-foreground">{t('settings.openAtLogin')}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.openAtLoginHint')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {savingOpenAtLogin && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                <Switch
                  checked={openAtLogin}
                  disabled={!openAtLoginSupported || savingOpenAtLogin}
                  onCheckedChange={handleOpenAtLoginChange}
                  aria-label={t('settings.openAtLogin')}
                />
              </div>
            </div>

            {!openAtLoginSupported && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('settings.openAtLoginNotSupported')}
              </p>
            )}
          </div>
        )}

        {/* 终端设置 */}
        {window.electronAPI?.isElectron && window.electronAPI.platform === 'darwin' && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t('settings.terminalSettings')}</h2>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t('settings.terminalAppLabel')}</label>
            <Select
              value={terminalOpenTarget}
              onValueChange={(value) => setTerminalOpenTarget(value as TerminalOpenTarget)}
            >
              <SelectTrigger className="w-full rounded-lg border-border bg-background">
                <SelectValue placeholder={t('settings.selectTerminal')} />
              </SelectTrigger>
              <SelectContent>
                {TERMINAL_OPEN_OPTIONS.map((option) => (
                  <SelectItem key={option.target} value={option.target}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('settings.terminalHint')}
            </p>
          </div>
        )}

        {/* SDK 管理 */}
        {window.electronAPI?.isElectron && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Terminal className="size-4 text-primary" />
                <h2 className="text-sm font-medium text-muted-foreground">{t('settings.acpToolsTitle')}</h2>
              </div>
              <button
                onClick={refreshAcpTools}
                disabled={loadingAcpTools || installingToolId !== null}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={cn('size-3.5', loadingAcpTools && 'animate-spin')} />
                {t('settings.redetect')}
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
                            CLI: {tool.cliInstalled ? (tool.cliVersion || t('settings.cliDetected')) : t('settings.cliNotDetected')}
                          </span>
                          <span className={cn(tool.sdkInstalled && 'text-blue-600')}>
                            SDK: {tool.sdkInstalled ? (tool.sdkVersion || t('settings.sdkInstalled')) : t('settings.sdkNotInstalled')}
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
                            {t('settings.installing')}
                          </>
                        ) : tool.sdkInstalled ? (
                          <>
                            <Download className="size-3.5" />
                            {t('settings.reinstallSdk')}
                          </>
                        ) : (
                          <>
                            <Download className="size-3.5" />
                            {t('settings.installSdk')}
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
                  {t('settings.noAcpTools')}
                </div>
              )}
            </div>

            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              {t('settings.acpToolsHint')}
            </p>
          </div>
        )}

        {/* 移动端连接 */}
        {canShowMobileConnect && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="w-full flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t('settings.mobileConnect')}</span>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-3">
                {t('settings.scanToConnectHint')}
              </p>

              {/* 局域网地址选择 + 刷新 */}
              {localNetworkIps.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium">{t('settings.localNetworkIp')}</label>
                    <button
                      onClick={refreshLocalIps}
                      disabled={refreshingIps}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <RefreshCw className={cn('size-3', refreshingIps && 'animate-spin')} />
                      {t('settings.refreshIp')}
                    </button>
                  </div>
                  {localNetworkIps.length > 1 ? (
                    <Select
                      value={selectedLocalIp}
                      onValueChange={handleLocalIpChange}
                    >
                      <SelectTrigger className="w-full rounded-lg border-border bg-background">
                        <SelectValue placeholder={t('settings.selectLocalNetworkIp')} />
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
                <label className="mb-1.5 block text-sm font-medium">{t('settings.serverAddress')}</label>
                <input
                  type="text"
                  value={customServerUrl}
                  onChange={(e) => setCustomServerUrl(e.target.value)}
                  placeholder={t('settings.serverAddressPlaceholder')}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t('settings.serverAddressHint')}
                </p>
              </div>

              {/* 生成二维码按钮 */}
              <button
                onClick={() => {
                  setShowQRConfirmModal(true)
                }}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
              >
                {t('settings.generateQR')}
              </button>

            </div>
          </div>
        )}

        {/* 网页访问 */}
        {window.electronAPI?.isElectron && localServerUrl && token && user && (
          <div className="mb-6 rounded-xl border border-border bg-card p-4">
            <div className="mb-4 flex items-center gap-2">
              <ExternalLink className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{t('settings.webAccess')}</span>
            </div>
            <button
              onClick={() => {
                // 构建带登录参数的 URL
                const loginUrl = buildQrLoginUrl(localServerUrl, token, user.username)
                window.electronAPI?.openExternal(loginUrl.qrUrl)
                  .then((result) => {
                    if (!result?.success) {
                      toast.error(t('settings.openWebFailed'))
                    }
                  })
                  .catch(() => {
                    toast.error(t('settings.openWebFailed'))
                  })
              }}
              className="w-full rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
            >
              <span className="flex items-center justify-center gap-2">
                <ExternalLink className="size-4" />
                {t('settings.openWeb')}
              </span>
            </button>
          </div>
        )}

        {/* 二维码安全提示弹框 */}
        {showQRConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-[480px] rounded-2xl bg-card shadow-xl p-8">
              <div className="flex items-center justify-center mb-5">
                <div className="rounded-full bg-orange-100 p-4">
                  <VolumeX className="size-7 text-orange-600" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-foreground text-center mb-3">{t('settings.securityAlert')}</h3>
              <p className="text-sm text-muted-foreground text-center leading-relaxed mb-8">
                {t('settings.securityAlertHint')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowQRConfirmModal(false)}
                  className="flex-1 rounded-lg border border-gray-200 text-gray-600 px-4 py-2.5 text-sm hover:bg-gray-50 whitespace-nowrap"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={() => {
                    handleGenerateQRCode()
                    setShowQRConfirmModal(false)
                    setShowQRModal(true)
                  }}
                  className="flex-1 rounded-lg bg-blue-500 px-4 py-2.5 text-sm text-white hover:bg-blue-600 whitespace-nowrap"
                >
                  {t('settings.iUnderstand')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 二维码弹框 */}
        {showQRModal && generatedQRData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-[480px] rounded-2xl bg-card shadow-xl p-8">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xl font-semibold text-foreground">{t('settings.scanToConnect')}</h3>
                <button
                  onClick={() => setShowQRModal(false)}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground mb-5">
                {t('settings.scanToConnectHint')}
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
                <h2 className="text-sm font-medium text-muted-foreground">{t('settings.clientUpdate')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.currentVersion')} {appVersion || t('settings.versionUnknown')}
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
                {checkingUpdate ? t('settings.checkingUpdate') : t('settings.checkUpdate')}
              </span>
            </button>
          </div>
        )}

        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <BookOpenText className="size-4 text-primary" />
            <h2 className="text-sm font-medium text-muted-foreground">{t('settings.websiteAndDocs')}</h2>
          </div>
          <p className="mb-4 text-xs leading-5 text-muted-foreground">
            {t('settings.websiteAndDocsHint')}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => handleOpenExternalLink(TEAMAGENTX_WEBSITE_URL, t('settings.openWebsiteFailed'))}
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-accent"
            >
              <Globe2 className="size-4" />
              {t('settings.websiteHome')}
            </button>
            <button
              onClick={() => handleOpenExternalLink(TEAMAGENTX_DOCS_URL, t('settings.openDocsFailed'))}
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
            >
              <BookOpenText className="size-4" />
              {t('settings.userDocs')}
            </button>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-red-500 hover:bg-red-500/10"
        >
          <span className="flex items-center justify-center gap-2">
            <LogOut className="size-4" />
            {t('auth.logout')}
          </span>
        </button>

        {/* 版本号 */}
        {appVersion && (
          <div className="mt-4 text-center text-xs text-muted-foreground">
            {t('settings.version')} {appVersion}
          </div>
        )}
      </div>
    </div>
  )
}
