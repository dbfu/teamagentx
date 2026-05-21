import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { CategoryToggleButton } from '../src/components/chat/category-toggle-button.tsx'

test('category toggle button keeps icons and label inside one clickable button', () => {
  const markup = renderToStaticMarkup(
    <CategoryToggleButton
      expanded
      label="产品助手"
      count={3}
      onClick={() => {}}
    />
  )

  assert.equal((markup.match(/<button/g) || []).length, 1)
  assert.match(markup, /<button[\s\S]*lucide-chevron-down/)
  assert.match(markup, /<button[\s\S]*lucide-folder-open/)
  assert.match(markup, /<button[\s\S]*产品助手/)
  assert.match(markup, /<button[\s\S]*\(3\)/)
})
