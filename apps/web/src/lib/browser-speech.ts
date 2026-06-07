import { webSpeechService } from '@/speech/default-service'
import type { SpeechProfile } from '@/speech'
import {
  getBrowserSpeechVoices as getBrowserLocalSpeechVoices,
  supportsBrowserSpeechRecognition as supportsBrowserLocalSpeechRecognition,
  supportsBrowserSpeechSynthesis as supportsBrowserLocalSpeechSynthesis,
  stopBrowserSpeechSynthesis as stopBrowserLocalSpeechSynthesis,
  type BrowserSpeechRecognitionSession,
  type BrowserSpeechVoiceOption,
} from '@/speech/providers/browser-local-provider'
import type { SpeechTask } from '@/speech'
import { stopRemoteTtsPlayback } from '@/speech/providers/remote-tts-provider'
import { clearRemoteTtsUnavailable, isRemoteTtsTemporarilyUnavailable, markRemoteTtsUnavailable } from '@/speech/remote-tts-health'
import { buildTtsCacheKey, PREWARM_MAX_TEXT_LENGTH, roomTtsPrefetchCache } from '@/speech/tts-prefetch-cache'
import { deleteExpiredIdbEntries, deleteIdbEntry, loadRoomIdbEntries, writeIdbEntry } from '@/speech/tts-idb-cache'
import { streamingTtsManager } from '@/speech/streaming-tts'
import { getApiBaseUrl } from '@/lib/config'

export type SpeechOutputMode = 'off' | 'manual' | 'auto_final_only'

export type { BrowserSpeechRecognitionSession, BrowserSpeechVoiceOption }

export interface SpeakTextOptions {
  text: string
  provider?: string | null
  model?: string | null
  voiceId?: string | null
  fallbackProvider?: string | null
  rate?: number
  volume?: number
  pitch?: number
  emotion?: string | null
  style?: string | null
  format?: string | null
  sampleRate?: number | null
  temperature?: number | null
  prompt?: string | null
  vendorOptions?: Record<string, unknown> | null
  agentId?: string
  chatRoomId?: string
  messageId?: string
  source?: NonNullable<SpeechTask['context']>['source']
  onPlaybackStart?: (() => void) | null
}

export function supportsBrowserSpeechRecognition(): boolean {
  return supportsBrowserLocalSpeechRecognition()
}

export function startBrowserSpeechRecognition(language = 'zh-CN'): BrowserSpeechRecognitionSession | null {
  if (!supportsBrowserLocalSpeechRecognition()) return null

  const sessionPromise = webSpeechService.execute({
    type: 'stt',
    profile: {
      provider: 'browser-local',
    },
    input: {
      mode: 'session-start',
      language,
    },
  })

  const getSession = async (): Promise<BrowserSpeechRecognitionSession> => {
    const result = await sessionPromise
    if (!('kind' in result) || result.kind !== 'transcript') {
      throw new Error('语音识别会话启动失败')
    }

    const session = result.metadata?.session
    if (!session || typeof session !== 'object') {
      throw new Error('语音识别会话启动失败')
    }
    // #35: 校验 session 具有必要方法，避免不安全的类型断言
    if (typeof (session as { stop?: unknown }).stop !== 'function') {
      throw new Error('语音识别会话接口不完整')
    }
    return session as BrowserSpeechRecognitionSession
  }

  return {
    stop: async () => {
      const session = await getSession()
      return session.stop()
    },
    cancel: () => {
      void getSession().then((session) => session.cancel()).catch(() => {})
    },
  }
}

export function supportsBrowserSpeechSynthesis(): boolean {
  return supportsBrowserLocalSpeechSynthesis()
}

export function getBrowserSpeechVoices(): BrowserSpeechVoiceOption[] {
  return getBrowserLocalSpeechVoices()
}

