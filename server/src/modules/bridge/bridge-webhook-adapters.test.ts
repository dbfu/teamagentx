import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_WEBHOOK_ADAPTERS,
  getBridgeWebhookAdapter,
} from './bridge-webhook-adapters.js';

test('bridge webhook adapters expose all supported platforms exactly once', () => {
  const platforms = BRIDGE_WEBHOOK_ADAPTERS.map((adapter) => adapter.platform);
  assert.deepEqual(platforms, ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']);
  assert.equal(new Set(platforms).size, platforms.length);
});

test('telegram webhook adapter parses group messages and bind commands', async () => {
  const adapter = getBridgeWebhookAdapter('telegram');

  const bindResult = await adapter.parse({
    body: {
      message: {
        message_id: 1,
        chat: { id: 123, title: 'TG Group', type: 'group' },
        text: '/bind abc123',
      },
    },
    headers: {},
    query: {},
  });

  assert.equal(bindResult.kind, 'message');
  assert.equal(bindResult.bindCode, 'ABC123');
  assert.equal(bindResult.externalId, '123');

  const chatResult = await adapter.parse({
    body: {
      message: {
        message_id: 2,
        chat: { id: 123, title: 'TG Group', type: 'group' },
        from: { first_name: 'Alice', username: 'alice' },
        text: '@teamagentx 帮我看下',
      },
    },
    headers: {},
    query: {},
  });

  assert.equal(chatResult.kind, 'message');
  assert.equal(chatResult.text, '帮我看下');
  assert.equal(chatResult.senderName, 'Alice(@alice)');
});

test('feishu webhook adapter handles challenge and event messages', async () => {
  const adapter = getBridgeWebhookAdapter('feishu');

  const challenge = await adapter.parse({
    body: { challenge: 'hello' },
    headers: {},
    query: {},
  });
  assert.equal(challenge.kind, 'challenge');
  assert.deepEqual(challenge.responseBody, { challenge: 'hello' });

  const message = await adapter.parse({
    body: {
      header: { event_id: 'evt_1' },
      event: {
        sender: { sender_id: { open_id: 'ou_123' } },
        message: {
          chat_id: 'oc_123',
          chat_type: 'group',
          content: JSON.stringify({ text: '@_user_1 帮我看下' }),
        },
      },
    },
    headers: {},
    query: {},
  });

  assert.equal(message.kind, 'message');
  assert.equal(message.dedupeKey, 'feishu:evt_1');
  assert.equal(message.text, '帮我看下');
  assert.equal(message.senderName, 'ou_123');
});

test('qq webhook adapter normalizes mentions and bind commands', async () => {
  const adapter = getBridgeWebhookAdapter('qq');

  const bind = await adapter.parse({
    body: {
      t: 'GROUP_AT_MESSAGE_CREATE',
      id: 'msg_1',
      d: { group_openid: 'group_1', content: '/bind test12' },
    },
    headers: {},
    query: {},
  });
  assert.equal(bind.kind, 'message');
  assert.equal(bind.bindCode, 'TEST12');

  const message = await adapter.parse({
    body: {
      t: 'GROUP_AT_MESSAGE_CREATE',
      id: 'msg_2',
      d: {
        group_openid: 'group_1',
        author: { member_openid: 'user_1' },
        content: '<@123> @机器人 帮我看下',
      },
    },
    headers: {},
    query: {},
  });
  assert.equal(message.kind, 'message');
  assert.equal(message.text, '帮我看下');
  assert.equal(message.senderName, 'user_1');
});
