export type SpeechOutputMode = 'off' | 'manual' | 'auto_final_only'

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

function getSpeechRecognitionCtor(): BrowserSpeechRecognitionApi | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function supportsBrowserSpeechRecognition(): boolean {
  return !!getSpeechRecognitionCtor()
}

export function startBrowserSpeechRecognition(language = 'zh-CN'): BrowserSpeechRecognitionSession | null {
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

function pickVoice(voiceId?: string | null): SpeechSynthesisVoice | null {
  if (!supportsBrowserSpeechSynthesis()) return null
  const voices = window.speechSynthesis.getVoices()
  if (!voiceId) {
    return voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) || voices[0] || null
  }

  const normalizedVoiceId = voiceId.trim().toLowerCase()
  return voices.find((voice) =>
    voice.name.toLowerCase().includes(normalizedVoiceId)
    || voice.voiceURI.toLowerCase().includes(normalizedVoiceId)
    || voice.lang.toLowerCase() === normalizedVoiceId
  ) || voices.find((voice) => voice.lang.toLowerCase().startsWith('zh')) || voices[0] || null
}

export interface SpeakTextOptions {
  text: string
  voiceId?: string | null
  rate?: number
  volume?: number
}

export function normalizeSpeechText(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[>#*\-]+\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function speakTextWithBrowserSpeech(options: SpeakTextOptions): Promise<void> {
  if (!supportsBrowserSpeechSynthesis()) {
    return Promise.reject(new Error('当前环境不支持语音播报'))
  }

  const trimmedText = normalizeSpeechText(options.text)
  if (!trimmedText) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(trimmedText)
    const voice = pickVoice(options.voiceId)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    } else {
      utterance.lang = 'zh-CN'
    }
    utterance.rate = options.rate ?? 1
    utterance.volume = options.volume ?? 1
    utterance.onend = () => resolve()
    utterance.onerror = (e) => {
      // 主动取消（cancel() 调用）不视为错误
      if ((e as SpeechSynthesisErrorEvent).error === 'interrupted' || (e as SpeechSynthesisErrorEvent).error === 'canceled') {
        resolve()
        return
      }
      reject(new Error('语音播报失败'))
    }
    window.speechSynthesis.speak(utterance)
  })
}
