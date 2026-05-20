export interface ChatRoomPresenceSnapshot {
  isSelected: boolean
  isDocumentVisible: boolean
  hasWindowFocus: boolean
}

export function isActivelyViewingChatRoom(snapshot: ChatRoomPresenceSnapshot): boolean {
  return snapshot.isSelected && snapshot.isDocumentVisible && snapshot.hasWindowFocus
}
