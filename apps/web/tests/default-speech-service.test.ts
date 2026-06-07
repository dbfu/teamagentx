import { describe, test } from 'node:test'
import assert from 'node:assert'
import { webSpeechProviderRegistry } from '../src/speech/default-service.ts'

describe('web speech provider registry', () => {
  test('应同时注册 browser-local、openai-compatible-tts 和 edge-tts', () => {
    assert.ok(webSpeechProviderRegistry.get('browser-local'))
    assert.ok(webSpeechProviderRegistry.get('openai-compatible-tts'))
    assert.ok(webSpeechProviderRegistry.get('edge-tts'))
  })
})
