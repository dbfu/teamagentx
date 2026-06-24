import assert from 'node:assert/strict';
import test from 'node:test';

import prisma from '../../lib/prisma.js';
import {
  bindFeishuCreatorOpenId,
  bindBridgeBotToChatRoom,
  createBridgeBot,
  listBridgeBots,
  updateBridgeBot,
} from './bridge-bot-store.js';
import { decrypt } from './crypto.js';

async function createChatRoom(id: string, name: string) {
  return prisma.chatRoom.create({
    data: {
      id,
      name,
      updatedAt: new Date(),
    },
  });
}

test.beforeEach(async () => {
  await prisma.bridgeBot?.deleteMany?.();
  await prisma.chatRoom.deleteMany({
    where: {
      id: {
        in: ['room-bot-1', 'room-bot-2'],
      },
    },
  });
});

test('createBridgeBot allows multiple credential instances under the same platform', async () => {
  await createBridgeBot({
    platform: 'feishu',
    name: '飞书机器人 A',
    config: { appId: 'app-a', appSecret: 'secret-a' },
  });
  await createBridgeBot({
    platform: 'feishu',
    name: '飞书机器人 B',
    config: { appId: 'app-b', appSecret: 'secret-b' },
  });

  const bots = await listBridgeBots('feishu');

  assert.equal(bots.length, 2);
  assert.equal(bots[0]?.platform, 'feishu');
  assert.equal(bots[1]?.platform, 'feishu');
});

test('bindBridgeBotToChatRoom allows multiple bots on the same chat room', async () => {
  await createChatRoom('room-bot-1', '群聊一');

  const botA = await createBridgeBot({
    platform: 'telegram',
    name: 'TG Bot A',
    botToken: 'token-a',
  });
  const botB = await createBridgeBot({
    platform: 'telegram',
    name: 'TG Bot B',
    botToken: 'token-b',
  });

  const boundA = await bindBridgeBotToChatRoom(botA.id, 'room-bot-1');
  const boundB = await bindBridgeBotToChatRoom(botB.id, 'room-bot-1');

  const bots = await listBridgeBots('telegram');

  assert.equal(boundA.chatRoomId, 'room-bot-1');
  assert.equal(boundB.chatRoomId, 'room-bot-1');
  assert.equal(bots.filter((item) => item.chatRoomId === 'room-bot-1').length, 2);
});

test('bindBridgeBotToChatRoom supports confirmed rebind and auto-unbinds previous room', async () => {
  await createChatRoom('room-bot-1', '群聊一');
  await createChatRoom('room-bot-2', '群聊二');

  const bot = await createBridgeBot({
    platform: 'telegram',
    name: 'TG Bot A',
    botToken: 'token-a',
  });

  await bindBridgeBotToChatRoom(bot.id, 'room-bot-1');
  const rebound = await bindBridgeBotToChatRoom(bot.id, 'room-bot-2', { forceRebind: true });

  const bots = await listBridgeBots('telegram');
  const stored = bots.find((item) => item.id === bot.id);

  assert.equal(rebound.chatRoomId, 'room-bot-2');
  assert.equal(stored?.chatRoomId, 'room-bot-2');
});

test('updateBridgeBot merges partial config so unchanged secrets are preserved', async () => {
  const bot = await createBridgeBot({
    platform: 'feishu',
    name: '飞书机器人',
    config: { appId: 'app-a', appSecret: 'secret-a' },
  });

  const updated = await updateBridgeBot(bot.id, {
    config: { defaultExternalId: 'oc_default_chat' },
  });
  const storedConfig = updated.config ? JSON.parse(decrypt(updated.config)) as Record<string, unknown> : null;

  assert.deepEqual(storedConfig, {
    appId: 'app-a',
    appSecret: 'secret-a',
    defaultExternalId: 'oc_default_chat',
  });
});

test('bindFeishuCreatorOpenId only allows the first Feishu user to bind', async () => {
  const bot = await createBridgeBot({
    platform: 'feishu',
    name: '飞书机器人',
    config: { appId: 'app-a', appSecret: 'secret-a' },
  });

  const first = await bindFeishuCreatorOpenId(bot.id, 'ou_creator');
  const repeat = await bindFeishuCreatorOpenId(bot.id, 'ou_creator');
  const other = await bindFeishuCreatorOpenId(bot.id, 'ou_other');
  const stored = (await listBridgeBots('feishu')).find((item) => item.id === bot.id);

  assert.deepEqual(first, { status: 'bound', openId: 'ou_creator' });
  assert.deepEqual(repeat, { status: 'already-bound', openId: 'ou_creator' });
  assert.deepEqual(other, { status: 'bound-to-other', openId: 'ou_creator' });
  assert.equal(stored?.feishuCreatorOpenId, 'ou_creator');
});
