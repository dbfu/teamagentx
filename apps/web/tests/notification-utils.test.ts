import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyUnreadUpdate,
  buildMessagePreview,
  getChatRoomNotificationUrl,
  getTotalUnreadCount,
} from '../src/lib/notification-utils.ts'

describe('notification utils', () => {
  it('replaces unread counts from a bulk update and totals valid counts', () => {
    const counts = applyUnreadUpdate({}, { unreadCounts: { roomA: 2, roomB: 3 } }, null)

    assert.deepEqual(counts, { roomA: 2, roomB: 3 })
    assert.equal(getTotalUnreadCount(counts), 5)
  })

  it('keeps the selected room unread count at zero', () => {
    const counts = applyUnreadUpdate({ roomA: 4 }, { chatRoomId: 'roomA', count: 8 }, 'roomA')

    assert.deepEqual(counts, { roomA: 0 })
  })

  it('ignores invalid unread counts', () => {
    const counts = applyUnreadUpdate({ roomA: 4 }, { chatRoomId: 'roomA', count: -1 }, null)

    assert.deepEqual(counts, { roomA: 4 })
  })

  it('uses an image placeholder when the message only contains image attachments', () => {
    assert.equal(
      buildMessagePreview('', [{ mimeType: 'image/png' }]),
      '[图片]',
    )
  })

  it('builds a room deep link for notification clicks', () => {
    assert.equal(
      getChatRoomNotificationUrl('http://localhost:5173/settings?tab=profile', 'room 1'),
      'http://localhost:5173/?room=room+1',
    )
  })
})
