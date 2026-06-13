import { useTheme } from '@/components/theme-provider'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { settingsApi } from '@/lib/agent-api'
import { authApi } from '@/lib/auth-api'
import {
  getDesktopNotificationSettingsUrl,
  getDesktopNotificationStatus,
  shouldShowDesktopNotificationControls,
} from '@/lib/desktop-notification-settings'
import { openExternalUrl } from '@/lib/site-links'
import { cn } from '@/lib/utils'
import { useAuthStore, useUIStore } from '@/stores'
import { BookOpenText, Check, ExternalLink, FileText, GitBranch, Globe2, Loader2, Monitor, Moon, Palette, Power, Sun, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

/**
 * 通用设置：外观（主题/品牌色/分支显示/语言）、助手日记、消息与通知
 */
export function GeneralSection() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme, brandTheme, setBrandTheme } = useTheme()
  const { token, setUser } = useAuthStore()
  const { soundEnabled, setSoundEnabled, showGitBranch, setShowGitBranch } = useUIStore()
  const [openingNotificationSettings, setOpeningNotificationSettings] = useState(false)
  const [diaryEnabled, setDiaryEnabled] = useState(false)
  const [savingDiary, setSavingDiary] = useState(false)
  const [showDiaryEnableConfirm, setShowDiaryEnableConfirm] = useState(false)
  const [openAtLogin, setOpenAtLogin] = useState(false)
  const [openAtLoginSupported, setOpenAtLoginSupported] = useState(true)
  const [savingOpenAtLogin, setSavingOpenAtLogin] = useState(false)
  const [debugLogEnabled, setDebugLogEnabled] = useState(false)
  const [savingDebugLog, setSavingDebugLog] = useState(false)

  // 读取助手日记全局开关
  useEffect(() => {
    settingsApi.get('diaryEnabled').then((res) => {
      if (res.success && res.data) setDiaryEnabled(res.data.value === 'true')
    }).catch(() => {})
  }, [])

  // 读取开机自启状态
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

  useEffect(() => {
    if (!window.electronAPI?.isElectron || !window.electronAPI.getDebugLogSettings) return

    window.electronAPI.getDebugLogSettings()
      .then((result) => {
        if (result.success && result.data) {
          setDebugLogEnabled(result.data.enabled)
        }
      })
      .catch(() => {})
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

  const handleDebugLogChange = async (checked: boolean) => {
    const api = window.electronAPI
    if (!api?.isElectron || !api.setDebugLogEnabled) {
      toast.error(t('settings.debugLogSupportOnlyDesktop'))
      return
    }

    const previous = debugLogEnabled
    setDebugLogEnabled(checked)
    setSavingDebugLog(true)
    try {
      const result = await api.setDebugLogEnabled(checked)
      if (!result.success || !result.data) {
        setDebugLogEnabled(previous)
        toast.error(t('settings.debugLogSaveFailed'))
        return
      }

      setDebugLogEnabled(result.data.enabled)
      toast.success(result.data.enabled ? t('settings.debugLogEnabled') : t('settings.debugLogDisabled'))
    } catch (error: any) {
      setDebugLogEnabled(previous)
      toast.error(error?.message || t('settings.debugLogSaveFailed'))
    } finally {
      setSavingDebugLog(false)
    }
  }

  const saveDiaryEnabled = async (next: boolean) => {
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

  // 切换助手日记全局开关
  const handleToggleDiary = async (next: boolean) => {
    if (next && !diaryEnabled) {
      setShowDiaryEnableConfirm(true)
      return
    }
    await saveDiaryEnabled(next)
  }

  // 语言选项
  const languageOptions = [
    { value: 'zh-CN', label: '中文' },
    { value: 'en-US', label: 'English' },
  ] as const

  // 切换语言：本地立即生效，并持久化到服务端（决定 Agent 系统提示词语种）
  const handleLanguageChange = (lang: string) => {
    i18n.changeLanguage(lang)
    localStorage.setItem('teamagentx-lang', lang)
    toast.success(t('settings.languageChanged'))

    if (token) {
      authApi
        .updateProfile(token, { preferredLanguage: lang })
        .then((response) => {
          if (response.success && response.data) {
            setUser(response.data)
          }
        })
        .catch(() => {
          // 持久化失败不阻塞界面切换，仅记录
          console.error('[settings] 同步界面语言到服务端失败')
        })
    }
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

  return (
    <>
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

      {/* 客户端设置 */}
      {isElectronDesktop && (
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

          <div className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">{t('settings.debugLog')}</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.debugLogHint')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {savingDebugLog && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={debugLogEnabled}
                disabled={savingDebugLog}
                onCheckedChange={handleDebugLogChange}
                aria-label={t('settings.debugLog')}
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

      <ConfirmDialog
        open={showDiaryEnableConfirm}
        onOpenChange={setShowDiaryEnableConfirm}
        title={t('settings.diaryEnableConfirmTitle')}
        description={t('settings.diaryEnableConfirmDesc')}
        confirmText={t('common.enable')}
        loading={savingDiary}
        icon={BookOpenText}
        iconColor="text-blue-500"
        iconBgColor="bg-blue-500/10"
        confirmButtonClass="bg-blue-500 hover:bg-blue-600"
        onConfirm={() => saveDiaryEnabled(true)}
      />
    </>
  )
}
