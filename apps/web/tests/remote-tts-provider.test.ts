import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import { createRemoteTtsSpeechProvider, stopRemoteTtsPlayback } from '../src/speech/providers/remote-tts-provider.ts'

const originalFetch = globalThis.fetch
const originalURL = globalThis.URL
const originalAudio = globalThis.Audio

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.URL = originalURL
  globalThis.Audio = originalAudio
})

describe('remote-tts speech provider', () => {
  test('应从服务端获取音频并返回可播放的 blob url', async () => {
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
          'x-speech-provider': 'openai-compatible-tts',
          'x-speech-model': 'gpt-4o-mini-tts',
          'x-speech-voice': 'alloy',
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
        assert.strictEqual(this.src, 'blob:remote-tts-preview')
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
    assert.strictEqual(result?.kind, 'audio')
    assert.strictEqual(result?.audioUrl, 'blob:remote-tts-preview')
    assert.strictEqual(result?.provider, 'openai-compatible-tts')
    assert.strictEqual(result?.model, 'gpt-4o-mini-tts')
    assert.strictEqual(result?.voice, 'alloy')
    assert.strictEqual(result?.mimeType, 'audio/mpeg')
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

    const result = await playback
    assert.strictEqual(result.kind, 'audio')
    assert.strictEqual(paused, true)
    assert.strictEqual(revokedUrl, 'blob:remote-tts-stop')
  })
})
