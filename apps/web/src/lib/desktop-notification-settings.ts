export type DesktopPlatform = 'darwin' | 'win32' | 'linux'
export type DesktopNotificationTone = 'info' | 'success' | 'warning'
const DESKTOP_NOTIFICATION_WELCOME_KEY = 'teamagentx.desktopNotificationWelcome'

export interface DesktopNotificationStatusInput {
  isElectron: boolean
  platform?: DesktopPlatform
  permission?: NotificationPermission
}

export interface DesktopNotificationStatus {
  tone: DesktopNotificationTone
  title: string
  description: string
}

type NotificationOnboardingElectronApi = {
  isElectron?: boolean
  getNotificationOnboardingState?: () => Promise<{ success: boolean; data?: { welcomeNotificationSentAt: number | null } }>
  setNotificationOnboardingState?: (input: { welcomeNotificationSentAt: number | null }) => Promise<{ success: boolean }>
}

function getElectronNotificationApi(): NotificationOnboardingElectronApi | null {
  if (typeof window === 'undefined') return null
  return ((window as typeof window & { electronAPI?: NotificationOnboardingElectronApi }).electronAPI ?? null)
}

function readStoredTimestamp(key: string): number | null {
  if (typeof localStorage === 'undefined') return null
  const rawValue = localStorage.getItem(key)
  if (!rawValue) return null
  const parsedValue = Number(rawValue)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null
}

function writeStoredTimestamp(key: string, value: number) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, String(value))
}

export async function getDesktopNotificationWelcomeAt(): Promise<number | null> {
  const electronApi = getElectronNotificationApi()
  if (electronApi?.isElectron && electronApi.getNotificationOnboardingState) {
    const result = await electronApi.getNotificationOnboardingState()
    if (result.success) {
      return result.data?.welcomeNotificationSentAt ?? null
    }
  }

  return readStoredTimestamp(DESKTOP_NOTIFICATION_WELCOME_KEY)
}

export async function markDesktopNotificationWelcomed(now = Date.now()) {
  const electronApi = getElectronNotificationApi()
  if (electronApi?.isElectron && electronApi.setNotificationOnboardingState) {
    const result = await electronApi.setNotificationOnboardingState({ welcomeNotificationSentAt: now })
    if (result.success) {
      return
    }
  }

  writeStoredTimestamp(DESKTOP_NOTIFICATION_WELCOME_KEY, now)
}

export function getDesktopNotificationSettingsUrl(platform: DesktopPlatform): string | null {
  if (platform === 'win32') {
    return 'ms-settings:notifications'
  }

  if (platform === 'darwin') {
    return 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
  }

  return null
}

export function shouldShowDesktopNotificationControls(isElectron: boolean): boolean {
  return isElectron
}

export function getDesktopNotificationStatus(input: DesktopNotificationStatusInput): DesktopNotificationStatus {
  if (input.isElectron) {
    if (input.platform === 'win32') {
      return {
        tone: 'info',
        title: '受 Windows 控制',
        description: '首次启动会自动发送一条欢迎通知；若未收到提醒，请在系统设置里开启通知、横幅和通知中心。',
      }
    }

    if (input.platform === 'darwin') {
      return {
        tone: 'info',
        title: '受 macOS 控制',
        description: '首次启动会自动发送一条欢迎通知；若未收到提醒，请在系统设置的“通知”中允许 TeamAgentX，并开启横幅样式。',
      }
    }

    return {
      tone: 'warning',
      title: '当前平台通知能力有限',
      description: '系统通知是否显示取决于桌面环境，建议先发送测试通知确认效果。',
    }
  }

  if (input.permission === 'granted') {
    return {
      tone: 'success',
      title: '浏览器通知已允许',
      description: '当前环境会优先使用浏览器通知权限，不受桌面客户端系统设置控制。',
    }
  }

  if (input.permission === 'denied') {
    return {
      tone: 'warning',
      title: '浏览器通知已关闭',
      description: '请在浏览器站点权限中重新允许通知，之后再回来发送测试通知。',
    }
  }

  return {
    tone: 'info',
    title: '浏览器通知尚未授权',
    description: '当浏览器请求通知权限时，请选择允许，之后才能正常收到系统通知。',
  }
}
