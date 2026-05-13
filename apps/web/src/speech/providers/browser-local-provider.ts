import type { SpeechProvider } from '@/speech/providers/provider'
import type { SpeechArtifact, SpeechProfile, SpeechTask } from '@/speech/domain/types'

export interface BrowserSpeechVoiceOption {
  id: string
  name: string
  lang: string
  voiceURI: string
  default: boolean
}

type BrowserSpeechRecognitionApi = new () => SpeechRecognition

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

declare global {
  interface Window {
    webkitSpeechRecognition?: BrowserSpeechRecognitionApi
    SpeechRecognition?: BrowserSpeechRecognitionApi
  }

  interface SpeechRecognition extends EventTarget {
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
  return voices.find((voice) =>
    voice.name.toLowerCase().includes(normalizedVoiceId)
    || voice.voiceURI.toLowerCase().includes(normalizedVoiceId)
    || voice.lang.toLowerCase() === normalizedVoiceId,
  ) || voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) || voices[0] || null
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
        resolveStop = resolve
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

    utterance.onend = () => resolve({
      kind: 'audio',
      provider: 'browser-local',
      text,
      voice: task.profile?.voice ?? voice?.voiceURI ?? voice?.name ?? null,
      metadata: {
        runtime: 'client',
      },
    })
    utterance.onerror = (event) => {
      if ((event as SpeechSynthesisErrorEvent).error === 'interrupted' || (event as SpeechSynthesisErrorEvent).error === 'canceled') {
        resolve({
          kind: 'audio',
          provider: 'browser-local',
          text,
          voice: task.profile?.voice ?? voice?.voiceURI ?? voice?.name ?? null,
          metadata: {
            runtime: 'client',
            interrupted: true,
          },
        })
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
