const MIN_CHUNK_CHARS = 15

export function extractNewChunks(
  text: string,
  fromPosition: number,
): { chunks: string[]; newPosition: number } {
  const chunks: string[] = []
  let pos = fromPosition

  while (pos + MIN_CHUNK_CHARS < text.length) {
    // Search for sentence boundary starting at least MIN_CHUNK_CHARS from current pos
    let boundaryEnd = -1
    for (let i = pos + MIN_CHUNK_CHARS; i < text.length; i++) {
      const ch = text[i]
      if ('。！？!?'.includes(ch)) {
        boundaryEnd = i + 1
        break
      }
      if (ch === '.' && (i + 1 >= text.length || !/\d/.test(text[i + 1]))) {
        boundaryEnd = i + 1
        break
      }
      if (ch === '\n' && i + 1 < text.length && text[i + 1] === '\n') {
        boundaryEnd = i + 2
        break
      }
    }
    if (boundaryEnd === -1) break

    const chunk = text.slice(pos, boundaryEnd).trim()
    if (chunk) chunks.push(chunk)
    pos = boundaryEnd
  }

  return { chunks, newPosition: pos }
}

export type FetchAudioFn = (text: string) => Promise<{ blob: Blob; mimeType: string }>

export class StreamingTtsSession {
  private queue: Array<{ promise: Promise<{ blob: Blob; mimeType: string }> }> = []
  private isProcessing = false
  stopped = false
  private currentAudio: HTMLAudioElement | null = null

  add(text: string, fetchAudio: FetchAudioFn): void {
    if (this.stopped) return
    this.queue.push({ promise: fetchAudio(text) })
    if (!this.isProcessing) void this.process()
  }

  stop(): void {
    this.stopped = true
    this.queue = []
    if (this.currentAudio) {
      try {
        this.currentAudio.pause()
        this.currentAudio.src = ''
        this.currentAudio.load()
      } catch { /* ignore */ }
      this.currentAudio = null
    }
  }

  private async process(): Promise<void> {
    this.isProcessing = true
    while (this.queue.length > 0 && !this.stopped) {
      const item = this.queue.shift()!
      try {
        const { blob, mimeType } = await item.promise
        if (this.stopped) break
        await this.playBlob(blob, mimeType)
      } catch { /* skip failed chunk */ }
    }
    this.isProcessing = false
  }

  private playBlob(blob: Blob, _mimeType: string): Promise<void> {
    const url = URL.createObjectURL(blob)
    return new Promise<void>((resolve) => {
      const audio = new Audio(url)
      this.currentAudio = audio
      let done = false
      const finish = () => {
        if (done) return
        done = true
        this.currentAudio = null
        try {
          audio.pause()
          audio.src = ''
          audio.load()
        } catch { /* ignore */ }
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onended = finish
      audio.onerror = finish
      audio.play().catch(finish)
    })
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
    const session = this.sessions.get(sessionKey)
    if (session) {
      session.stop()
      this.sessions.delete(sessionKey)
    }
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.stop()
    }
    this.sessions.clear()
  }
}

export const streamingTtsManager = new StreamingTtsManager()
