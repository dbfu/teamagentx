import test from 'node:test'
import assert from 'node:assert/strict'

import { isLargeInputContent } from '../src/components/chat/chat-input-collapse.ts'

test('short messages are not treated as large input content', () => {
  assert.equal(isLargeInputContent('简短消息'), false)
})

test('many lines are treated as large input content', () => {
  assert.equal(isLargeInputContent(Array.from({ length: 9 }, (_, index) => `第 ${index + 1} 行`).join('\n')), true)
})

test('very long text is treated as large input content', () => {
  assert.equal(isLargeInputContent('a'.repeat(501)), true)
})
