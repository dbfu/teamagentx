import { afterEach, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert'

// ============================================================================
// 简单的内存 IndexedDB mock
// ============================================================================

type StoredRow = {
  id: string
  chatRoomId: string
  cacheKey: string
  blob: Blob
  mimeType: string
  cachedAt: number
}

type MockStore = {
  rows: Map<string, StoredRow>
  failNext: boolean
}

function makeFakeIndexedDB(initialRows: StoredRow[] = []) {
  const store: MockStore = {
    rows: new Map(initialRows.map((r) => [r.id, r])),
    failNext: false,
  }

  function makeRequest<T>(executor: () => T): any {
    const req: any = { result: undefined, error: null, onsuccess: null, onerror: null }
    queueMicrotask(() => {
      try {
        req.result = executor()
        req.onsuccess?.({ target: req })
      } catch (err) {
        req.error = err
        req.onerror?.({ target: req })
      }
    })
    return req
  }

  function makeCursorRequest(matches: StoredRow[]): any {
    const req: any = { result: undefined, onsuccess: null, onerror: null }
    let i = 0
    const advance = () => {
      if (i >= matches.length) {
        req.result = null
        req.onsuccess?.({ target: req })
        return
      }
      const row = matches[i++]
      req.result = {
        value: row,
        continue: () => queueMicrotask(advance),
        delete: () => { store.rows.delete(row.id) },
      }
      req.onsuccess?.({ target: req })
    }
    queueMicrotask(advance)
    return req
  }

  const objectStore = {
    put: (row: StoredRow) => {
      if (store.failNext) {
        store.failNext = false
        throw new Error('mock put failure')
      }
      store.rows.set(row.id, row)
      return makeRequest(() => undefined)
    },
    delete: (id: string) => {
      store.rows.delete(id)
      return makeRequest(() => undefined)
    },
    index: (name: string) => ({
      openCursor: (range: any) => {
        if (store.failNext) {
          store.failNext = false
          const req: any = { result: null, error: new Error('mock cursor failure'), onsuccess: null, onerror: null }
          queueMicrotask(() => req.onerror?.({ target: req }))
          return req
        }
        const all = Array.from(store.rows.values())
        let filtered: StoredRow[]
        if (name === 'by_room') {
          filtered = all.filter((r) => r.chatRoomId === range.value)
        } else if (name === 'by_expiry') {
          filtered = all.filter((r) => r.cachedAt <= range.upper)
        } else {
          filtered = all
        }
        return makeCursorRequest(filtered)
      },
    }),
  }

  const transaction = () => {
    const tx: any = { oncomplete: null, onerror: null, error: null }
    tx.objectStore = () => objectStore
    queueMicrotask(() => {
      if (store.failNext) {
        store.failNext = false
        tx.error = new Error('mock tx failure')
        tx.onerror?.({ target: tx })
      } else {
        tx.oncomplete?.({ target: tx })
      }
    })
    return tx
  }

  const db: any = {
    transaction,
    objectStoreNames: { contains: () => true },
  }

  const indexedDB: any = {
    open: () => {
      const req: any = {
        result: db,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      }
      queueMicrotask(() => req.onsuccess?.({ target: req }))
      return req
    },
  }

  const IDBKeyRange: any = {
    only: (value: any) => ({ value }),
    upperBound: (upper: any) => ({ upper }),
  }

  return { indexedDB, IDBKeyRange, store }
}

// ============================================================================
// 全局 mock 安装
// ============================================================================

const originalIndexedDB = (globalThis as any).indexedDB
const originalIDBKeyRange = (globalThis as any).IDBKeyRange
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalWarn = console.warn

let warnCalls: unknown[][] = []

function setNavigator(nav: any) {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  })
}

