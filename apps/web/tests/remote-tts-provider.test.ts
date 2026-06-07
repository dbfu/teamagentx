import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import { createRemoteTtsSpeechProvider, stopRemoteTtsPlayback } from '../src/speech/providers/remote-tts-provider.ts'
import { markRemoteTtsUnavailable, resetRemoteTtsHealth } from '../src/speech/remote-tts-health.ts'
import { buildTtsCacheKey, roomTtsPrefetchCache } from '../src/speech/tts-prefetch-cache.ts'

const originalFetch = globalThis.fetch
const originalURL = globalThis.URL
const originalAudio = globalThis.Audio
const originalLocalStorage = globalThis.localStorage

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.URL = originalURL
  globalThis.Audio = originalAudio
  if (originalLocalStorage === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage')
  } else {
    globalThis.localStorage = originalLocalStorage
  }
  roomTtsPrefetchCache.deleteRoom('room-cache-stop')
  resetRemoteTtsHealth()
})

function installLocalStorageStub() {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  }
}

describe('remote-tts speech provider', () => {
  test('应从服务端获取音频并返回 SpeechArtifact', async () => {
    let createdBlob: Blob | null = null
    let revokedUrl: string | null = null
    let playbackStarted = 0
    installLocalStorageStub()

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
      runtime: {
        onPlaybackStart: () => {
          playbackStarted += 1
        },
      },
    })

    assert.ok(result)
    assert.strictEqual(result.kind, 'audio')
    assert.strictEqual(result.provider, 'openai-compatible-tts')
    assert.strictEqual(result.mimeType, 'audio/mpeg')
    assert.ok(createdBlob)
    assert.strictEqual(createdBlob?.type, 'audio/mpeg')
    assert.strictEqual(revokedUrl, 'blob:remote-tts-preview')
    assert.strictEqual(playbackStarted, 1)
  })

  test('应支持停止远程播报并释放 blob url', async () => {
    let revokedUrl: string | null = null
    let paused = false
    let playbackStarted = 0
    installLocalStorageStub()

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
      runtime: {
        onPlaybackStart: () => {
          playbackStarted += 1
        },
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
    assert.strictEqual(playbackStarted, 1)
  })

  test('缓存音频在暂停后才完成时不应自动开始播放', async () => {
    let resolveCachedAudio: ((audio: { blob: Blob; mimeType: string }) => void) | null = null
    let audioCreated = false
    installLocalStorageStub()

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
    installLocalStorageStub()
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

  test('远程 provider 熔断期间应直接短路，避免重复请求坏掉的服务', async () => {
    let fetchCalled = false
    installLocalStorageStub()

    markRemoteTtsUnavailable({
      provider: 'openai-compatible-tts',
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      vendorOptions: { llmProviderId: 'provider-dead' },
    })

    globalThis.fetch = async () => {
      fetchCalled = true
      throw new Error('不应触发网络请求')
    }

    const provider = createRemoteTtsSpeechProvider({
      getBaseUrl: async () => 'http://127.0.0.1:3001',
    })

    await assert.rejects(
      provider.synthesize?.({
        type: 'tts',
        profile: {
          provider: 'openai-compatible-tts',
          model: 'FunAudioLLM/CosyVoice2-0.5B',
          vendorOptions: { llmProviderId: 'provider-dead' },
        },
        input: { text: '直接走 fallback' },
      }),
      /remote_tts_temporarily_unavailable/,
    )
    assert.strictEqual(fetchCalled, false)
  })

  test('连续两次 synthesize 时后一个请求不应隐式打断前一个播放', async () => {
    let playCount = 0
    let pausedCount = 0
    let firstEnded: (() => void) | null = null
    installLocalStorageStub()

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
        if (this.src === 'blob:play-1') {
          await new Promise<void>((resolve) => {
            firstEnded = () => {
              this.onended?.()
              resolve()
            }
          })
          return
        }
        this.onended?.()
      }
      pause() { pausedCount++ }
      load() {}
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

    await assert.rejects(second, /播放已取消/)
    assert.strictEqual(pausedCount, 0, '后一个请求不应隐式暂停前一个播放')

    firstEnded?.()
    const result = await first
    assert.strictEqual(result.kind, 'audio')
  })
})
