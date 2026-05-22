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

function logBrowserLocalTts(event: string, details?: Record<string, unknown>): void {
  console.debug(`[browser-local-tts] ${event}`, details)
  void window.electronAPI?.appendDebugLog?.(`[browser-local-tts] ${event}`, details)
}

export function stopBrowserSpeechSynthesis(): void {
  if (!supportsBrowserSpeechSynthesis()) return
  externalStopRequested = true
  logBrowserLocalTts('stop-requested')
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

function getSpeechSynthesisTimeoutMs(text: string, rate: number): number {
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1
  // 中文长文本实际朗读时长明显高于旧的 100ms/字估算；超时只用于兜底，不应抢在正常朗读前触发。
  return Math.max(60_000, Math.ceil((text.length * 240) / safeRate))
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

  const voice = pickVoice(task.profile)
  let playbackStarted = false
  const notifyPlaybackStart = () => {
    if (playbackStarted) return
    playbackStarted = true
    task.runtime?.onPlaybackStart?.()
  }

  const attemptSynthesis = (remainingUnexpectedInterruptRetries: number): Promise<SpeechArtifact> => (
    new Promise<SpeechArtifact>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
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
      const timeoutMs = getSpeechSynthesisTimeoutMs(text, utterance.rate)

      utterance.onstart = () => {
        logBrowserLocalTts('onstart', {
          textLength: text.length,
          remainingUnexpectedInterruptRetries,
          timeoutMs,
        })
        notifyPlaybackStart()
      }

      // Chrome 偶发 bug：onend 可能永远不触发。这里的超时只做"挂死兜底"，
      // 不应抢在长文本正常朗读完成前触发。
      const timeoutId = setTimeout(() => {
        try {
          window.speechSynthesis.cancel()
        } catch {
          // ignore
        }
        externalStopRequested = false
        logBrowserLocalTts('timeout', {
          textLength: text.length,
          timeoutMs,
        })
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
      }, timeoutMs)

      utterance.onend = () => {
        clearTimeout(timeoutId)
        externalStopRequested = false
        logBrowserLocalTts('onend', {
          textLength: text.length,
        })
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
        const wasExternalStop = externalStopRequested
        externalStopRequested = false
        const errorCode = (event as SpeechSynthesisErrorEvent).error
        logBrowserLocalTts('onerror', {
          textLength: text.length,
          errorCode,
          wasExternalStop,
          remainingUnexpectedInterruptRetries,
        })
        if (errorCode === 'interrupted' || errorCode === 'canceled') {
          if (wasExternalStop) {
            reject(new Error('speech_interrupted'))
            return
          }
          if (remainingUnexpectedInterruptRetries > 0) {
            try {
              window.speechSynthesis.cancel()
            } catch {
              // ignore
            }
            logBrowserLocalTts('retry', {
              textLength: text.length,
              nextRemainingRetries: remainingUnexpectedInterruptRetries - 1,
            })
            resolve(attemptSynthesis(remainingUnexpectedInterruptRetries - 1))
            return
          }
          resolve({
            kind: 'audio',
            provider: 'browser-local',
            text,
            voice: task.profile?.voice ?? voice?.voiceURI ?? voice?.name ?? null,
            metadata: { runtime: 'client', interrupted: true },
          })
          return
        }
        reject(new Error('语音播报失败'))
      }

      window.speechSynthesis.speak(utterance)
    })
  )

  return attemptSynthesis(1)
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
