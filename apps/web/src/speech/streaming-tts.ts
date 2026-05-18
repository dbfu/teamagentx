const MIN_CHUNK_CHARS = 50

export function extractNewChunks(
  text: string,
  fromPosition: number,
): { chunks: string[]; newPosition: number } {
  const chunks: string[] = []
  let pos = fromPosition

  while (pos + MIN_CHUNK_CHARS < text.length) {
    // 从 pos+MIN_CHUNK_CHARS 开始找句子边界，确保每块至少 MIN_CHUNK_CHARS 字
    let boundaryEnd = -1
    for (let i = pos + MIN_CHUNK_CHARS; i < text.length; i++) {
      const ch = text[i]
      if ('。！？!?'.includes(ch)) { boundaryEnd = i + 1; break }
      if (ch === '.' && (i + 1 >= text.length || !/\d/.test(text[i + 1]))) { boundaryEnd = i + 1; break }
      if (ch === '\n' && i + 1 < text.length && text[i + 1] === '\n') { boundaryEnd = i + 2; break }
    }
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
function playStreamResponse(
  response: Response,
  onAbort: (abortFn: () => void) => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const mediaSource = new MediaSource()
    const audio = new Audio()
    const blobUrl = URL.createObjectURL(mediaSource)
    audio.src = blobUrl
    let aborted = false

    const cleanup = () => {
      try { audio.pause(); audio.src = ''; audio.load() } catch { /* ignore */ }
      URL.revokeObjectURL(blobUrl)
    }

    onAbort(() => {
      aborted = true
      cleanup()
      resolve()
    })

    // MediaSource 不支持时降级：等全量 arrayBuffer 再播
    const fallbackBlob = async () => {
      try {
        const ab = await response.arrayBuffer()
        if (aborted) { cleanup(); resolve(); return }
        const blob = new Blob([ab], { type: 'audio/mpeg' })
        const url = URL.createObjectURL(blob)
        URL.revokeObjectURL(blobUrl)
        const a2 = new Audio(url)
        onAbort(() => { aborted = true; a2.pause(); a2.src = ''; URL.revokeObjectURL(url); resolve() })
        a2.onended = () => { URL.revokeObjectURL(url); resolve() }
        a2.onerror = () => { URL.revokeObjectURL(url); resolve() }
        void a2.play().catch(() => {})
      } catch { cleanup(); resolve() }
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
            void audio.play().catch(() => {})
          }
        }

        if (!aborted) {
          await waitUpdate()
          if (mediaSource.readyState === 'open') mediaSource.endOfStream()
          audio.addEventListener('ended', () => { cleanup(); resolve() }, { once: true })
          audio.addEventListener('error', () => { cleanup(); resolve() }, { once: true })
        } else {
          cleanup()
          resolve()
        }
      } catch {
        cleanup()
        resolve()
      }
    }, { once: true })
  })
}

export class StreamingTtsSession {
  private queue: Array<Promise<Response>> = []
  private isProcessing = false
  stopped = false
  private abortCurrent: (() => void) | null = null

  // text 立刻触发网络请求（并行预取），playback 在 process() 中串行消费
  add(text: string, fetchStream: FetchStreamFn): void {
    if (this.stopped) return
    this.queue.push(fetchStream(text))
    if (!this.isProcessing) void this.process()
  }

  stop(): void {
    this.stopped = true
    this.queue = []
    this.abortCurrent?.()
    this.abortCurrent = null
  }

  private async process(): Promise<void> {
    this.isProcessing = true
    while (this.queue.length > 0 && !this.stopped) {
      const responsePromise = this.queue.shift()!
      try {
        const response = await responsePromise
        if (this.stopped) break
        await playStreamResponse(response, (fn) => { this.abortCurrent = fn })
        this.abortCurrent = null
      } catch { /* skip failed chunk */ }
    }
    this.isProcessing = false
  }
}

class StreamingTtsManager {
  private sessions = new Map<string, StreamingTtsSession>()

  get(sessionKey: string): StreamingTtsSession | undefined {
    return this.sessions.get(sessionKey)
  }

  getOrCreate(sessionKey: string): StreamingTtsSession {
    const existing = this.sessions.get(sessionKey)
    if (existing && !existing.stopped) return existing
    const session = new StreamingTtsSession()
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
