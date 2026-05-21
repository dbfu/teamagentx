import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearBrowserLocalVoiceSnapshots,
  getBrowserLocalVoiceSnapshot,
  pruneExpiredBrowserLocalVoiceSnapshots,
  upsertBrowserLocalVoiceSnapshot,
} from '../../../modules/speech/voice-catalog.js';

test.beforeEach(() => {
  clearBrowserLocalVoiceSnapshots();
});

test('browser local voice snapshots should be scoped by user and client', () => {
  upsertBrowserLocalVoiceSnapshot('user-a', 'client-a', [
    { id: 'voice-a', name: 'Voice A', lang: 'zh-CN', voiceURI: 'voice-a', default: true },
  ]);
  upsertBrowserLocalVoiceSnapshot('user-a', 'client-b', [
    { id: 'voice-b', name: 'Voice B', lang: 'zh-CN', voiceURI: 'voice-b', default: false },
  ]);

  assert.strictEqual(getBrowserLocalVoiceSnapshot('user-a', 'client-a')?.voices[0]?.name, 'Voice A');
  assert.strictEqual(getBrowserLocalVoiceSnapshot('user-a', 'client-b')?.voices[0]?.name, 'Voice B');
  assert.strictEqual(getBrowserLocalVoiceSnapshot('user-a', 'missing-client'), null);
});

test('expired browser local voice snapshots should be pruned', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1_000;
    upsertBrowserLocalVoiceSnapshot('user-a', 'client-a', [
      { id: 'voice-a', name: 'Voice A', lang: 'zh-CN', voiceURI: 'voice-a', default: true },
    ]);

    Date.now = () => 1_000 + 25 * 60 * 60 * 1000;
    pruneExpiredBrowserLocalVoiceSnapshots();

    assert.strictEqual(getBrowserLocalVoiceSnapshot('user-a', 'client-a'), null);
  } finally {
    Date.now = originalNow;
  }
});
