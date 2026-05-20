import test from 'node:test'
import assert from 'node:assert/strict'

import type { LlmProvider } from '../src/lib/llm-provider-api'
import { filterRemoteTtsProviders } from '../src/lib/voice-catalog-client.ts'

function createAudioProvider(overrides: Partial<LlmProvider>): LlmProvider {
  return {
    id: 'provider-id',
    name: 'Provider',
    type: 'custom',
    modelType: 'audio',
    apiProtocol: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: 'secret',
    model: 'gpt-4o-mini-tts',
    sttModel: null,
    audioUsage: 'tts',
    imageProvider: null,
    imageApiType: null,
    isActive: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

test('filterRemoteTtsProviders should exclude non-openai audio providers', () => {
  const providers = [
    createAudioProvider({ id: 'openai-ok', apiProtocol: 'openai', audioUsage: 'tts' }),
    createAudioProvider({ id: 'anthropic-no', apiProtocol: 'anthropic', audioUsage: 'tts' }),
  ]

  const result = filterRemoteTtsProviders(providers, [])

  assert.deepStrictEqual(result.map((item) => item.id), ['openai-ok'])
})

test('filterRemoteTtsProviders should intersect with remote catalog when present', () => {
  const providers = [
    createAudioProvider({ id: 'catalog-ok' }),
    createAudioProvider({ id: 'not-in-catalog' }),
  ]

  const result = filterRemoteTtsProviders(providers, [{ llmProviderId: 'catalog-ok' }])

  assert.deepStrictEqual(result.map((item) => item.id), ['catalog-ok'])
})
