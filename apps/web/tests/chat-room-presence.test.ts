import { describe, test } from 'node:test'
import assert from 'node:assert'
import { isActivelyViewingChatRoom } from '../src/lib/chat-room-presence.ts'

describe('chat room presence helpers', () => {
  test('当前群可见且窗口聚焦时应视为正在查看', () => {
    assert.strictEqual(isActivelyViewingChatRoom({
      isSelected: true,
      isDocumentVisible: true,
      hasWindowFocus: true,
    }), true)
  })

  test('标签页隐藏时不应视为正在查看', () => {
    assert.strictEqual(isActivelyViewingChatRoom({
      isSelected: true,
      isDocumentVisible: false,
      hasWindowFocus: true,
    }), false)
  })

  test('窗口失焦时不应视为正在查看', () => {
    assert.strictEqual(isActivelyViewingChatRoom({
      isSelected: true,
      isDocumentVisible: true,
      hasWindowFocus: false,
    }), false)
  })

  test('未选中当前群时不应视为正在查看', () => {
    assert.strictEqual(isActivelyViewingChatRoom({
      isSelected: false,
      isDocumentVisible: true,
      hasWindowFocus: true,
    }), false)
  })
})
