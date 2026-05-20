import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import { createRemoteTtsSpeechProvider, stopRemoteTtsPlayback } from '../src/speech/providers/remote-tts-provider.ts'
import { buildTtsCacheKey, roomTtsPrefetchCache } from '../src/speech/tts-prefetch-cache.ts'

const originalFetch = globalThis.fetch
const originalURL = globalThis.URL
const originalAudio = globalThis.Audio

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.URL = originalURL
  globalThis.Audio = originalAudio
  roomTtsPrefetchCache.deleteRoom('room-cache-stop')
})

describe('remote-tts speech provider', () => {
  test('应从服务端获取音频并返回 SpeechArtifact', async () => {
    let createdBlob: Blob | null = null
    let revokedUrl: string | null = null

    globalThis.fetch = async (input, init) => {
      assert.strictEqual(input, 'http://127.0.0.1:3001/speech/tts')
      assert.ok(init)
      assert.strictEqual(init.method, 'POST')

      const body = JSON.parse(String(init.body))
      assert.strictEqual(body.profile.provider, 'openai-compatible-tts')
      assert.strictEqual(body.input.text, '远程试听')

      return new Response(new Uint8Array([5, 6, 7]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
        },
      })
    }

    globalThis.URL = {
      createObjectURL(blob: Blob) {
        createdBlob = blob
        return 'blob:remote-tts-preview'
      },
      revokeObjectURL(url: string) {
        revokedUrl = url
      },
    } as typeof URL

    class FakeAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(public readonly src: string) {}

      async play() {
        this.onended?.()
      }
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio

    const provider = createRemoteTtsSpeechProvider({
      getBaseUrl: async () => 'http://127.0.0.1:3001',
    })

    const result = await provider.synthesize?.({
      type: 'tts',
      profile: {
        provider: 'openai-compatible-tts',
        voice: 'alloy',
      },
      input: {
        text: '远程试听',
      },
    })

    assert.ok(result)
    assert.strictEqual(result.kind, 'audio')
    assert.strictEqual(result.provider, 'openai-compatible-tts')
    assert.strictEqual(result.mimeType, 'audio/mpeg')
    assert.ok(createdBlob)
    assert.strictEqual(createdBlob?.type, 'audio/mpeg')
    assert.strictEqual(revokedUrl, 'blob:remote-tts-preview')
  })

  test('应支持停止远程播报并释放 blob url', async () => {
    let revokedUrl: string | null = null
    let paused = false

    globalThis.fetch = async () => {
      return new Response(new Uint8Array([5, 6, 7]), {
        status: 200,
        headers: {
          'content-type': 'audio/mpeg',
        },
      })
    }

    globalThis.URL = {
      createObjectURL() {
        return 'blob:remote-tts-stop'
      },
      revokeObjectURL(url: string) {
        revokedUrl = url
      },
    } as typeof URL

    class FakeAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      currentTime = 3

      async play() {
        return undefined
      }

      pause() {
        paused = true
      }
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio

    const provider = createRemoteTtsSpeechProvider({
      getBaseUrl: async () => 'http://127.0.0.1:3001',
    })

    const playback = provider.synthesize?.({
      type: 'tts',
      profile: {
        provider: 'openai-compatible-tts',
      },
      input: {
        text: '停止测试',
      },
    }) ?? Promise.reject(new Error('provider missing'))

    await new Promise((resolve) => setTimeout(resolve, 20))
    stopRemoteTtsPlayback()

    await assert.rejects(playback, (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.strictEqual(error.message, '播放已取消')
      assert.strictEqual((error as Error & { cancelled?: boolean }).cancelled, true)
      return true
    })
    assert.strictEqual(paused, true)
    assert.strictEqual(revokedUrl, 'blob:remote-tts-stop')
  })

  test('缓存音频在暂停后才完成时不应自动开始播放', async () => {
    let resolveCachedAudio: ((audio: { blob: Blob; mimeType: string }) => void) | null = null
    let audioCreated = false

    globalThis.fetch = async () => {
      throw new Error('不应走网络请求')
    }

    globalThis.URL = {
      createObjectURL() {
        return 'blob:remote-tts-cached'
      },
      revokeObjectURL() {},
    } as typeof URL

    class FakeAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null

      constructor(_src: string) {
        audioCreated = true
      }

      async play() {
        this.onended?.()
      }

      pause() {}
      load() {}
    }

    globalThis.Audio = FakeAudio as unknown as typeof Audio

    const provider = createRemoteTtsSpeechProvider({
      getBaseUrl: async () => 'http://127.0.0.1:3001',
    })

    const cacheKey = buildTtsCacheKey({
      provider: 'openai-compatible-tts',
      model: null,
      voice: null,
      speed: 1.3,
      format: null,
      vendorOptions: null,
      text: '缓存取消测试',
    })

    roomTtsPrefetchCache.forRoom('room-cache-stop').set(
      cacheKey,
      new Promise((resolve) => {
        resolveCachedAudio = resolve
      }),
    )

    const playback = provider.synthesize?.({
      type: 'tts',
      profile: {
        provider: 'openai-compatible-tts',
      },
      input: {
        text: '缓存取消测试',
      },
      context: {
        chatRoomId: 'room-cache-stop',
      },
    }) ?? Promise.reject(new Error('provider missing'))

    stopRemoteTtsPlayback()
    resolveCachedAudio?.({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      mimeType: 'audio/mpeg',
    })

    await assert.rejects(playback, (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.strictEqual(error.message, '播放已取消')
      assert.strictEqual((error as Error & { cancelled?: boolean }).cancelled, true)
      return true
    })
    assert.strictEqual(audioCreated, false)
  })

  test('服务端返回非 2xx 时应抛错', async () => {
    globalThis.fetch = async () => {
      return new Response(null, { status: 502 })
    }

    globalThis.URL = {
      createObjectURL() { return 'blob:err' },
      revokeObjectURL() {},
    } as typeof URL

    class FakeAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(public readonly src: string) {}
      async play() { this.onended?.() }
      pause() {}
    }
    globalThis.Audio = FakeAudio as unknown as typeof Audio

    const provider = createRemoteTtsSpeechProvider({
      getBaseUrl: async () => 'http://127.0.0.1:3001',
    })

    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: { provider: 'openai-compatible-tts' },
        input: { text: '错误测试' },
      }),
      /TTS failed: 502/,
    )
  })

  test('连续两次 synthesize 时应停掉前一个 controller', async () => {
    let playCount = 0
    let pausedCount = 0

    globalThis.fetch = async () => {
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    }

    globalThis.URL = {
      createObjectURL() { return `blob:play-${++playCount}` },
      revokeObjectURL() {},
    } as typeof URL

    class FakeAudio {
      onended: (() => void) | null = null
      onerror: (() => void) | null = null
      currentTime = 0
      constructor(public readonly src: string) {}
      async play() {
        // 延迟结束，让第二次 synthesize 有时间中断
        await new Promise((r) => setTimeout(r, 30))
        this.onended?.()
      }
      pause() { pausedCount++ }
    }
    globalThis.Audio = FakeAudio as unknown as typeof Audio

    const provider = createRemoteTtsSpeechProvider({
      getBaseUrl: async () => 'http://127.0.0.1:3001',
    })

    const first = provider.synthesize?.({
      type: 'tts',
      profile: { provider: 'openai-compatible-tts' },
      input: { text: '第一条' },
    })

    await new Promise((r) => setTimeout(r, 5))

    const second = provider.synthesize?.({
      type: 'tts',
      profile: { provider: 'openai-compatible-tts' },
      input: { text: '第二条' },
    })

    // 第一次应该被 stop 导致 cancelled reject
    await assert.rejects(first, /播放已取消/)
    const result = await second
    assert.strictEqual(result.kind, 'audio')
    assert.ok(pausedCount >= 1, '前一个 audio 应被 pause')
  })
})
