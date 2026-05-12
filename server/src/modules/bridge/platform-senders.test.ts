import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_PLATFORM_ADAPTERS,
  registerBridgePlatformAdapters,
} from './platform-senders.js';

test('bridge platform adapters expose all supported platforms exactly once', () => {
  const platforms = BRIDGE_PLATFORM_ADAPTERS.map((adapter) => adapter.platform);
  assert.deepEqual(platforms, ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']);
  assert.equal(new Set(platforms).size, platforms.length);
});

test('registerBridgePlatformAdapters registers every adapter sender', () => {
  const registrations: Array<{ platform: string; sender: unknown }> = [];

  registerBridgePlatformAdapters({
    registerSender(platform, sender) {
      registrations.push({ platform, sender });
    },
  });

  assert.equal(registrations.length, BRIDGE_PLATFORM_ADAPTERS.length);
  assert.deepEqual(
    registrations.map((item) => item.platform),
    BRIDGE_PLATFORM_ADAPTERS.map((adapter) => adapter.platform),
  );
  for (const item of registrations) {
    assert.equal(typeof item.sender, 'function');
  }
});
