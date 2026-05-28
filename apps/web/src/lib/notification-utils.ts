export type UnreadCounts = Record<string, number>

export interface UnreadUpdatePayload {
  unreadCounts?: UnreadCounts
  chatRoomId?: string
  count?: number
}

export interface PreviewAttachment {
  mimeType?: string | null
}

export function isValidUnreadCount(count: unknown): count is number {
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
}

export function getTotalUnreadCount(counts: UnreadCounts): number {
  return Object.values(counts).reduce((sum, count) => {
    return isValidUnreadCount(count) ? sum + count : sum
  }, 0)
}

export function applyUnreadUpdate(
  current: UnreadCounts,
  update: UnreadUpdatePayload,
  selectedRoomId: string | null,
): UnreadCounts {
  if (update.unreadCounts) {
    const next: UnreadCounts = {}
    for (const [chatRoomId, count] of Object.entries(update.unreadCounts)) {
      if (isValidUnreadCount(count)) {
        next[chatRoomId] = chatRoomId === selectedRoomId ? 0 : count
      }
    }
    return next
  }

  if (update.chatRoomId && isValidUnreadCount(update.count)) {
    return {
      ...current,
      [update.chatRoomId]: update.chatRoomId === selectedRoomId ? 0 : update.count,
    }
  }

  return current
}

export function buildMessagePreview(
  content: string | null | undefined,
  attachments?: PreviewAttachment[] | null,
): string {
  const trimmed = content?.trim()
  if (trimmed) {
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed
  }

  const hasImage = attachments?.some((attachment) => attachment.mimeType?.startsWith('image/'))
  return hasImage ? '[图片]' : ''
}

export function getChatRoomNotificationUrl(currentUrl: string, chatRoomId: string): string {
  const url = new URL(currentUrl)
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', chatRoomId)
  return url.toString()
}
