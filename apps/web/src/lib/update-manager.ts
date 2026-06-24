export type UpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error'
export type UpdateNotificationPlacement = 'top-right' | 'sidebar'

export type UpdateCheckReason = 'startup' | 'socket-connected' | 'window-focus' | 'visibility-change' | 'online' | 'interval' | 'manual' | 'test'

export interface UpdateManagerState {
  visible: boolean
  notificationPlacement: UpdateNotificationPlacement
  status: UpdateStatus
  currentVersion: string
  update: UpdateInfo | null
  progress: UpdateDownloadProgress
  filePath: string | null
  error: string
  checking: boolean
  lastCheckedAt: number | null
}

interface ElectronUpdateAPI {
  isElectron?: boolean
  checkForUpdates?: ElectronAPI['checkForUpdates']
}

interface CreateUpdateManagerOptions {
  getElectronAPI?: () => ElectronUpdateAPI | undefined
  now?: () => number
  runtimeCheckIntervalMs?: number
}

interface CheckForUpdatesOptions {
  force?: boolean
  silent?: boolean
  reason: UpdateCheckReason
}

const initialState: UpdateManagerState = {
  visible: false,
  notificationPlacement: 'top-right',
  status: 'idle',
  currentVersion: '',
  update: null,
  progress: { percent: 0, transferred: 0, total: null },
  filePath: null,
  error: '',
  checking: false,
  lastCheckedAt: null,
}

function normalizeDownloadProgress(
  progress: UpdateDownloadProgress,
  previous: UpdateDownloadProgress,
): UpdateDownloadProgress {
  if (
    progress.percent === 100 &&
    progress.transferred === 1 &&
    progress.total === 1 &&
    previous.transferred > 1
  ) {
    return { ...previous, percent: 100 }
  }

  const transferred = Number.isFinite(progress.transferred)
    ? Math.max(0, Math.floor(progress.transferred))
    : 0
  const parsedTotal = progress.total !== null && Number.isFinite(progress.total)
    ? Math.max(0, Math.floor(progress.total))
    : null
  const total = parsedTotal && parsedTotal > 0 ? Math.max(parsedTotal, transferred) : null
  const rawPercent = total
    ? (transferred / total) * 100
    : Number.isFinite(progress.percent)
      ? progress.percent
      : 0
  const percent = Math.min(100, Math.max(0, Math.round(rawPercent)))

  return { percent, transferred, total }
}

export function createUpdateManager(options: CreateUpdateManagerOptions = {}) {
  const getElectronAPI = options.getElectronAPI ?? (() => window.electronAPI)
  const now = options.now ?? (() => Date.now())
  const runtimeCheckIntervalMs = options.runtimeCheckIntervalMs ?? 30 * 60 * 1000
  const listeners = new Set<() => void>()
  let state: UpdateManagerState = { ...initialState }
  let inFlight: Promise<unknown> | null = null

  const emit = () => {
    listeners.forEach((listener) => listener())
  }

  const setState = (next: Partial<UpdateManagerState>) => {
    state = { ...state, ...next }
    emit()
  }

  const applyAvailableUpdate = (
    currentVersion: string,
    update: UpdateInfo,
    visible = false,
    notificationPlacement: UpdateNotificationPlacement = 'top-right',
  ) => {
    setState({
      visible,
      notificationPlacement,
      status: 'available',
      currentVersion,
      update,
      progress: { percent: 0, transferred: 0, total: null },
      filePath: null,
      error: '',
    })
  }

  const checkForUpdates = async ({ force = false, silent = true, reason: _reason }: CheckForUpdatesOptions) => {
    const api = getElectronAPI()
    if (!api?.isElectron || !api.checkForUpdates) return null

    const checkedAt = now()
    if (!force && state.lastCheckedAt !== null && checkedAt - state.lastCheckedAt < runtimeCheckIntervalMs) {
      return null
    }

    if (inFlight) return inFlight

    setState({ checking: true, lastCheckedAt: checkedAt })

    inFlight = api.checkForUpdates()
      .then((result) => {
        if (result.success && result.data?.hasUpdate && result.data.update) {
          applyAvailableUpdate(result.data.currentVersion, result.data.update)
          return result.data
        }

        if (result.success && result.data?.noUrlConfigured) {
          if (!silent) {
            setState({
              visible: true,
              status: 'error',
              update: null,
              currentVersion: result.data.currentVersion,
              error: '未配置更新检查地址，请联系管理员',
            })
          }
          return result.data
        }

        if (!result.success && result.error && !silent) {
          setState({
            visible: true,
            status: 'error',
            update: null,
            error: `更新信息查询异常：${result.error}`,
          })
        }

        if (result.success && !result.data?.hasUpdate && state.status === 'idle') {
          setState({ currentVersion: result.data?.currentVersion ?? state.currentVersion })
        }

        return result.data ?? null
      })
      .catch((err: unknown) => {
        if (!silent) {
          const msg = err instanceof Error ? err.message : String(err)
          setState({
            status: 'error',
            update: null,
            error: `更新信息查询异常：${msg}`,
          })
        }
        return null
      })
      .finally(() => {
        inFlight = null
        setState({ checking: false })
      })

    return inFlight
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return state
    },
    checkForUpdates,
    openNotification(notificationPlacement: UpdateNotificationPlacement = 'sidebar') {
      if (state.update) {
        setState({ visible: true, error: '', notificationPlacement })
      }
    },
    closeNotification() {
      setState({ visible: false })
    },
    setDownloadProgress(progress: UpdateDownloadProgress) {
      setState({ progress: normalizeDownloadProgress(progress, state.progress) })
    },
    setStatus(status: UpdateStatus) {
      setState({ status })
    },
    setDownloaded(filePath: string) {
      setState({ filePath, status: 'downloaded' })
    },
    setError(error: string) {
      setState({ error, status: 'error', visible: true })
    },
    resetDownload() {
      setState({
        progress: { percent: 0, transferred: 0, total: null },
        filePath: null,
        error: '',
      })
    },
    applyAvailableUpdate,
  }
}

export const updateManager = createUpdateManager()
