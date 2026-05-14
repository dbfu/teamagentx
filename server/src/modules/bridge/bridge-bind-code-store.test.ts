import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearBridgeBindCodesForTest,
  consumeBridgeBindCode,
  createBridgeBotBindCode,
} from './bridge-bind-code-store.js';

test('createBridgeBotBindCode creates uppercase code and consumeBridgeBindCode invalidates it', () => {
  clearBridgeBindCodesForTest();

  const created = createBridgeBotBindCode('telegram', 'bot-1', 'room-1', 60);
  assert.match(created.code, /^[A-Z0-9]{8}$/);
  assert.equal(created.expiresIn, 60);

  const consumed = consumeBridgeBindCode('telegram', created.code);
  assert.deepEqual(consumed, { platform: 'telegram', botId: 'bot-1', chatRoomId: 'room-1' });

  const consumedAgain = consumeBridgeBindCode('telegram', created.code);
  assert.equal(consumedAgain, null);
});

test('consumeBridgeBindCode rejects wrong platform and expired code', async () => {
  clearBridgeBindCodesForTest();

  const created = createBridgeBotBindCode('feishu', 'bot-2', 'room-2', 1);
  const wrongPlatform = consumeBridgeBindCode('telegram', created.code);
  assert.equal(wrongPlatform, null);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = consumeBridgeBindCode('feishu', created.code);
  assert.equal(expired, null);
});
