import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, test } from 'node:test';
import { GROUP_ASSISTANT_ID } from '../../core/agent/system-assistant.constants.js';
import prisma from '../../lib/prisma.js';
import { getGroupAssistantDefinition } from '../../scripts/system-agent-definitions.js';
import { syncSystemAgent } from '../../scripts/system-agent-sync.js';
import { chatRoomService } from '../chatroom/chatroom.service.js';
import { appSettingService } from './app-setting.service.js';

async function cleanSetupData() {
  await prisma.message.deleteMany();
  await prisma.chatRoomAgent.deleteMany();
  await prisma.chatRoom.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.user.deleteMany();
  if (process.env.TEAMAGENTX_USER_FILE) {
    await fs.rm(process.env.TEAMAGENTX_USER_FILE, { force: true });
  }
}

beforeEach(async () => {
  await cleanSetupData();
  await syncSystemAgent(getGroupAssistantDefinition());
});

afterEach(cleanSetupData);

test('完成首次引导时创建并选定包含群助手欢迎消息的默认群聊', async () => {
  const result = await appSettingService.completeSetup({
    username: `setup-user-${Date.now()}`,
    password: 'test-password',
    avatar: '0',
    defaultAcpTool: 'claude',
  });

  const room = await chatRoomService.findById(result.defaultChatRoomId);
  assert.ok(room);
  assert.equal(room.name, '我的群聊');
  assert.equal(room.ownerId, result.userId);
  assert.ok(room.chatRoomAgents.some((member) => member.userId === result.userId));
  assert.ok(room.chatRoomAgents.some((member) => member.agentId === GROUP_ASSISTANT_ID));

  const messages = await prisma.message.findMany({
    where: { chatRoomId: result.defaultChatRoomId },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].agentId, GROUP_ASSISTANT_ID);
  assert.equal(messages[0].isHuman, false);
  assert.match(messages[0].content, /创建、配置和管理助手与模型/);
});
