import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_PLATFORM_REGISTRY,
  getBridgePlatformDefinition,
  listBridgePlatformDefinitions,
} from './bridge-platform-registry.js';

test('bridge platform registry exposes all supported platforms exactly once', () => {
  const platforms = BRIDGE_PLATFORM_REGISTRY.map((definition) => definition.key);
  assert.deepEqual(platforms, ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']);
  assert.equal(new Set(platforms).size, platforms.length);
});

test('bridge platform definitions contain metadata required by frontend', () => {
  for (const definition of listBridgePlatformDefinitions()) {
    assert.equal(typeof definition.key, 'string');
    assert.equal(typeof definition.label, 'string');
    assert.equal(typeof definition.emoji, 'string');
    assert.equal(typeof definition.color, 'string');
    assert.equal(typeof definition.groupIdHint, 'string');
    assert.ok(Array.isArray(definition.configFields));
    assert.ok(typeof definition.supportsBindCode === 'boolean');
  }
});

test('getBridgePlatformDefinition resolves by platform key', () => {
  const telegram = getBridgePlatformDefinition('telegram');
  assert.equal(telegram.label, 'Telegram');
  assert.equal(telegram.configFields[0]?.key, 'botToken');
});
