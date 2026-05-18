const MIN_CHUNK_CHARS = 50
const PLAY_TIMEOUT_MS = 60_000
const MAX_QUEUE_LENGTH = 50

function findSentenceBoundary(text: string, start: number): number {
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if ('。！？!?'.includes(ch)) return i + 1
    if (ch === '.' && (i + 1 >= text.length || !/\d/.test(text[i + 1]))) return i + 1
    if (ch === '\n' && i + 1 < text.length && text[i + 1] === '\n') return i + 2
  }
  return -1
}

export { findSentenceBoundary }

export function extractNewChunks(
  text: string,
  fromPosition: number,
): { chunks: string[]; newPosition: number } {
  const chunks: string[] = []
  let pos = fromPosition

  while (pos + MIN_CHUNK_CHARS < text.length) {
    // 流式阶段只在自然句边界切块，避免把半句话突然播出来。
    const minBoundaryStart = pos + MIN_CHUNK_CHARS
    const boundaryEnd = findSentenceBoundary(text, minBoundaryStart)
    if (boundaryEnd === -1) break

    const chunk = text.slice(pos, boundaryEnd).trim()
    if (chunk) chunks.push(chunk)
    pos = boundaryEnd
  }

  return { chunks, newPosition: pos }
}

// fetchFn 返回流式 Response（对应 /speech/tts/stream 端点）
export type FetchStreamFn = (text: string) => Promise<Response>

// 用 MediaSource 播放一个流式 TTS Response
export function playStreamResponse(
  response: Response,
  onAbort: (abortFn: () => void) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const mediaSource = new MediaSource()
    const audio = new Audio()
    const blobUrl = URL.createObjectURL(mediaSource)
    audio.src = blobUrl
    let aborted = false
    let settled = false

    const cleanupPrimary = () => {
      try { audio.pause(); audio.src = ''; audio.load() } catch { /* ignore */ }
      try { URL.revokeObjectURL(blobUrl) } catch { /* ignore */ }
    }

    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      aborted = true
      cleanupPrimary()
      reject(new Error('音频播放超时'))
    }, PLAY_TIMEOUT_MS)

    const safeResolve = () => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      resolve()
    }
    const safeReject = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      reject(err)
    }

    onAbort(() => {
      aborted = true
      cleanupPrimary()
      safeResolve()
    })

    // MediaSource 不支持时降级：等全量 arrayBuffer 再播
    const fallbackBlob = async () => {
      // 先 cleanup 原 primary audio/blobUrl，避免泄漏
      cleanupPrimary()
      try {
        const ab = await response.arrayBuffer()
        if (aborted) { safeResolve(); return }
        const blob = new Blob([ab], { type: 'audio/mpeg' })
        const url = URL.createObjectURL(blob)
        const a2 = new Audio(url)
        const cleanupFallback = () => {
          try { a2.pause(); a2.src = ''; a2.load() } catch { /* ignore */ }
          try { URL.revokeObjectURL(url) } catch { /* ignore */ }
        }
        onAbort(() => { aborted = true; cleanupFallback(); safeResolve() })
        a2.onended = () => { cleanupFallback(); safeResolve() }
        a2.onerror = () => { cleanupFallback(); safeReject(new Error('音频播放错误')) }
        try {
          await a2.play()
        } catch (err) {
          cleanupFallback()
          safeReject(err instanceof Error ? err : new Error(String(err)))
        }
      } catch (err) {
        cleanupPrimary()
        safeReject(err instanceof Error ? err : new Error(String(err)))
      }
    }

    if (!('MediaSource' in window) || !MediaSource.isTypeSupported('audio/mpeg') || !response.body) {
      void fallbackBlob()
      return
    }

    mediaSource.addEventListener('sourceopen', async () => {
      let sourceBuffer: SourceBuffer
      try {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg')
      } catch {
        void fallbackBlob()
        return
      }

      const waitUpdate = () => new Promise<void>((r) => {
        if (!sourceBuffer.updating) { r(); return }
        sourceBuffer.addEventListener('updateend', () => r(), { once: true })
      })

      try {
        const reader = response.body!.getReader()
        let firstChunk = true
        while (!aborted) {
          const { done, value } = await reader.read()
          if (done || aborted) break
          await waitUpdate()
          if (aborted) break
          sourceBuffer.appendBuffer(value)
          if (firstChunk) {
            firstChunk = false
            audio.play().catch((err) => {
              cleanupPrimary()
              safeReject(err instanceof Error ? err : new Error(String(err)))
            })
          }
        }

        if (!aborted) {
          await waitUpdate()
          if (mediaSource.readyState === 'open') mediaSource.endOfStream()
          // 防御：若 audio 在监听器注册前已 ended，直接 resolve
          if (audio.ended) {
            cleanupPrimary()
            safeResolve()
            return
          }
          audio.addEventListener('ended', () => { cleanupPrimary(); safeResolve() }, { once: true })
          audio.addEventListener('error', () => { cleanupPrimary(); safeReject(new Error('音频播放错误')) }, { once: true })
        } else {
          cleanupPrimary()
          safeResolve()
        }
      } catch (err) {
        cleanupPrimary()
        safeReject(err instanceof Error ? err : new Error(String(err)))
      }
    }, { once: true })
  })
}

interface QueueItem {
  text: string
  fetchStream: FetchStreamFn
}

export class StreamingTtsSession {
  private queue: QueueItem[] = []
  private isProcessing = false
  stopped = false
  private abortCurrent: (() => void) | null = null
  private finished = false

  constructor(private readonly onFinish?: () => void) {}

  private notifyFinished(): void {
    if (this.finished) return
    this.finished = true
    this.onFinish?.()
  }

  // 入队后由 process() 在消费时才发起 fetchStream，避免一次性并发大量请求
  add(text: string, fetchStream: FetchStreamFn): void {
    if (this.stopped) return
    if (this.queue.length >= MAX_QUEUE_LENGTH) return
    this.queue.push({ text, fetchStream })
    if (!this.isProcessing) void this.process()
  }

  stop(): void {
    this.stopped = true
    this.queue = []
    this.abortCurrent?.()
    this.abortCurrent = null
    if (!this.isProcessing) {
      this.notifyFinished()
    }
  }

  private async process(): Promise<void> {
    this.isProcessing = true
    while (this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift()!
      try {
        const response = await item.fetchStream(item.text)
        if (this.stopped) break
        await playStreamResponse(response, (fn) => { this.abortCurrent = fn })
        this.abortCurrent = null
      } catch { /* skip failed chunk */ }
    }
    this.isProcessing = false
    if (this.stopped || this.queue.length === 0) {
      this.notifyFinished()
    }
  }
}

class StreamingTtsManager {
  private sessions = new Map<string, StreamingTtsSession>()

  get(sessionKey: string): StreamingTtsSession | undefined {
    return this.sessions.get(sessionKey)
  }

  getOrCreate(sessionKey: string, onFinish?: () => void): StreamingTtsSession {
    const existing = this.sessions.get(sessionKey)
    if (existing && !existing.stopped) return existing
    const session = new StreamingTtsSession(() => {
      this.sessions.delete(sessionKey)
      onFinish?.()
    })
    this.sessions.set(sessionKey, session)
    return session
  }

  stop(sessionKey: string): void {
    this.sessions.get(sessionKey)?.stop()
    this.sessions.delete(sessionKey)
  }

  stopAll(): void {
    for (const s of this.sessions.values()) s.stop()
    this.sessions.clear()
  }
}

export const streamingTtsManager = new StreamingTtsManager()
export { StreamingTtsManager }
