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
  })
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
