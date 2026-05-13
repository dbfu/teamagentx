import { getApiBaseUrl } from '@/lib/config'
import type { SpeechArtifact } from '@/speech/domain/types'
import type { SpeechProvider } from '@/speech/providers/provider'

type RemoteTtsProviderDependencies = {
  getBaseUrl?: () => Promise<string>
  providerId?: string
}

type ActiveRemotePlayback = {
  stop: () => void
}

let activeRemotePlayback: ActiveRemotePlayback | null = null

export function stopRemoteTtsPlayback(): void {
  activeRemotePlayback?.stop()
  activeRemotePlayback = null
}

async function playAudioUrl(audioUrl: string): Promise<void> {
  stopRemoteTtsPlayback()
  const audio = new Audio(audioUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      let finished = false

      const cleanup = () => {
        if (activeRemotePlayback === controller) {
          activeRemotePlayback = null
        }
        audio.onended = null
        audio.onerror = null
      }

      const finish = () => {
        if (finished) return
        finished = true
        cleanup()
        resolve()
      }

      const fail = () => {
        if (finished) return
        finished = true
        cleanup()
        reject(new Error('远程语音播报失败'))
      }

      const controller: ActiveRemotePlayback = {
        stop: () => {
          if (finished) return
          try {
            audio.pause()
            audio.currentTime = 0
          } catch {
            // ignore stop errors from browser media APIs
          }
          finish()
        },
      }

      activeRemotePlayback = controller
      audio.onended = () => finish()
      audio.onerror = () => fail()
      audio.play().catch(() => fail())
    })
  } finally {
    URL.revokeObjectURL(audioUrl)
  }
}

export function createRemoteTtsSpeechProvider(
  dependencies: RemoteTtsProviderDependencies = {},
): SpeechProvider {
  const getBaseUrl = dependencies.getBaseUrl ?? getApiBaseUrl
  const providerId = dependencies.providerId ?? 'openai-compatible-tts'

  return {
    id: providerId,
    runtime: 'client',
    capabilities: {
      provider: providerId,
      runtime: 'client',
      taskTypes: ['tts'],
    },
    async synthesize(task) {
      const response = await fetch(`${await getBaseUrl()}/speech/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(task),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(errorText || `远程语音播报失败(${response.status})`)
      }

      const mimeType = response.headers.get('content-type') || 'audio/mpeg'
      const provider = response.headers.get('x-speech-provider') || providerId
      const model = response.headers.get('x-speech-model')
      const voice = response.headers.get('x-speech-voice')
      const blob = new Blob([await response.arrayBuffer()], { type: mimeType })
      const audioUrl = URL.createObjectURL(blob)

      await playAudioUrl(audioUrl)

      return {
        kind: 'audio',
        provider,
        model,
        voice,
        mimeType,
        audioUrl,
        text: String((task.input as { text?: string }).text || ''),
        metadata: {
          runtime: 'client',
          transport: providerId,
        },
      } satisfies SpeechArtifact
    },
  }
}
