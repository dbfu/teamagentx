import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert'
import { speakText } from '../src/lib/browser-speech.ts'
import { webSpeechService } from '../src/speech/default-service.ts'

const originalExecute = webSpeechService.execute.bind(webSpeechService)

afterEach(() => {
  webSpeechService.execute = originalExecute
})

describe('browser speech helpers', () => {
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
})
