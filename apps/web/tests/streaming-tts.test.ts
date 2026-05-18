import assert from 'node:assert'
import { describe, test } from 'node:test'

import { extractNewChunks } from '../src/speech/streaming-tts.ts'

describe('streaming tts chunk extraction', () => {
  test('应在自然句边界切块', () => {
    const text = '这是第一句已经明显超过五十个字为了触发切块逻辑并且会在句号处停下来同时保持一个完整句子的语义不被提前打断。这里还有第二句。'

    const { chunks, newPosition } = extractNewChunks(text, 0)

    assert.strictEqual(chunks.length, 1)
    assert.strictEqual(chunks[0], '这是第一句已经明显超过五十个字为了触发切块逻辑并且会在句号处停下来同时保持一个完整句子的语义不被提前打断。')
    assert.strictEqual(newPosition, chunks[0].length)
  })

  test('缺少自然句边界时不应在流式阶段硬切半句话', () => {
    const text = '这是一个用于流式语音播报的长段落'.repeat(10)

    const { chunks, newPosition } = extractNewChunks(text, 0)

    assert.deepStrictEqual(chunks, [])
    assert.strictEqual(newPosition, 0)
  })
})
