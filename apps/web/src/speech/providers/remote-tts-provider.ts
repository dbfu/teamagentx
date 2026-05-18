import { getApiBaseUrl } from '@/lib/config'
import type { SpeechArtifact } from '@/speech/domain/types'
import type { SpeechProvider } from '@/speech/providers/provider'
import { buildTtsCacheKey, PREWARM_MAX_TEXT_LENGTH, roomTtsPrefetchCache } from '@/speech/tts-prefetch-cache'

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

      // 缓存未命中：先获取完整音频再播放，先回到普通模式以保证稳定性。
      const streamToken = localStorage.getItem('auth_token')
      const baseUrl = await getBaseUrl()
      const response = await fetch(`${baseUrl}/speech/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(streamToken ? { Authorization: `Bearer ${streamToken}` } : {}),
        },
        body: JSON.stringify(task),
      })
      if (!response.ok) throw new Error(`TTS failed: ${response.status}`)
      const contentType = response.headers.get('content-type') || 'audio/mpeg'
      const mimeType = contentType.split(';')[0].trim()
      const blob = new Blob([await response.arrayBuffer()], { type: mimeType })
      const audioUrl = URL.createObjectURL(blob)
      await playAudioUrl(audioUrl)
      return {
        kind: 'audio',
        provider: providerId,
        text: String((task.input as { text?: string }).text || ''),
        metadata: { runtime: 'client', transport: providerId, mode: 'non-streaming-fallback' },
      } satisfies SpeechArtifact
    },
  }
}
