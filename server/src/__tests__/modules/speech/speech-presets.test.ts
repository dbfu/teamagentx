import { describe, test } from 'node:test';
import assert from 'node:assert';
import { resolveSpeechConfigInput } from '../../../modules/speech/speech-presets.js';

describe('speech presets', () => {
  test('应在当前配置基础上做局部覆盖，而不是重置未传字段', () => {
    const resolved = resolveSpeechConfigInput({
      currentSpeechConfig: {
        behavior: {
          enabled: true,
          outputMode: 'manual',
          autoPlay: false,
        },
        profile: {
          provider: 'browser-local',
          voice: null,
          speed: 1.2,
          volume: 0.8,
          pitch: 1.1,
          emotion: 'warm',
          style: 'gentle',
          model: null,
          fallbackProvider: null,
          format: null,
          sampleRate: null,
          temperature: null,
          prompt: 'existing prompt',
          vendorOptions: null,
        },
      },
      speechConfig: {
        behavior: {
          enabled: true,
          outputMode: 'auto_final_only',
          autoPlay: false,
        },
        profile: {
          provider: 'browser-local',
          speed: 1,
          volume: 1,
        },
      },
    });

    assert.deepStrictEqual(resolved, {
      behavior: {
        enabled: true,
        outputMode: 'auto_final_only',
        autoPlay: false,
      },
      profile: {
        provider: 'browser-local',
        model: null,
        voice: null,
        fallbackProvider: null,
        speed: 1,
        volume: 1,
        pitch: 1.1,
        emotion: 'warm',
        style: 'gentle',
        format: null,
        sampleRate: null,
        temperature: null,
        prompt: 'existing prompt',
        vendorOptions: null,
      },
      sttProfile: null,
    });
  });
});
