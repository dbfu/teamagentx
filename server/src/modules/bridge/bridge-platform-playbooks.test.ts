import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_PLATFORM_PLAYBOOKS,
  buildBridgePlatformConfigPayload,
  getBridgePlatformPlaybook,
} from './bridge-platform-playbooks.js';

test('bridge platform playbooks cover all supported platforms with operational guidance', () => {
  const platforms = BRIDGE_PLATFORM_PLAYBOOKS.map((playbook) => playbook.platform);
  assert.deepEqual(platforms, ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']);
  assert.equal(new Set(platforms).size, platforms.length);

  for (const playbook of BRIDGE_PLATFORM_PLAYBOOKS) {
    assert.ok(playbook.prerequisites.length > 0);
    assert.ok(playbook.consoleSteps.length > 0);
    assert.ok(playbook.bindSteps.length > 0);
    assert.ok(playbook.requiredCredentials.length > 0);
  }
});

test('getBridgePlatformPlaybook resolves per-platform operational data', () => {
  const telegram = getBridgePlatformPlaybook('telegram');
  assert.equal(telegram.platform, 'telegram');
  assert.equal(telegram.requiredCredentials[0]?.key, 'botToken');

  const wecom = getBridgePlatformPlaybook('wecom');
  assert.ok(wecom.requiredCredentials.some((field) => field.key === 'corpId'));
  assert.ok(wecom.requiredCredentials.some((field) => field.key === 'agentSecret'));
});

test('buildBridgePlatformConfigPayload keeps telegram token compatible with generic config flow', () => {
  const telegramPayload = buildBridgePlatformConfigPayload('telegram', {
    botToken: 'tg-token',
  });
  assert.equal(telegramPayload.botToken, 'tg-token');
  assert.deepEqual(telegramPayload.config, { botToken: 'tg-token' });

  const feishuPayload = buildBridgePlatformConfigPayload('feishu', {
    appId: 'cli_a',
    appSecret: 'sec_a',
  });
  assert.equal(feishuPayload.botToken, undefined);
  assert.deepEqual(feishuPayload.config, { appId: 'cli_a', appSecret: 'sec_a' });
});