function installMocks(opts: { initialRows?: StoredRow[]; storage?: { usage: number; quota: number } | null } = {}) {
  const { indexedDB, IDBKeyRange, store } = makeFakeIndexedDB(opts.initialRows)
  ;(globalThis as any).indexedDB = indexedDB
  ;(globalThis as any).IDBKeyRange = IDBKeyRange
  setNavigator({
    storage: opts.storage === null
      ? undefined
      : { estimate: async () => opts.storage ?? { usage: 0, quota: 1_000_000 } },
  })
  warnCalls = []
  console.warn = (...args: unknown[]) => { warnCalls.push(args) }
  return store
}

function restoreMocks() {
  ;(globalThis as any).indexedDB = originalIndexedDB
  ;(globalThis as any).IDBKeyRange = originalIDBKeyRange
  if (navigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  } else {
    delete (globalThis as any).navigator
  }
  console.warn = originalWarn
}

// 由于模块顶层有 dbPromise 缓存，每次测试都重新 import 一个新副本（带 cache-busting query）
async function freshImport() {
  const mod = await import(`../src/speech/tts-idb-cache.ts?t=${Date.now()}-${Math.random()}`)
  return mod as typeof import('../src/speech/tts-idb-cache.ts')
}

// ============================================================================
// 测试
// ============================================================================

