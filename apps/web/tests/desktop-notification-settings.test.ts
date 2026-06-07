import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  getDesktopNotificationWelcomeAt,
  getDesktopNotificationSettingsUrl,
  getDesktopNotificationStatus,
  markDesktopNotificationWelcomed,
  shouldShowDesktopNotificationControls,
} from '../src/lib/desktop-notification-settings.ts'

describe('desktop notification settings', () => {
  it('returns deep links for supported desktop platforms', () => {
    assert.equal(
      getDesktopNotificationSettingsUrl('win32'),
      'ms-settings:notifications',
    )
    assert.equal(
      getDesktopNotificationSettingsUrl('darwin'),
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
    )
    assert.equal(getDesktopNotificationSettingsUrl('linux'), null)
  })

  it('describes desktop notification status for electron platforms', () => {
    assert.deepEqual(
      getDesktopNotificationStatus({ isElectron: true, platform: 'win32' }),
      {
        tone: 'info',
        title: '受 Windows 控制',
        description: '首次启动会自动发送一条欢迎通知；若未收到提醒，请在系统设置里开启通知、横幅和通知中心。',
      },
    )

    assert.deepEqual(
      getDesktopNotificationStatus({ isElectron: true, platform: 'darwin' }),
      {
        tone: 'info',
        title: '受 macOS 控制',
        description: '首次启动会自动发送一条欢迎通知；若未收到提醒，请在系统设置的“通知”中允许 TeamAgentX，并开启横幅样式。',
      },
    )
  })

  it('falls back to browser notification status outside electron', () => {
    assert.deepEqual(
      getDesktopNotificationStatus({ isElectron: false, permission: 'granted' }),
      {
        tone: 'success',
        title: '浏览器通知已允许',
        description: '当前环境会优先使用浏览器通知权限，不受桌面客户端系统设置控制。',
      },
    )

    assert.equal(shouldShowDesktopNotificationControls(true), true)
    assert.equal(shouldShowDesktopNotificationControls(false), false)
  })

  it('prefers electron persistence for welcome notification state', async () => {
    const previousWindow = globalThis.window
    let savedValue: number | null = 123

    globalThis.window = {
      electronAPI: {
        isElectron: true,
        getNotificationOnboardingState: async () => ({
          success: true,
          data: { welcomeNotificationSentAt: savedValue },
        }),
        setNotificationOnboardingState: async (input: { welcomeNotificationSentAt: number }) => {
          savedValue = input.welcomeNotificationSentAt
          return { success: true }
        },
      },
    } as unknown as typeof window

    try {
      assert.equal(await getDesktopNotificationWelcomeAt(), 123)
      await markDesktopNotificationWelcomed(456)
      assert.equal(savedValue, 456)
    } finally {
      globalThis.window = previousWindow
    }
  })
})
