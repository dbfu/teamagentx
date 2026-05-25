import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldRenderUncategorizedSection } from '../src/components/chat/assistant-page-dnd.ts'

test('dragging the only uncategorized assistant should keep the uncategorized drop zone mounted', () => {
  assert.equal(shouldRenderUncategorizedSection(0, null), true)
})

test('uncategorized section should stay hidden when empty and no uncategorized assistant is being dragged', () => {
  assert.equal(shouldRenderUncategorizedSection(0, 'category-1'), false)
  assert.equal(shouldRenderUncategorizedSection(0, undefined), false)
})

test('uncategorized section should render when it still has visible assistants', () => {
  assert.equal(shouldRenderUncategorizedSection(2, 'category-1'), true)
})
