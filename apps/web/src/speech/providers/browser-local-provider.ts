import type { SpeechProvider } from '@/speech/providers/provider'
import type { SpeechArtifact, SpeechProfile, SpeechTask } from '@/speech/domain/types'

export interface BrowserSpeechVoiceOption {
  id: string
  name: string
  lang: string
  voiceURI: string
  default: boolean
}

interface SpeechRecognitionResultLike {
  0: {
    transcript: string
  }
  isFinal: boolean
  length: number
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>
  resultIndex: number
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string
}

interface BrowserSpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type BrowserSpeechRecognitionApi = new () => BrowserSpeechRecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionApi
    webkitSpeechRecognition?: BrowserSpeechRecognitionApi
  }
}

export interface BrowserSpeechRecognitionSession {
  stop: () => Promise<string>
  cancel: () => void
}

interface BrowserSpeechRecognitionTaskInput {
  mode: 'session-start'
  language?: string
}

function getSpeechRecognitionCtor(): BrowserSpeechRecognitionApi | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function pickVoice(profile?: SpeechProfile | null): SpeechSynthesisVoice | null {
  if (!supportsBrowserSpeechSynthesis()) return null

  const voices = window.speechSynthesis.getVoices()
  const voiceId = profile?.voice
  if (!voiceId) {
    return voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) || voices[0] || null
  }

  const normalizedVoiceId = voiceId.trim().toLowerCase()
  // 精确匹配优先，避免 "anna" 误命中 "Anna2"
  const exact = voices.find((voice) =>
    voice.voiceURI.toLowerCase() === normalizedVoiceId
    || voice.name.toLowerCase() === normalizedVoiceId,
  )
  if (exact) return exact

  const langExact = voices.find((voice) => voice.lang.toLowerCase() === normalizedVoiceId)
  if (langExact) return langExact

  const fuzzy = voices.find((voice) =>
    voice.name.toLowerCase().includes(normalizedVoiceId)
    || voice.voiceURI.toLowerCase().includes(normalizedVoiceId),
  )
  if (fuzzy) return fuzzy

  return voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) || voices[0] || null
}

function startBrowserRecognitionSession(language = 'zh-CN'): BrowserSpeechRecognitionSession | null {
  const SpeechRecognitionCtor = getSpeechRecognitionCtor()
  if (!SpeechRecognitionCtor) return null

  const recognition = new SpeechRecognitionCtor()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = language

  const finalChunks: string[] = []
  let resolved = false
  let resolveStop: ((value: string) => void) | null = null

  const finish = () => {
    if (resolved) return
    resolved = true
    resolveStop?.(finalChunks.join('').trim())
  }

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      const transcript = result[0]?.transcript?.trim()
      if (result.isFinal && transcript) {
        finalChunks.push(transcript)
      }
    }
  }

  recognition.onerror = () => {
    finish()
  }

  recognition.onend = () => {
    finish()
  }

  recognition.start()

  return {
    stop: () => {
      if (resolved) {
        return Promise.resolve(finalChunks.join('').trim())
      }

      return new Promise<string>((resolve) => {
        // 部分 Webkit 环境下 recognition.stop() 不会触发 onend，
        // 加 5 秒超时兜底，避免 Promise 永远 pending。
        const timeoutId = setTimeout(() => {
          if (resolved) return
          resolved = true
          resolve(finalChunks.join('').trim())
        }, 5000)
        resolveStop = (value) => {
          clearTimeout(timeoutId)
          resolve(value)
        }
        recognition.stop()
      })
    },
    cancel: () => {
      recognition.abort()
      finish()
    },
  }
}

export function supportsBrowserSpeechRecognition(): boolean {
  return !!getSpeechRecognitionCtor()
}

export function supportsBrowserSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

// 只有 stopBrowserSpeechSynthesis() 被显式调用时才为 true，
// 用于区分"外部主动停止"和"Chrome 偶发的 interrupted/canceled 噪音"。
let externalStopRequested = false

export function stopBrowserSpeechSynthesis(): void {
  if (!supportsBrowserSpeechSynthesis()) return
  externalStopRequested = true
  window.speechSynthesis.cancel()
}

