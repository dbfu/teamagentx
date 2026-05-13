import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import { SpeechProviderRegistry } from '../src/speech/speech-registry.ts'
import { SpeechRouter } from '../src/speech/speech-router.ts'
import { SpeechService } from '../src/speech/speech-service.ts'
import { createBrowserLocalSpeechProvider, type BrowserSpeechRecognitionSession } from '../src/speech/providers/browser-local-provider.ts'

class FakeSpeechSynthesisUtterance {
  text: string
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  volume = 1
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

function installSpeechSynthesisStub() {
  const spokenTexts: string[] = []
  const voices = [
    {
      name: 'Test Chinese Voice',
      lang: 'zh-CN',
      voiceURI: 'test-zh',
      default: true,
    },
  ] as SpeechSynthesisVoice[]

  const speechSynthesis = {
    getVoices: () => voices,
    speak: (utterance: FakeSpeechSynthesisUtterance) => {
      spokenTexts.push(utterance.text)
      utterance.onend?.()
    },
    cancel: () => {},
  }

  Object.assign(globalThis, {
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    window: {
      speechSynthesis,
    },
  })

  return { spokenTexts }
}

function installSpeechRecognitionStub(transcript: string) {
  class FakeSpeechRecognition {
    continuous = false
    interimResults = false
    lang = 'zh-CN'
    onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; resultIndex: number }) => void) | null = null
    onerror: (() => void) | null = null
    onend: (() => void) | null = null

    start() {}

    stop() {
      this.onresult?.({
        resultIndex: 0,
        results: [
          {
            0: { transcript },
            isFinal: true,
          },
        ],
      })
      this.onend?.()
    }

    abort() {
      this.onend?.()
    }
  }

  Object.assign(globalThis, {
    window: {
      SpeechRecognition: FakeSpeechRecognition,
    },
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')
})

describe('browser-local speech provider', () => {
  test('应通过 SpeechService 执行本地 TTS', async () => {
    const { spokenTexts } = installSpeechSynthesisStub()
    const registry = new SpeechProviderRegistry()
    registry.register(createBrowserLocalSpeechProvider())
    const service = new SpeechService(new SpeechRouter(registry))

    const result = await service.execute({
      type: 'tts',
      profile: {
        provider: 'browser-local',
      },
      input: {
        text: '你好 **世界**',
      },
    })

    assert.ok('kind' in result)
    assert.strictEqual(result.kind, 'audio')
    assert.strictEqual(result.provider, 'browser-local')
    assert.deepStrictEqual(spokenTexts, ['你好 **世界**'])
  })

  test('应通过 provider 暴露浏览器语音识别会话', async () => {
    installSpeechRecognitionStub('测试转写')
    const registry = new SpeechProviderRegistry()
    registry.register(createBrowserLocalSpeechProvider())
    const service = new SpeechService(new SpeechRouter(registry))

    const result = await service.execute({
      type: 'stt',
      profile: {
        provider: 'browser-local',
      },
      input: {
        mode: 'session-start',
        language: 'zh-CN',
      },
    })

    assert.ok('kind' in result)
    assert.strictEqual(result.kind, 'transcript')
    const session = result.metadata?.session as BrowserSpeechRecognitionSession | undefined
    assert.ok(session)
    assert.strictEqual(await session?.stop(), '测试转写')
  })
})
