import test from 'node:test'
import assert from 'node:assert/strict'

import { filterGitBranches } from '../src/lib/git-branch.ts'

test('filters git branches by a case-insensitive query', () => {
  const branches = [
    { name: 'main', current: true },
    { name: 'feature/Search-Popup', current: false },
    { name: 'fix/workdir-refresh', current: false },
  ]

  assert.deepEqual(filterGitBranches(branches, 'search'), [
    { name: 'feature/Search-Popup', current: false },
  ])
})

test('returns every branch when the query is blank', () => {
  const branches = [
    { name: 'main', current: true },
    { name: 'develop-zy', current: false },
  ]

  assert.deepEqual(filterGitBranches(branches, '  '), branches)
})
