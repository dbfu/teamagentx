import { describe, test } from 'node:test'
import assert from 'node:assert'
import type { Agent, Message } from '../src/lib/agent-api.ts'

describe('chat messages auto speech queue', () => {
  test('正在播放时新到的可播报消息也应先进入队列', async () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }
    globalThis.window = {
      speechSynthesis: {
        cancel() {},
      },
    } as Window & typeof globalThis

    const { prepareAutoSpeakBatch } = await import('../src/components/chat/chat-messages-list.tsx')
    const messages = [
      {
        id: 'message-2',
        chatRoomId: 'room-1',
        agentId: 'agent-1',
        isHuman: false,
        content: '新的语音播报',
      },
    ] as Message[]

    const agents = [
      {
        id: 'agent-1',
        speechConfig: {
          behavior: {
            enabled: true,
            outputMode: 'auto_final_only',
            autoPlay: true,
          },
          profile: {
            provider: 'openai-compatible-tts',
            voice: 'alloy',
            speed: 1.3,
            volume: 1,
          },
        },
      },
    ] as Agent[]

    const result = prepareAutoSpeakBatch({
      chatRoomId: 'room-1',
      messages,
      agentsList: agents,
      handledSet: new Set(),
      queuedIds: new Set(),
      deferredIds: new Set(),
      playedSet: new Set(),
      initialMessageIds: new Set(),
    })

    assert.deepStrictEqual(result.permanentlySkippedMessageIds, [])
    assert.strictEqual(result.queueItems.length, 1)
    assert.strictEqual(result.queueItems[0]?.messageId, 'message-2')
    assert.strictEqual(result.queueItems[0]?.text, '新的语音播报')
  })

  test('已播放过的消息不应再次入队', async () => {
    globalThis.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }
    globalThis.window = {
      speechSynthesis: {
        cancel() {},
      },
    } as Window & typeof globalThis

    const { prepareAutoSpeakBatch } = await import('../src/components/chat/chat-messages-list.tsx')
    const messages = [
      {
        id: 'message-3',
        chatRoomId: 'room-1',
        agentId: 'agent-1',
        isHuman: false,
        content: '重复语音',
      },
    ] as Message[]

    const agents = [
      {
        id: 'agent-1',
        speechConfig: {
          behavior: {
            enabled: true,
            outputMode: 'auto_final_only',
            autoPlay: true,
          },
          profile: {
            provider: 'openai-compatible-tts',
            voice: 'alloy',
            speed: 1.3,
            volume: 1,
          },
        },
      },
    ] as Agent[]

    const result = prepareAutoSpeakBatch({
      chatRoomId: 'room-1',
      messages,
      agentsList: agents,
      handledSet: new Set(),
      queuedIds: new Set(),
      deferredIds: new Set(),
      playedSet: new Set(['message-3']),
      initialMessageIds: new Set(),
    })

    assert.deepStrictEqual(result.permanentlySkippedMessageIds, ['message-3'])
    assert.strictEqual(result.queueItems.length, 0)
  })

  test('自动播报在已有真实播放时不应抢占起播', async () => {
    const { shouldStartAutoSpeakQueue } = await import('../src/components/chat/chat-messages-list.tsx')

    assert.strictEqual(shouldStartAutoSpeakQueue({
      queueLength: 1,
      isAutoSpeaking: false,
      activePlayingMessageId: 'manual-message-1',
    }), false)

    assert.strictEqual(shouldStartAutoSpeakQueue({
      queueLength: 1,
      isAutoSpeaking: false,
      activePlayingMessageId: null,
    }), true)
  })

  test('手动播放开始时，后续待播自动消息不应被永久挂起', async () => {
    const queuedIds = new Set<string>()
    const deferredIds = new Set<string>()
    const messages = [
      {
        id: 'message-next',
        chatRoomId: 'room-1',
        agentId: 'agent-1',
        isHuman: false,
        content: '下一条自动播报',
      },
    ] as Message[]
    const agents = [
      {
        id: 'agent-1',
        speechConfig: {
          behavior: {
            enabled: true,
            outputMode: 'auto_final_only',
            autoPlay: true,
          },
          profile: {
            provider: 'browser-local',
            voice: null,
            speed: 1.3,
            volume: 1,
          },
        },
      },
    ] as Agent[]

    const { prepareAutoSpeakBatch } = await import('../src/components/chat/chat-messages-list.tsx')
    const result = prepareAutoSpeakBatch({
      chatRoomId: 'room-1',
      messages,
      agentsList: agents,
      handledSet: new Set(),
      queuedIds,
      deferredIds,
      playedSet: new Set(),
      initialMessageIds: new Set(),
    })

    assert.strictEqual(result.queueItems.length, 1)
    assert.strictEqual(result.queueItems[0]?.messageId, 'message-next')
  })

  test('手动播放结束后，应继续扫描其后的未播自动消息（不受 initialMessageIds 影响）', async () => {
    const { getSequentialAutoSpeakItemsAfterManualMessage } = await import('../src/components/chat/chat-messages-list.tsx')

    const messages = [
      {
        id: 'message-manual',
        chatRoomId: 'room-1',
        agentId: 'agent-1',
        isHuman: false,
        content: '当前手动播放的消息',
      },
      {
        id: 'message-next',
        chatRoomId: 'room-1',
        agentId: 'agent-1',
        isHuman: false,
        content: '下一条应该续播',
      },
    ] as Message[]

    const agents = [
      {
        id: 'agent-1',
        speechConfig: {
          behavior: {
            enabled: true,
            outputMode: 'auto_final_only',
            autoPlay: true,
          },
          profile: {
            provider: 'browser-local',
            voice: null,
            speed: 1.3,
            volume: 1,
          },
        },
      },
    ] as Agent[]

    const items = getSequentialAutoSpeakItemsAfterManualMessage({
      chatRoomId: 'room-1',
      completedMessageId: 'message-manual',
      messages,
      agentsList: agents,
      queuedIds: new Set(),
      deferredIds: new Set(),
      playedSet: new Set(['message-manual']),
    })

    assert.strictEqual(items.length, 1)
    assert.strictEqual(items[0]?.messageId, 'message-next')
  })
})
