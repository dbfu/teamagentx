import {
  buildMessagePreview,
  getChatRoomNotificationUrl,
  getTotalUnreadCount,
  type PreviewAttachment,
  type UnreadCounts,
} from './notification-utils'

type NavigatorWithBadge = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export interface MessageNotificationInput {
  title: string
  content?: string | null
  attachments?: PreviewAttachment[] | null
  chatRoomId?: string
  totalUnreadCount?: number
}

function getNavigatorWithBadge(): NavigatorWithBadge | null {
  return typeof navigator === 'undefined' ? null : navigator as NavigatorWithBadge
}

function postFlutterNotification(payload: Record<string, unknown>) {
  if (!window.FlutterChannel?.postMessage) return
  window.FlutterChannel.postMessage(JSON.stringify(payload))
}

function normalizeBadgeCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.trunc(count)
}

export async function syncAppBadge(count: number) {
  const badgeCount = normalizeBadgeCount(count)

  if (window.electronAPI?.setBadgeCount) {
    await window.electronAPI.setBadgeCount(badgeCount)
    return
  }

  postFlutterNotification({ type: 'notification:setBadgeCount', count: badgeCount })

  const badgeNavigator = getNavigatorWithBadge()
  try {
    if (badgeCount > 0 && badgeNavigator?.setAppBadge) {
      await badgeNavigator.setAppBadge(badgeCount)
    } else if (badgeCount === 0 && badgeNavigator?.clearAppBadge) {
      await badgeNavigator.clearAppBadge()
    }
  } catch (error) {
    console.debug('[notification] Failed to sync app badge:', error)
  }
}

export function getTotalUnreadForNotifications(counts: UnreadCounts): number {
  return getTotalUnreadCount(counts)
}

export async function showMessageNotification(input: MessageNotificationInput) {
  const body = buildMessagePreview(input.content, input.attachments) || '有新消息'
  const title = input.title || 'TeamAgentX'
  const badgeCount = normalizeBadgeCount(input.totalUnreadCount ?? 0)

  if (window.electronAPI?.showNotification) {
    await window.electronAPI.showNotification({ title, body, chatRoomId: input.chatRoomId })
    return
  }

  postFlutterNotification({
    type: 'notification:showMessage',
    title,
    body,
    chatRoomId: input.chatRoomId,
    count: badgeCount,
  })

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return
  }

  const notification = new Notification(title, { body, silent: true })
  notification.onclick = () => {
    if (!input.chatRoomId) return
    window.focus()
    window.location.assign(getChatRoomNotificationUrl(window.location.href, input.chatRoomId))
  }
}
