import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import {
  createBrowserLocalSpeechProvider,
  stopBrowserSpeechSynthesis,
  type BrowserSpeechRecognitionSession,
} from '../src/speech/providers/browser-local-provider.ts'

class FakeSpeechSynthesisUtterance {
  text: string
  voice?: SpeechSynthesisVoice
  lang = ''
  rate = 1
  volume = 1
  pitch = 1
  onend: (() => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null

  constructor(text: string) {
    this.text = text
  }
}

interface SynthStubOptions {
  // 控制 speak 的行为：默认立即触发 onend，'manual' 不触发，'error' 触发指定 error
  speakMode?: 'end' | 'manual' | { errorCode: string }
  voices?: Partial<SpeechSynthesisVoice>[]
}

function installSpeechSynthesisStub(options: SynthStubOptions = {}) {
  const spokenTexts: string[] = []
  const utterances: FakeSpeechSynthesisUtterance[] = []
  const voices = (options.voices ?? [
    {
      name: 'Test Chinese Voice',
      lang: 'zh-CN',
      voiceURI: 'test-zh',
      default: true,
    },
  ]) as SpeechSynthesisVoice[]

  const speechSynthesis = {
    getVoices: () => voices,
    speak: (utterance: FakeSpeechSynthesisUtterance) => {
      spokenTexts.push(utterance.text)
      utterances.push(utterance)
      const mode = options.speakMode ?? 'end'
      if (mode === 'end') {
        utterance.onend?.()
      } else if (mode === 'manual') {
        // do nothing — caller will drive onend/onerror manually
      } else if (typeof mode === 'object' && 'errorCode' in mode) {
        utterance.onerror?.({ error: mode.errorCode })
      }
    },
    cancel: () => {},
  }

  Object.assign(globalThis, {
    SpeechSynthesisUtterance: FakeSpeechSynthesisUtterance,
    window: {
      speechSynthesis,
    },
  })

  return { spokenTexts, utterances, voices }
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

// 装一个不触发 onend 的识别 stub，用于测试 stop() 的 5 秒超时兜底
function installHangingSpeechRecognitionStub() {
  class HangingSpeechRecognition {
    continuous = false
    interimResults = false
    lang = 'zh-CN'
    onresult: ((event: unknown) => void) | null = null
    onerror: (() => void) | null = null
    onend: (() => void) | null = null

    start() {}
    stop() {
      // 故意什么都不做，模拟 webkit 的 stop 不触发 onend
    }
    abort() {
      this.onend?.()
    }
  }

  Object.assign(globalThis, {
    window: {
      SpeechRecognition: HangingSpeechRecognition,
    },
  })
}

// 确保每个测试都从干净的 externalStopRequested 状态开始
function resetExternalStopFlag() {
  // 通过装一个最小的 synth stub，然后调用一次 speak 让 onend 跑完来消费可能残留的标志
  installSpeechSynthesisStub({ speakMode: 'end' })
  // 直接的方式：触发 stop 然后让 onend 消费 —— 但这会再次设置标志。
  // 实际上 stopBrowserSpeechSynthesis 设置 flag → 下一次 onend 消费。
  // 简单点：什么都不做，依赖每个测试自己控制流程。
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')
})

describe('browser-local speech provider', () => {
  test('应直接通过 provider 执行本地 TTS', async () => {
    const { spokenTexts } = installSpeechSynthesisStub()
    const provider = createBrowserLocalSpeechProvider()

    const result = await provider.synthesize!({
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
    const provider = createBrowserLocalSpeechProvider()

    const result = await provider.transcribe!({
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

  describe('onerror 分支', () => {
    test('interrupted 且外部 stop 已调用 → 抛 speech_interrupted', async () => {
      const { utterances } = installSpeechSynthesisStub({ speakMode: 'manual' })
      const provider = createBrowserLocalSpeechProvider()

      const promise = provider.synthesize!({
        type: 'tts',
        profile: { provider: 'browser-local' },
        input: { text: 'hello' },
      })

      // 等待一个 microtask 让 speak() 同步阶段完成、onerror 已被挂上
      await Promise.resolve()
      stopBrowserSpeechSynthesis()
      utterances[0]!.onerror?.({ error: 'interrupted' })

      await assert.rejects(promise, (err: Error) => err.message === 'speech_interrupted')
    })

    test('interrupted 且未调用外部 stop → resolve（兜底为正常结束）', async () => {
      const { utterances } = installSpeechSynthesisStub({ speakMode: 'manual' })
      const provider = createBrowserLocalSpeechProvider()

      const promise = provider.synthesize!({
        type: 'tts',
        profile: { provider: 'browser-local' },
        input: { text: 'hello' },
      })

      await Promise.resolve()
      utterances[0]!.onerror?.({ error: 'interrupted' })

      const result = await promise
      assert.strictEqual(result.kind, 'audio')
      assert.strictEqual(result.metadata?.interrupted, true)
    })

    test('其他 error code → reject 普通错误', async () => {
      const { utterances } = installSpeechSynthesisStub({ speakMode: 'manual' })
      const provider = createBrowserLocalSpeechProvider()

      const promise = provider.synthesize!({
        type: 'tts',
        profile: { provider: 'browser-local' },
        input: { text: 'hello' },
      })

      await Promise.resolve()
      utterances[0]!.onerror?.({ error: 'not-allowed' })

      await assert.rejects(promise, (err: Error) => err.message === '语音播报失败')
    })
  })

  test('Chrome onend 不触发时应在 30s 超时后 resolve 且 metadata.timedOut 为 true', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    installSpeechSynthesisStub({ speakMode: 'manual' })
    const provider = createBrowserLocalSpeechProvider()

    const promise = provider.synthesize!({
      type: 'tts',
      profile: { provider: 'browser-local' },
      input: { text: 'hi' },
    })

    // 推进 30 秒，触发兜底超时
    t.mock.timers.tick(30_000)

    const result = await promise
    assert.strictEqual(result.kind, 'audio')
    assert.strictEqual(result.metadata?.timedOut, true)
  })

  test('externalStopRequested 在连续 synthesize 之间互不影响', async () => {
    const stub = installSpeechSynthesisStub({ speakMode: 'manual' })
    const provider = createBrowserLocalSpeechProvider()

    // 第一次：外部 stop，验证抛错并消费标志
    const first = provider.synthesize!({
      type: 'tts',
      profile: { provider: 'browser-local' },
      input: { text: 'one' },
    })
    await Promise.resolve()
    stopBrowserSpeechSynthesis()
    stub.utterances[0]!.onerror?.({ error: 'interrupted' })
    await assert.rejects(first, (err: Error) => err.message === 'speech_interrupted')

    // 第二次：未再次调用 stop，触发 interrupted 应被视为噪音，resolve 而非 reject
    const second = provider.synthesize!({
      type: 'tts',
      profile: { provider: 'browser-local' },
      input: { text: 'two' },
    })
    await Promise.resolve()
    stub.utterances[1]!.onerror?.({ error: 'interrupted' })
    const result = await second
    assert.strictEqual(result.kind, 'audio')
    assert.strictEqual(result.metadata?.interrupted, true)
  })

  describe('pickVoice', () => {
    test('传入精确的 voiceURI 应精确匹配（不会被 includes 误命中）', async () => {
      const stub = installSpeechSynthesisStub({
        speakMode: 'manual',
        voices: [
          { name: 'Anna2', lang: 'en-US', voiceURI: 'anna2', default: false },
          { name: 'Anna', lang: 'en-US', voiceURI: 'anna', default: false },
        ],
      })
      const provider = createBrowserLocalSpeechProvider()

      const promise = provider.synthesize!({
        type: 'tts',
        profile: { provider: 'browser-local', voice: 'anna' },
        input: { text: 'hi' },
      })
      await Promise.resolve()
      stub.utterances[0]!.onend?.()
      await promise

      // 第一个 utterance 应使用精确匹配的 Anna，而非 Anna2
      assert.strictEqual(stub.utterances[0]!.voice?.name, 'Anna')
    })

    test('voiceId 是 lang 时应按 lang 匹配', async () => {
      const stub = installSpeechSynthesisStub({
        speakMode: 'manual',
        voices: [
          { name: 'English', lang: 'en-US', voiceURI: 'en-us', default: false },
          { name: '小明', lang: 'zh-CN', voiceURI: 'zh-voice', default: false },
        ],
      })
      const provider = createBrowserLocalSpeechProvider()

      const promise = provider.synthesize!({
        type: 'tts',
        profile: { provider: 'browser-local', voice: 'zh-CN' },
        input: { text: 'hi' },
      })
      await Promise.resolve()
      stub.utterances[0]!.onend?.()
      await promise

      assert.strictEqual(stub.utterances[0]!.voice?.name, '小明')
    })

    test('voices 列表为空时不应抛错，且 lang 回退到 zh-CN', async () => {
      const stub = installSpeechSynthesisStub({ speakMode: 'manual', voices: [] })
      const provider = createBrowserLocalSpeechProvider()

      const promise = provider.synthesize!({
        type: 'tts',
        profile: { provider: 'browser-local', voice: 'anything' },
        input: { text: 'hi' },
      })
      await Promise.resolve()
      stub.utterances[0]!.onend?.()
      const result = await promise

      // pickVoice 应返回 null，utterance.voice 未被赋值，lang 应回退到 zh-CN
      assert.strictEqual(stub.utterances[0]!.voice, undefined)
      assert.strictEqual(stub.utterances[0]!.lang, 'zh-CN')
      assert.strictEqual(result.kind, 'audio')
    })
  })

  test('STT recognition.stop() 不触发 onend 时应在 5 秒后超时 resolve', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    installHangingSpeechRecognitionStub()
    const provider = createBrowserLocalSpeechProvider()

    const sessionResult = await provider.transcribe!({
      type: 'stt',
      profile: { provider: 'browser-local' },
      input: { mode: 'session-start', language: 'zh-CN' },
    })
    const session = sessionResult.metadata?.session as BrowserSpeechRecognitionSession | undefined
    assert.ok(session)

    const stopPromise = session!.stop()
    t.mock.timers.tick(5000)
    const text = await stopPromise
    assert.strictEqual(text, '')
  })
})

// Avoid unused-export warning in strict mode
void resetExternalStopFlag
