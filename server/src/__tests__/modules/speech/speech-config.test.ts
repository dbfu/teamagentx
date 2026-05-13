import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  createDefaultAgentSpeechConfig,
  normalizeAgentSpeechConfig,
} from '../../../modules/speech/speech-config.js';

describe('speech config helpers', () => {
  test('应把不完整 speechConfig 补齐默认值', () => {
    const result = normalizeAgentSpeechConfig({
      behavior: {
        enabled: true,
        outputMode: 'manual',
      },
      profile: {
        voice: 'voice-1',
      },
    });

    assert.deepStrictEqual(result, {
      behavior: {
        enabled: true,
        outputMode: 'manual',
        autoPlay: false,
      },
      profile: {
        provider: 'browser-local',
        model: null,
        voice: 'voice-1',
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
      },
    });
  });

  test('默认 speechConfig 应可直接用于新助手', () => {
    assert.deepStrictEqual(createDefaultAgentSpeechConfig(), {
      behavior: {
        enabled: false,
        outputMode: 'off',
        autoPlay: false,
      },
      profile: {
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
      },
    });
  });
});
