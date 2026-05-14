import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import { normalizeSpeechText, speakText } from '../src/lib/browser-speech.ts'
import { webSpeechService } from '../src/speech/default-service.ts'

const originalExecute = webSpeechService.execute.bind(webSpeechService)
const originalWindow = globalThis.window

afterEach(() => {
  webSpeechService.execute = originalExecute
  if (originalWindow === undefined) {
    delete (globalThis as typeof globalThis & { window?: Window }).window
    return
  }
  globalThis.window = originalWindow
})

describe('browser speech helpers', () => {
  test('应过滤正文中的图标、emoji 和装饰性符号', () => {
    const result = normalizeSpeechText('### 📌 今日总结\n- 修复完成 ✅\n- 状态：已上线 → 请查看 @所有人')

    assert.strictEqual(result, '今日总结 修复完成 状态：已上线 请查看 所有人')
  })

  test('应过滤代码块、表格分隔和装饰线残留', () => {
    const result = normalizeSpeechText('---\n| 名称 | 状态 |\n| --- | --- |\n| 任务A | 完成 |\n```ts\nconst ok = true\n```\n请处理下一步')

    assert.strictEqual(result, '名称 状态 任务A 完成 请处理下一步')
  })

  test('应透传 agent 上下文并在存在 fallback provider 时启用回退', async () => {
    let capturedTask: Record<string, unknown> | null = null

    webSpeechService.execute = async (task) => {
      capturedTask = task as Record<string, unknown>
      return {
        kind: 'audio',
        provider: 'openai-compatible-tts',
        text: '远程播报',
      }
    }

    await speakText({
      text: '远程播报',
      provider: 'openai-compatible-tts',
      fallbackProvider: 'browser-local',
      agentId: 'agent-voice-1',
      chatRoomId: 'room-1',
      messageId: 'message-1',
      source: 'assistant-preview',
    })

    assert.ok(capturedTask)
    assert.deepStrictEqual(capturedTask?.context, {
      agentId: 'agent-voice-1',
      chatRoomId: 'room-1',
      messageId: 'message-1',
      source: 'assistant-preview',
    })
    assert.deepStrictEqual(capturedTask?.preferences, {
      allowFallback: true,
    })
  })

  test('本地播报默认语速应为 1.3', async () => {
    let capturedTask: Record<string, unknown> | null = null

    globalThis.window = {
      speechSynthesis: {
        cancel() {},
      },
    } as Window & typeof globalThis

    webSpeechService.execute = async (task) => {
      capturedTask = task as Record<string, unknown>
      return {
        kind: 'audio',
        provider: 'browser-local',
        text: '本地播报',
      }
    }

    await speakText({
      text: '本地播报',
    })

    assert.ok(capturedTask)
    assert.deepStrictEqual(capturedTask?.profile, {
      provider: 'browser-local',
      model: null,
      voice: null,
      fallbackProvider: null,
      speed: 1.3,
      volume: 1,
      pitch: null,
      emotion: null,
      style: null,
      format: null,
      sampleRate: null,
      temperature: null,
      prompt: null,
      vendorOptions: null,
    })
  })
})
