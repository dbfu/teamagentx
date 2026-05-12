import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_INBOUND_TEXT_ADAPTERS,
  extractBindCode,
  getBridgeInboundTextAdapter,
} from './platform-inbound-adapters.js';

test('bridge inbound adapters expose all supported platforms exactly once', () => {
  const platforms = BRIDGE_INBOUND_TEXT_ADAPTERS.map((adapter) => adapter.platform);
  assert.deepEqual(platforms, ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']);
  assert.equal(new Set(platforms).size, platforms.length);
});

test('extractBindCode returns normalized uppercase code from bind commands', () => {
  assert.equal(extractBindCode('/bind abc123'), 'ABC123');
  assert.equal(extractBindCode('/bind 7f9kLm2q'), '7F9KLM2Q');
  assert.equal(extractBindCode(' /bind abc123 '), 'ABC123');
  assert.equal(extractBindCode('hello /bind abc123'), null);
});

test('inbound adapters normalize platform-specific mention syntax', () => {
  assert.equal(getBridgeInboundTextAdapter('telegram').normalizeText('@teamagentx 帮我看下'), '帮我看下');
  assert.equal(getBridgeInboundTextAdapter('feishu').normalizeText('@_user_1 帮我看下'), '帮我看下');
  assert.equal(getBridgeInboundTextAdapter('dingtalk').normalizeText('@机器人 帮我看下'), '帮我看下');
  assert.equal(getBridgeInboundTextAdapter('wecom').normalizeText('@机器人 帮我看下'), '帮我看下');
  assert.equal(getBridgeInboundTextAdapter('qq').normalizeText('<@123> @机器人 帮我看下'), '帮我看下');
});

test('inbound adapters extract bind code from normalized text', () => {
  assert.equal(getBridgeInboundTextAdapter('telegram').extractBindCode('/bind test12'), 'TEST12');
  assert.equal(getBridgeInboundTextAdapter('qq').extractBindCode('/bind test12'), 'TEST12');
});
