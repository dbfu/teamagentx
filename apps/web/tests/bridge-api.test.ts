import test from 'node:test'
import assert from 'node:assert/strict'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
const originalLocalStorage = globalThis.localStorage

function installBrowserMocks() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        protocol: 'http:',
        hostname: 'localhost',
        origin: 'http://localhost:5173',
      },
    },
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    },
  })
}

test.beforeEach(() => {
  installBrowserMocks()
})

test.afterEach(() => {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  })
})

test('bridgeApi.deleteBot throws when backend delete fails', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'delete failed' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })

  const { bridgeApi } = await import('../src/lib/bridge-api.ts')

  await assert.rejects(
    () => bridgeApi.deleteBot('bot-1'),
    /delete failed/,
  )
})

test('bridgeApi.listBots rejects instead of silently returning an empty list on request failure', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down')
  }

  const { bridgeApi } = await import('../src/lib/bridge-api.ts')

  await assert.rejects(
    () => bridgeApi.listBots('telegram'),
    /network down/,
  )
})
