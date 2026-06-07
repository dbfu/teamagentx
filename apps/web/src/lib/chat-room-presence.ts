export interface ChatRoomPresenceSnapshot {
  isSelected: boolean
  isDocumentVisible: boolean
  hasWindowFocus: boolean
}

export function isActivelyViewingChatRoom(snapshot: ChatRoomPresenceSnapshot): boolean {
  return snapshot.isSelected && snapshot.isDocumentVisible && snapshot.hasWindowFocus
}

export function getVisibleChatRoomId(pathname: string, selectedRoomId: string | null): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)$/)
  if (match) {
    return decodeURIComponent(match[1])
  }

  if (pathname === '/') {
    return selectedRoomId
  }

  return null
}