describe('tts-idb-cache', () => {
  beforeEach(() => {
    installMocks()
  })

  afterEach(() => {
    restoreMocks()
  })

  test('writeIdbEntry: 正常写入', async () => {
    const store = installMocks()
    const mod = await freshImport()
    const blob = new Blob(['hi'], { type: 'audio/mpeg' })
    await mod.writeIdbEntry('room1', 'key1', { blob, mimeType: 'audio/mpeg' })
    assert.strictEqual(store.rows.size, 1)
    const row = store.rows.get('room1||key1')
    assert.ok(row)
    assert.strictEqual(row?.chatRoomId, 'room1')
    assert.strictEqual(row?.cacheKey, 'key1')
  })

  test('writeIdbEntry: storage > 90% 时跳过写入', async () => {
    const store = installMocks({ storage: { usage: 950, quota: 1000 } })
    const mod = await freshImport()
    const blob = new Blob(['x'], { type: 'audio/mpeg' })
    await mod.writeIdbEntry('room1', 'key1', { blob, mimeType: 'audio/mpeg' })
    assert.strictEqual(store.rows.size, 0)
    assert.ok(warnCalls.some((a) => String(a[0]).includes('存储配额')))
  })

  test('writeIdbEntry: estimate 不可用时仍能写入', async () => {
    const store = installMocks({ storage: null })
    const mod = await freshImport()
    const blob = new Blob(['x'], { type: 'audio/mpeg' })
    await mod.writeIdbEntry('room1', 'key1', { blob, mimeType: 'audio/mpeg' })
    assert.strictEqual(store.rows.size, 1)
  })

  test('writeIdbEntry: IDB 失败时只 warn 不 throw', async () => {
    const store = installMocks()
    store.failNext = true
    const mod = await freshImport()
    const blob = new Blob(['x'], { type: 'audio/mpeg' })
    await assert.doesNotReject(() =>
      mod.writeIdbEntry('room1', 'key1', { blob, mimeType: 'audio/mpeg' }),
    )
    assert.ok(warnCalls.some((a) => String(a[0]).includes('[tts-idb-cache]')))
  })

  test('loadRoomIdbEntries: 返回正确数据', async () => {
    const rows: StoredRow[] = [
      { id: 'r1||a', chatRoomId: 'r1', cacheKey: 'a', blob: new Blob(['a']), mimeType: 'audio/mpeg', cachedAt: 1 },
      { id: 'r1||b', chatRoomId: 'r1', cacheKey: 'b', blob: new Blob(['b']), mimeType: 'audio/mpeg', cachedAt: 2 },
      { id: 'r2||c', chatRoomId: 'r2', cacheKey: 'c', blob: new Blob(['c']), mimeType: 'audio/mpeg', cachedAt: 3 },
    ]
    installMocks({ initialRows: rows })
    const mod = await freshImport()
    const out = await mod.loadRoomIdbEntries('r1')
    assert.strictEqual(out.length, 2)
    assert.deepStrictEqual(out.map((e) => e.cacheKey).sort(), ['a', 'b'])
  })

  test('loadRoomIdbEntries: IDB 不可用时返回空数组', async () => {
    ;(globalThis as any).indexedDB = {
      open: () => {
        const req: any = { onsuccess: null, onerror: null, error: new Error('boom') }
        queueMicrotask(() => req.onerror?.({ target: req }))
        return req
      },
    }
    const mod = await freshImport()
    const out = await mod.loadRoomIdbEntries('r1')
    assert.deepStrictEqual(out, [])
    assert.ok(warnCalls.some((a) => String(a[0]).includes('[tts-idb-cache]')))
  })

  test('deleteIdbEntry: 正常删除', async () => {
    const rows: StoredRow[] = [
      { id: 'r1||a', chatRoomId: 'r1', cacheKey: 'a', blob: new Blob(['a']), mimeType: 'audio/mpeg', cachedAt: 1 },
    ]
    const store = installMocks({ initialRows: rows })
    const mod = await freshImport()
    await mod.deleteIdbEntry('r1', 'a')
    assert.strictEqual(store.rows.size, 0)
  })

  test('deleteExpiredIdbEntries: 清理 cachedAt 超过 3 天的条目', async () => {
    const now = Date.now()
    const expiry = 3 * 24 * 60 * 60 * 1000
    const rows: StoredRow[] = [
      { id: 'r1||old', chatRoomId: 'r1', cacheKey: 'old', blob: new Blob(['o']), mimeType: 'audio/mpeg', cachedAt: now - expiry - 1000 },
      { id: 'r1||new', chatRoomId: 'r1', cacheKey: 'new', blob: new Blob(['n']), mimeType: 'audio/mpeg', cachedAt: now },
    ]
    const store = installMocks({ initialRows: rows })
    const mod = await freshImport()
    await mod.deleteExpiredIdbEntries()
    assert.strictEqual(store.rows.size, 1)
    assert.ok(store.rows.has('r1||new'))
    assert.ok(!store.rows.has('r1||old'))
  })

  test('deleteExpiredIdbEntries: 时间间隔内不重复清理', async () => {
    const now = Date.now()
    const expiry = 3 * 24 * 60 * 60 * 1000
    const store = installMocks({
      initialRows: [
        { id: 'r1||old', chatRoomId: 'r1', cacheKey: 'old', blob: new Blob(['o']), mimeType: 'audio/mpeg', cachedAt: now - expiry - 1000 },
      ],
    })
    const mod = await freshImport()
    await mod.deleteExpiredIdbEntries()
    assert.strictEqual(store.rows.size, 0)

    // 再次塞入过期条目，应不被清理（因为间隔内）
    store.rows.set('r1||old2', {
      id: 'r1||old2', chatRoomId: 'r1', cacheKey: 'old2',
      blob: new Blob(['o']), mimeType: 'audio/mpeg', cachedAt: now - expiry - 2000,
    })
    await mod.deleteExpiredIdbEntries()
    assert.strictEqual(store.rows.size, 1, '间隔内不应再次清理')
  })

  test('deleteExpiredIdbEntries: 失败时不更新 lastCleanedAt，允许下次重试', async () => {
    const now = Date.now()
    const expiry = 3 * 24 * 60 * 60 * 1000
    const store = installMocks({
      initialRows: [
        { id: 'r1||old', chatRoomId: 'r1', cacheKey: 'old', blob: new Blob(['o']), mimeType: 'audio/mpeg', cachedAt: now - expiry - 1000 },
      ],
    })
    const mod = await freshImport()

    // 第一次：让事务失败
    store.failNext = true
    await mod.deleteExpiredIdbEntries()
    assert.strictEqual(store.rows.size, 1, '失败后数据应保留')
    assert.ok(warnCalls.some((a) => String(a[0]).includes('清理过期缓存失败')))

    // 第二次：正常，应该真的清理（因为 lastCleanedAt 未更新）
    await mod.deleteExpiredIdbEntries()
    assert.strictEqual(store.rows.size, 0, '重试应成功清理')
  })
})
