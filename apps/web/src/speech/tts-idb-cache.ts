const DB_NAME = 'teamagentx-tts'
const DB_VERSION = 1
const STORE_NAME = 'audio'
const EXPIRY_MS = 3 * 24 * 60 * 60 * 1000

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
  })
  return dbPromise
}

export async function writeIdbEntry(
  chatRoomId: string,
  cacheKey: string,
  audio: { blob: Blob; mimeType: string },
): Promise<void> {
  try {
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
  } catch {
    // IDB 写入失败不影响播放
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
  } catch {
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
  } catch {
    // 删除失败不阻塞
  }
}

let expiredCleaned = false

export async function deleteExpiredIdbEntries(): Promise<void> {
  if (expiredCleaned) return
  expiredCleaned = true
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
  } catch {
    // 过期清理失败不阻塞
  }
}
