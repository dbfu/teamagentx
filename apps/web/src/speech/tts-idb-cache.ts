export const DB_NAME = 'teamagentx-tts'
export const DB_VERSION = 1
export const STORE_NAME = 'audio'
export const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000
export const CLEAN_INTERVAL_MS = 60 * 60 * 1000

export type IdbCacheEntry = {
  cacheKey: string
  blob: Blob
  mimeType: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('by_room', 'chatRoomId', { unique: false })
        store.createIndex('by_expiry', 'cachedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
    req.onblocked = () => {
      dbPromise = null
      reject(new Error('IDB 升级被阻塞，请关闭其他标签页后刷新'))
    }
  })
  return dbPromise
}

async function isStorageNearFull(): Promise<boolean> {
  try {
    if (!navigator?.storage?.estimate) return false
    const { usage, quota } = await navigator.storage.estimate()
    if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) return false
    return usage / quota > 0.9
  } catch (err) {
    console.warn('[tts-idb-cache] storage estimate 失败:', err)
    return false
  }
}

export async function writeIdbEntry(
  chatRoomId: string,
  cacheKey: string,
  audio: { blob: Blob; mimeType: string },
): Promise<void> {
  try {
    if (await isStorageNearFull()) {
      console.warn('[tts-idb-cache] 存储配额接近上限，跳过写入')
      return
    }
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put({
        id: `${chatRoomId}||${cacheKey}`,
        chatRoomId,
        cacheKey,
        blob: audio.blob,
        mimeType: audio.mimeType,
        cachedAt: Date.now(),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[tts-idb-cache] 写入失败:', err)
  }
}

export async function loadRoomIdbEntries(chatRoomId: string): Promise<IdbCacheEntry[]> {
  try {
    const db = await openDb()
    const entries: IdbCacheEntry[] = []
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).index('by_room').openCursor(IDBKeyRange.only(chatRoomId))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) { resolve(); return }
        entries.push({ cacheKey: cursor.value.cacheKey, blob: cursor.value.blob, mimeType: cursor.value.mimeType })
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
    return entries
  } catch (err) {
    console.warn('[tts-idb-cache] 读取房间缓存失败:', err)
    return []
  }
}

export async function deleteIdbEntry(chatRoomId: string, cacheKey: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(`${chatRoomId}||${cacheKey}`)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('[tts-idb-cache] 删除失败:', err)
  }
}

let lastCleanedAt = 0

export function __resetCleanStateForTests(): void {
  lastCleanedAt = 0
}

export async function deleteExpiredIdbEntries(): Promise<void> {
  const now = Date.now()
  if (now - lastCleanedAt < CLEAN_INTERVAL_MS) return
  try {
    const db = await openDb()
    const cutoff = Date.now() - EXPIRY_MS
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const req = tx.objectStore(STORE_NAME).index('by_expiry').openCursor(IDBKeyRange.upperBound(cutoff))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) { resolve(); return }
        cursor.delete()
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
    lastCleanedAt = now
  } catch (err) {
    console.warn('[tts-idb-cache] 清理过期缓存失败:', err)
  }
}
