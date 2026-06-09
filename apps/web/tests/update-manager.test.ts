import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { createUpdateManager } from '../src/lib/update-manager.ts'

describe('update manager', () => {
  test('stores available updates and notifies subscribers', async () => {
    let calls = 0
    const manager = createUpdateManager({
      getElectronAPI: () => ({
        isElectron: true,
        checkForUpdates: async () => ({
          success: true,
          data: {
            hasUpdate: true,
            currentVersion: '1.0.0',
            update: { version: '1.1.0', url: 'https://example.com/app.dmg' },
          },
        }),
      }),
      now: () => 1000,
    })

    const unsubscribe = manager.subscribe(() => {
      calls += 1
    })

    await manager.checkForUpdates({ force: true, silent: true, reason: 'test' })

    const state = manager.getSnapshot()
    assert.equal(state.visible, false)
    assert.equal(state.status, 'available')
    assert.equal(state.currentVersion, '1.0.0')
    assert.equal(state.update?.version, '1.1.0')
    assert.ok(calls > 0)

    manager.openNotification()
    assert.equal(manager.getSnapshot().visible, true)

    unsubscribe()
  })

  test('throttles runtime checks but allows forced checks', async () => {
    let calls = 0
    let now = 1000
    const manager = createUpdateManager({
      getElectronAPI: () => ({
        isElectron: true,
        checkForUpdates: async () => {
          calls += 1
          return {
            success: true,
            data: { hasUpdate: false, currentVersion: '1.0.0', update: null },
          }
        },
      }),
      now: () => now,
      runtimeCheckIntervalMs: 60_000,
    })

    await manager.checkForUpdates({ silent: true, reason: 'startup' })
    await manager.checkForUpdates({ silent: true, reason: 'focus' })
    assert.equal(calls, 1)

    now += 60_001
    await manager.checkForUpdates({ silent: true, reason: 'focus' })
    assert.equal(calls, 2)

    await manager.checkForUpdates({ force: true, silent: true, reason: 'manual' })
    assert.equal(calls, 3)
  })

  test('normalizes download progress and preserves real bytes after legacy completion event', () => {
    const manager = createUpdateManager()

    manager.setDownloadProgress({ percent: 120.4, transferred: 1200.8, total: 1000 })
    assert.deepEqual(manager.getSnapshot().progress, {
      percent: 100,
      transferred: 1200,
      total: 1200,
    })

    manager.setDownloadProgress({ percent: 100, transferred: 1, total: 1 })
    assert.deepEqual(manager.getSnapshot().progress, {
      percent: 100,
      transferred: 1200,
      total: 1200,
    })

    manager.setDownloadProgress({ percent: Number.NaN, transferred: 2048, total: null })
    assert.deepEqual(manager.getSnapshot().progress, {
      percent: 0,
      transferred: 2048,
      total: null,
    })
  })
})