export function normalizeSpeechText(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*[-=:]{3,}\s*$/gm, ' ')
    .replace(/^[>#*\-]+\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/(^|\s)[-=:]{3,}(?=\s|$)/g, ' ')
    .replace(/[@＠](?=\S+)/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, ' ')
    .replace(/[←→↑↓↔↕↖↗↘↙➜➤➡︎▶►]+/gu, ' ')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function supportsSpeechPlayback(profile?: Pick<SpeechProfile, 'provider'> | null): boolean {
  if (profile?.provider && profile.provider !== 'browser-local') {
    return true
  }
  return supportsBrowserLocalSpeechSynthesis()
}

export function stopSpeechPlayback(): void {
  stopBrowserLocalSpeechSynthesis()
  stopRemoteTtsPlayback()
  streamingTtsManager.stopAll()
}


export async function speakText(options: SpeakTextOptions): Promise<void> {
  const trimmedText = normalizeSpeechText(options.text)
  if (!trimmedText) return

  const provider = options.provider ?? 'browser-local'
  if (provider === 'browser-local' && !supportsBrowserLocalSpeechSynthesis()) {
    throw new Error('当前环境不支持语音播报')
  }

  await webSpeechService.execute({
    type: 'tts',
    profile: {
      provider,
      model: options.model ?? null,
      voice: options.voiceId ?? null,
      fallbackProvider: options.fallbackProvider ?? null,
      speed: options.rate ?? 1.3,
      volume: options.volume ?? 1,
      pitch: options.pitch ?? null,
      emotion: options.emotion ?? null,
      style: options.style ?? null,
      format: options.format ?? null,
      sampleRate: options.sampleRate ?? null,
      temperature: options.temperature ?? null,
      prompt: options.prompt ?? null,
      vendorOptions: options.vendorOptions ?? null,
    },
    input: {
      text: trimmedText,
    },
    context: {
      agentId: options.agentId,
      chatRoomId: options.chatRoomId,
      messageId: options.messageId,
      source: options.source,
    },
    preferences: {
      allowFallback: Boolean(options.fallbackProvider),
    },
    runtime: {
      onPlaybackStart: options.onPlaybackStart ?? null,
    },
  })
}

export function deleteTtsCache(chatRoomId: string, cacheKey: string): void {
  roomTtsPrefetchCache.forRoom(chatRoomId).delete(cacheKey)
  void deleteIdbEntry(chatRoomId, cacheKey)
}

export function prewarmTts(options: SpeakTextOptions): void {
  const text = normalizeSpeechText(options.text)
  if (!text || text.length > PREWARM_MAX_TEXT_LENGTH) return
  const provider = options.provider ?? 'browser-local'
  if (provider !== 'openai-compatible-tts') return
  if (!options.chatRoomId) return
  const profile = {
    provider,
    model: options.model ?? null,
    vendorOptions: options.vendorOptions ?? null,
  }
  if (isRemoteTtsTemporarilyUnavailable(profile)) return

  const roomCache = roomTtsPrefetchCache.forRoom(options.chatRoomId)
  const cacheKey = buildTtsCacheKey({
    provider,
    model: options.model ?? null,
    voice: options.voiceId ?? null,
    speed: options.rate ?? 1.3,
    format: options.format ?? null,
    vendorOptions: options.vendorOptions ?? null,
    text,
  })
  if (roomCache.has(cacheKey)) return

  const promise = (async () => {
    const baseUrl = await getApiBaseUrl()
    const token = localStorage.getItem('auth_token')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(`${baseUrl}/speech/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          type: 'tts',
          input: { text },
          profile: {
            provider,
            model: options.model ?? null,
            voice: options.voiceId ?? null,
            speed: options.rate ?? 1.3,
            format: options.format ?? null,
            vendorOptions: options.vendorOptions ?? null,
          },
          context: {
            agentId: options.agentId,
            chatRoomId: options.chatRoomId,
          },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        markRemoteTtsUnavailable(profile, { status: response.status })
        throw new Error(`prewarm failed: ${response.status}`)
      }
      clearRemoteTtsUnavailable(profile)
      const contentType = response.headers.get('content-type') || 'audio/mpeg'
      const mimeType = contentType.split(';')[0].trim()
      const blob = new Blob([await response.arrayBuffer()], { type: mimeType })
      return { blob, mimeType }
    } finally {
      clearTimeout(timeoutId)
    }
  })()

  roomCache.set(cacheKey, promise)
  const chatRoomId = options.chatRoomId
  promise.then((audio) => writeIdbEntry(chatRoomId, cacheKey, audio)).catch(() => {})
}

export async function loadRoomTtsCache(chatRoomId: string): Promise<void> {
  void deleteExpiredIdbEntries()
  const entries = await loadRoomIdbEntries(chatRoomId)
  const roomCache = roomTtsPrefetchCache.forRoom(chatRoomId)
  for (const entry of entries) {
    if (!roomCache.has(entry.cacheKey)) {
      roomCache.set(entry.cacheKey, Promise.resolve({ blob: entry.blob, mimeType: entry.mimeType }))
    }
  }
}

export async function speakTextWithBrowserSpeech(options: SpeakTextOptions): Promise<void> {
  if (!supportsBrowserLocalSpeechSynthesis()) {
    throw new Error('当前环境不支持语音播报')
  }

  await speakText({
    ...options,
    provider: 'browser-local',
  })
}
