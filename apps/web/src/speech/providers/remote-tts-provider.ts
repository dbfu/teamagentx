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

// 用闭包封装 active controller，避免模块级裸变量的并发竞态
const playbackManager = (() => {
  let active: ActiveRemotePlayback | null = null
  return {
    set(controller: ActiveRemotePlayback) {
      // 设置新 controller 之前先同步 stop 旧的，保证顺序
      if (active && active !== controller) {
        try {
          active.stop()
        } catch {
          // ignore stop errors
        }
      }
      active = controller
    },
    clearIf(controller: ActiveRemotePlayback) {
      if (active === controller) active = null
    },
    stopAll() {
      const current = active
      active = null
      if (current) {
        try {
          current.stop()
        } catch {
          // ignore stop errors
        }
      }
    },
  }
})()

export function stopRemoteTtsPlayback(): void {
  playbackManager.stopAll()
}

async function playAudioUrl(audioUrl: string): Promise<void> {
  playbackManager.stopAll()
  const audio = new Audio(audioUrl)
  let revoked = false
  const revokeOnce = () => {
    if (revoked) return
    revoked = true
    URL.revokeObjectURL(audioUrl)
  }
  await new Promise<void>((resolve, reject) => {
    let finished = false

    const cleanup = () => {
      playbackManager.clearIf(controller)
      audio.onended = null
      audio.onerror = null
      // 完全释放 audio 元素持有的网络资源
      try {
        audio.pause()
        audio.currentTime = 0
        audio.src = ''
        audio.load()
      } catch {
        // ignore release errors
      }
      // play 完成或出错后再 revoke，不影响 artifact 返回值的有效性
      revokeOnce()
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
        // #17: stop 走 reject（标记为 cancelled），让调用方知道播放被中断
        finished = true
        cleanup()
        reject(Object.assign(new Error('播放已取消'), { cancelled: true }))
      },
    }

    playbackManager.set(controller)
    audio.onended = () => finish()
    audio.onerror = () => fail()
    audio.play().catch(() => fail())
  })
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
      const token = localStorage.getItem('auth_token')
      const response = await fetch(`${await getBaseUrl()}/speech/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

      // #11: audioUrl 在 playAudioUrl 内播放完成后已 revoke，不在 artifact 中暴露已失效的 URL
      return {
        kind: 'audio',
        provider,
        model,
        voice,
        mimeType,
        text: String((task.input as { text?: string }).text || ''),
        metadata: {
          runtime: 'client',
          transport: providerId,
        },
      } satisfies SpeechArtifact
    },
  }
}
