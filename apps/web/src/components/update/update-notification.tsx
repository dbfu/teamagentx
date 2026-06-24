import { CheckCircle2, Download, Loader2, RefreshCw, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { updateManager } from '@/lib/update-manager'

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function UpdateNotification() {
  const { t } = useTranslation()
  const { visible, notificationPlacement, status, currentVersion, update, progress, filePath, error } = useSyncExternalStore(
    updateManager.subscribe,
    updateManager.getSnapshot,
    updateManager.getSnapshot,
  )

  useEffect(() => {
    const handleUpdateFound = (event: Event) => {
      const detail = (event as CustomEvent<{ currentVersion: string; update: UpdateInfo }>).detail
      if (!detail?.update) return

      updateManager.applyAvailableUpdate(detail.currentVersion, detail.update)
    }

    window.addEventListener('teamagentx-update-found', handleUpdateFound)
    return () => window.removeEventListener('teamagentx-update-found', handleUpdateFound)
  }, [])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.isElectron || !api.checkForUpdates) return

    const unsubscribe = api.onUpdateDownloadProgress?.((nextProgress) => {
      updateManager.setDownloadProgress(nextProgress)
    })

    // 启动自动检查仅点亮侧边栏更新入口，不自动弹出浮层。
    updateManager.checkForUpdates({ force: true, silent: true, reason: 'startup' })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const handleDownload = async () => {
    if (!update || !window.electronAPI?.downloadUpdate) return

    updateManager.setStatus('downloading')
    updateManager.resetDownload()

    try {
      const result = await window.electronAPI.downloadUpdate(update)
      if (result.success && result.filePath) {
        updateManager.setDownloaded(result.filePath)
      } else {
        updateManager.setError(t('settings.downloadFailedNetwork'))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      updateManager.setError(t('settings.downloadFailedWithMsg', { message: msg }))
    }
  }

  const handleInstall = async () => {
    if (!window.electronAPI?.installUpdate) return

    updateManager.setStatus('installing')
    try {
      const result = await window.electronAPI.installUpdate(filePath || undefined)
      if (!result.success) {
        updateManager.setError(t('settings.installFailedStart'))
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      updateManager.setError(t('settings.installFailedWithMsg', { message: msg }))
    }
  }

  if (!visible || !update) return null

  const hasKnownProgressTotal = progress.total !== null && progress.total > 0
  const progressLabel = progress.total
    ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
    : formatBytes(progress.transferred)

  return (
    <div
      className={notificationPlacement === 'sidebar'
        ? 'fixed bottom-[136px] left-[72px] z-50 w-[340px] rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/20'
        : 'fixed right-4 top-14 z-50 w-[340px] rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/20'}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{t('settings.updateAvailable')} {update.version}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('settings.currentVersion')} {currentVersion || t('settings.versionUnknown')}
          </div>
        </div>
        <button
          onClick={() => updateManager.closeNotification()}
          className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
          title={t('common.close')}
        >
          <X className="size-4" />
        </button>
      </div>

      {update.notes && (
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-muted-foreground">{update.notes}</p>
      )}

      {status === 'downloading' && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('settings.downloadingPackage')}</span>
            <span>{hasKnownProgressTotal ? `${progress.percent}%` : formatBytes(progress.transferred)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            {hasKnownProgressTotal ? (
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${progress.percent}%` }} />
            ) : (
              <div className="h-full w-full animate-pulse rounded-full bg-blue-500/60" />
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{progressLabel}</div>
        </div>
      )}

      {status === 'downloaded' && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-600">
          <CheckCircle2 className="size-4 shrink-0" />
          {t('settings.packageDownloaded')}
        </div>
      )}

      {status === 'installing' && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-600">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {t('settings.installingPleaseWait')}
        </div>
      )}

      {status === 'error' && (
        <div className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {status === 'available' && (
          <>
            <button
              onClick={() => updateManager.closeNotification()}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              {t('settings.later')}
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
            >
              <Download className="size-4" />
              {t('settings.downloadUpdate')}
            </button>
          </>
        )}
        {status === 'downloaded' && (
          <button
            onClick={handleInstall}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
          >
            {t('settings.updateNow')}
          </button>
        )}
        {status === 'installing' && (
          <button disabled className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white opacity-80">
            <Loader2 className="size-4 animate-spin" />
            {t('settings.startingInstall')}
          </button>
        )}
        {status === 'error' && (
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
          >
            <RefreshCw className="size-4" />
            {t('common.retry')}
          </button>
        )}
      </div>
    </div>
  )
}
