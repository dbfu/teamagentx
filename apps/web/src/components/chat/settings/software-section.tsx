import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TERMINAL_OPEN_OPTIONS, type TerminalOpenTarget } from '@/lib/open-targets'
import { updateManager } from '@/lib/update-manager'
import { useUIStore } from '@/stores'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { MobileConnectCard } from './mobile-connect-card'
import { SdkToolsCard } from './sdk-tools-card'

/**
 * 软件配置：客户端、终端、SDK、移动端连接、网页访问、客户端更新
 */
export function SoftwareSection() {
  const { t } = useTranslation()
  const { terminalOpenTarget, setTerminalOpenTarget } = useUIStore()
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const isElectron = window.electronAPI?.isElectron ?? false

  useEffect(() => {
    if (window.electronAPI?.isElectron) {
      window.electronAPI.getAppVersion().then((version) => {
        setAppVersion(version)
      })
    }
  }, [])

  const handleCheckUpdate = async () => {
    const api = window.electronAPI
    if (!api?.isElectron || !api.checkForUpdates) {
      toast.error(t('settings.updateSupportOnlyDesktop'))
      return
    }

    setCheckingUpdate(true)
    try {
      // 每次点击都实时调用接口，拿服务端最新版本号
      const result = await api.checkForUpdates()
      if (!result.success) {
        toast.error(t('settings.checkUpdateFailed'))
        return
      }

      // update.version 是服务端 update.json 里的最新版本号（无论是否有更新都会返回）
      const serverLatest = result.data?.update?.version ?? result.data?.currentVersion ?? null
      setLatestVersion(serverLatest)

      if (result.data?.hasUpdate && result.data.update) {
        // 有更新：直接在左侧弹出更新面板（sidebar 位置）
        updateManager.applyAvailableUpdate(result.data.currentVersion, result.data.update, true, 'sidebar')
        return
      }

      toast.success(
        serverLatest
          ? t('settings.noUpdateWithVersion', { version: serverLatest })
          : t('settings.noUpdate'),
      )
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <>
      {/* 终端设置 */}
      {isElectron && window.electronAPI?.platform === 'darwin' && (
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
      {isElectron && <SdkToolsCard />}

      {/* 移动端连接 + 网页访问 */}
      <MobileConnectCard />

      {/* 客户端更新 */}
      {isElectron && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-muted-foreground">{t('settings.clientUpdate')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.currentVersion')} {appVersion || t('settings.versionUnknown')}
              </p>
              {latestVersion && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.latestVersion')} {latestVersion}
                </p>
              )}
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

      {/* 版本号 */}
      {appVersion && (
        <div className="mt-4 text-center text-xs text-muted-foreground">
          {t('settings.version')} {appVersion}
        </div>
      )}
    </>
  )
}