export function getBrowserSpeechVoices(): BrowserSpeechVoiceOption[] {
  if (!supportsBrowserSpeechSynthesis()) return []

  return window.speechSynthesis.getVoices().map((voice) => ({
    id: voice.voiceURI || voice.name,
    name: voice.name,
    lang: voice.lang,
    voiceURI: voice.voiceURI,
    default: voice.default,
  }))
}

async function synthesizeWithBrowser(task: SpeechTask<{ text: string }>): Promise<SpeechArtifact> {
  if (!supportsBrowserSpeechSynthesis()) {
    throw new Error('当前环境不支持语音播报')
  }

  const text = task.input.text.trim()
  if (!text) {
    return {
      kind: 'audio',
      provider: 'browser-local',
      text: '',
    }
  }

  return new Promise<SpeechArtifact>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(task.profile)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = 'zh-CN'
    }

    utterance.rate = task.profile?.speed ?? 1.3
    utterance.volume = task.profile?.volume ?? 1
    if (typeof task.profile?.pitch === 'number') {
      utterance.pitch = task.profile.pitch
    }

    // Chrome 偶发 bug：onend 可能永远不触发。按字数估算最长等待时间作为兜底，
    // 至少 30 秒，每个字符约 100ms，超时则取消合成并视为正常完成，避免阻塞队列。
    const timeoutId = setTimeout(() => {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // ignore
      }
      // 兜底超时也需要消费 stop 标志，避免泄漏到下一次 speak
      externalStopRequested = false
      resolve({
        kind: 'audio',
        provider: 'browser-local',
        text,
        voice: task.profile?.voice ?? voice?.voiceURI ?? voice?.name ?? null,
        metadata: {
          runtime: 'client',
          timedOut: true,
        },
      })
    }, Math.max(30_000, text.length * 100))

    utterance.onend = () => {
      clearTimeout(timeoutId)
      // 正常结束也消费一次 stop 标志，避免泄漏给下一个 utterance
      externalStopRequested = false
      resolve({
        kind: 'audio',
        provider: 'browser-local',
        text,
        voice: task.profile?.voice ?? voice?.voiceURI ?? voice?.name ?? null,
        metadata: {
          runtime: 'client',
        },
      })
    }
    utterance.onerror = (event) => {
      clearTimeout(timeoutId)
      // 先读出再立即重置，保证并发/连续播放时每次 stop 标志只被消费一次
      const wasExternalStop = externalStopRequested
      externalStopRequested = false
      const errorCode = (event as SpeechSynthesisErrorEvent).error
      if (errorCode === 'interrupted' || errorCode === 'canceled') {
        // 仅当外部显式调用 stopBrowserSpeechSynthesis() 时才视为"外部中断"，
        // 否则 Chrome 偶发的 interrupted/canceled 是噪音，应视为正常结束。
        if (wasExternalStop) {
          reject(new Error('speech_interrupted'))
        } else {
          resolve({
            kind: 'audio',
            provider: 'browser-local',
            text,
            voice: task.profile?.voice ?? voice?.voiceURI ?? voice?.name ?? null,
            metadata: { runtime: 'client', interrupted: true },
          })
        }
        return
      }
      reject(new Error('语音播报失败'))
    }

    window.speechSynthesis.speak(utterance)
  })
}

async function transcribeWithBrowser(task: SpeechTask<BrowserSpeechRecognitionTaskInput>): Promise<SpeechArtifact> {
  if (task.input.mode !== 'session-start') {
    throw new Error('browser-local 仅支持会话式语音识别启动')
  }

  const session = startBrowserRecognitionSession(task.input.language ?? 'zh-CN')
  if (!session) {
    throw new Error('当前环境不支持语音输入')
  }

  return {
    kind: 'transcript',
    provider: 'browser-local',
    metadata: {
      runtime: 'client',
      session,
    },
  }
}

export function createBrowserLocalSpeechProvider(): SpeechProvider {
  return {
    id: 'browser-local',
    runtime: 'client',
    capabilities: {
      provider: 'browser-local',
      runtime: 'client',
      taskTypes: ['tts', 'stt'],
    },
    synthesize: (task) => synthesizeWithBrowser(task as SpeechTask<{ text: string }>),
    transcribe: (task) => transcribeWithBrowser(task as SpeechTask<BrowserSpeechRecognitionTaskInput>),
  }
}
