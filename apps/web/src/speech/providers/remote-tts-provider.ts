import { getApiBaseUrl } from '@/lib/config'
import type { SpeechArtifact } from '@/speech/domain/types'
import type { SpeechProvider } from '@/speech/providers/provider'
import { buildTtsCacheKey, PREWARM_MAX_TEXT_LENGTH, roomTtsPrefetchCache } from '@/speech/tts-prefetch-cache'
import { writeIdbEntry } from '@/speech/tts-idb-cache'

const DEFAULT_REMOTE_TTS_TIMEOUT_MS = 8_000

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
      const text = String((task.input as { text?: string }).text || '').trim()

      // 缓存命中：跳过远程请求直接播放
      const chatRoomId = (task.context as { chatRoomId?: string } | undefined)?.chatRoomId
      if (text && text.length <= PREWARM_MAX_TEXT_LENGTH && chatRoomId) {
        const cacheKey = buildTtsCacheKey({
          provider: providerId,
          model: task.profile?.model ?? null,
          voice: task.profile?.voice ?? null,
          speed: task.profile?.speed ?? 1.3,
          format: task.profile?.format ?? null,
          text,
        })
        const cached = roomTtsPrefetchCache.forRoom(chatRoomId).get(cacheKey)
        if (cached) {
          try {
            const { blob, mimeType } = await cached
            const audioUrl = URL.createObjectURL(blob)
            await playAudioUrl(audioUrl)
            return {
              kind: 'audio',
              provider: providerId,
              mimeType,
              text,
              metadata: { runtime: 'client', transport: providerId, fromCache: true },
            } satisfies SpeechArtifact
          } catch {
            // 缓存条目失效，降级到正常 fetch
          }
        }
      }

      const token = localStorage.getItem('auth_token')
      const rawTimeout = task.profile?.vendorOptions?.timeoutMs
      const defaultTimeout = task.preferences?.allowFallback
        ? DEFAULT_REMOTE_TTS_TIMEOUT_MS
        : 30_000
      const timeoutMs = typeof rawTimeout === 'number'
        ? Math.min(30_000, Math.max(1_000, rawTimeout))
        : defaultTimeout

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      let response: Response
      try {
        response = await fetch(`${await getBaseUrl()}/speech/tts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(task),
          signal: controller.signal,
        })
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('语音服务响应超时，请重试')
        }
        throw err
      }
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(errorText || `远程语音播报失败(${response.status})`)
      }

      const mimeType = (response.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim()
      const provider = response.headers.get('x-speech-provider') || providerId
      const model = response.headers.get('x-speech-model')
      const voice = response.headers.get('x-speech-voice')
      const blob = new Blob([await response.arrayBuffer()], { type: mimeType })

      if (chatRoomId && text.length <= PREWARM_MAX_TEXT_LENGTH) {
        const cacheKey = buildTtsCacheKey({
          provider: providerId,
          model: task.profile?.model ?? null,
          voice: task.profile?.voice ?? null,
          speed: task.profile?.speed ?? 1.3,
          format: task.profile?.format ?? null,
          text,
        })
        roomTtsPrefetchCache.forRoom(chatRoomId).set(cacheKey, Promise.resolve({ blob, mimeType }))
        void writeIdbEntry(chatRoomId, cacheKey, { blob, mimeType })
      }

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
