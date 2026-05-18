export const PREWARM_MAX_TEXT_LENGTH = 500
const CACHE_CAPACITY = 20

export type CachedAudio = { blob: Blob; mimeType: string }

class TtsPrefetchCache {
  private readonly map = new Map<string, { promise: Promise<CachedAudio>; accessedAt: number }>()

  constructor(private readonly capacity = CACHE_CAPACITY) {}

  get(key: string): Promise<CachedAudio> | null {
    const entry = this.map.get(key)
    if (!entry) return null
    entry.accessedAt = Date.now()
    return entry.promise
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  set(key: string, promise: Promise<CachedAudio>): void {
    if (this.map.size >= this.capacity) this.evictLRU()
    this.map.set(key, { promise, accessedAt: Date.now() })
    promise.catch(() => { this.map.delete(key) })
  }

  private evictLRU(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity
    for (const [k, v] of this.map) {
      if (v.accessedAt < oldestTime) {
        oldestTime = v.accessedAt
        oldestKey = k
      }
    }
    if (oldestKey !== undefined) this.map.delete(oldestKey)
  }
}

class RoomTtsPrefetchCacheManager {
  private readonly rooms = new Map<string, TtsPrefetchCache>()

  forRoom(chatRoomId: string): TtsPrefetchCache {
    let cache = this.rooms.get(chatRoomId)
    if (!cache) {
      cache = new TtsPrefetchCache()
      this.rooms.set(chatRoomId, cache)
    }
    return cache
  }

  deleteRoom(chatRoomId: string): void {
    this.rooms.delete(chatRoomId)
  }
}

export const roomTtsPrefetchCache = new RoomTtsPrefetchCacheManager()

export function buildTtsCacheKey(opts: {
  provider: string
  model: string | null | undefined
  voice: string | null | undefined
  speed: number | null | undefined
  format: string | null | undefined
  vendorOptions?: Record<string, unknown> | null
  text: string
}): string {
  const voKey = opts.vendorOptions ? JSON.stringify(opts.vendorOptions) : ''
  return `${opts.provider}|${opts.model ?? ''}|${opts.voice ?? ''}|${opts.speed ?? ''}|${opts.format ?? ''}|${voKey}|${opts.text}`
}
