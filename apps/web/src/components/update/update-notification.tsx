import { CheckCircle2, Download, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'
import { updateManager } from '@/lib/update-manager'

function formatBytes(bytes: number) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function UpdateNotification() {
  const { visible, status, currentVersion, update, progress, filePath, error } = useSyncExternalStore(
    updateManager.subscribe,
    updateManager.getSnapshot,
    updateManager.getSnapshot,
  )

  useEffect(() => {
    const handleUpdateFound = (event: Event) => {
      const detail = (event as CustomEvent<{ currentVersion: string; update: UpdateInfo }>).detail
      if (!detail?.update) return

      updateManager.applyAvailableUpdate(detail.currentVersion, detail.update, true)
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

    updateManager.checkForUpdates({ force: true, silent: false, reason: 'startup' })

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
        updateManager.setError(result.error || '下载失败，请检查网络后重试')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      updateManager.setError(`下载失败：${msg}`)
    }
  }

  const handleInstall = async () => {
    if (!window.electronAPI?.installUpdate) return

    updateManager.setStatus('installing')
    try {
      const result = await window.electronAPI.installUpdate(filePath || undefined)
      if (!result.success) {
        updateManager.setError(result.error || '启动安装失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      updateManager.setError(`启动安装失败：${msg}`)
    }
  }

  const handleShowInFolder = () => {
    if (filePath) {
      window.electronAPI?.showUpdateInFolder?.(filePath)
    }
  }

  if (!visible || !update) return null

  const progressLabel = progress.total
    ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}`
    : formatBytes(progress.transferred)

  return (
    <div className="fixed right-4 top-14 z-50 w-[340px] rounded-xl border border-border bg-card p-4 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">发现新版本 {update.version}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            当前版本 {currentVersion || '未知'}
          </div>
        </div>
        <button
          onClick={() => updateManager.closeNotification()}
          disabled={status === 'downloading' || status === 'installing'}
          className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-50"
          title="关闭"
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
            <span>正在下载安装包</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{progressLabel}</div>
        </div>
      )}

      {status === 'downloaded' && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-600">
          <CheckCircle2 className="size-4 shrink-0" />
          安装包已下载完成，可以立即安装
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
              稍后
            </button>
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
            >
              <Download className="size-4" />
              下载更新
            </button>
          </>
        )}
        {status === 'downloaded' && (
          <>
            <button
              onClick={handleShowInFolder}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              title="在文件管理器中显示安装包"
            >
              <FolderOpen className="size-4" />
              打开位置
            </button>
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
            >
              立即安装
            </button>
          </>
        )}
        {status === 'installing' && (
          <button disabled className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white opacity-80">
            <Loader2 className="size-4 animate-spin" />
            正在启动安装
          </button>
        )}
        {status === 'error' && (
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
          >
            <RefreshCw className="size-4" />
            重试
          </button>
        )}
      </div>
    </div>
  )
}
