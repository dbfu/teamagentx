import { describe, test } from 'node:test';
import assert from 'node:assert';
import type { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import {
  AGENT_CREATOR_ID,
  GROUP_ASSISTANT_ID,
} from '../../../core/agent/system-assistant.constants.js';
import { getSystemAssistantTools } from '../../../core/agent/tools/system-assistant.tools.js';

describe('System assistant tools', () => {
  const schemaOf = (schema: unknown) => schema as z.ZodTypeAny;

  test('群助手聚合所有系统工具', () => {
    const toolNames = getSystemAssistantTools(GROUP_ASSISTANT_ID, 'room-1')
      .map((tool) => tool.name);

    assert.ok(toolNames.includes('get_room_message_detail'));
    assert.ok(toolNames.includes('get_recent_room_messages'));
    assert.ok(toolNames.includes('search_room_messages'));
    assert.ok(!toolNames.includes('get_chat_history'));
    assert.ok(toolNames.includes('create_agent'));
    assert.ok(toolNames.includes('create_llm_provider'));
    assert.ok(toolNames.includes('create_skill'));
    assert.ok(toolNames.includes('create_cron_task'));
    assert.ok(toolNames.includes('create_chatroom'));
    assert.ok(toolNames.includes('save_bridge_platform_config'));
  });

  test('旧系统助手只暴露房间上下文工具', () => {
    const toolNames = getSystemAssistantTools(AGENT_CREATOR_ID, 'room-1')
      .map((tool) => tool.name);

    assert.deepStrictEqual(toolNames, [
      'get_room_message_detail',
      'get_recent_room_messages',
      'search_room_messages',
    ]);
  });

  test('关闭群历史访问时不暴露房间上下文工具', () => {
    const legacyToolNames = getSystemAssistantTools(AGENT_CREATOR_ID, 'room-1', {
      includeRoomContextTools: false,
    }).map((tool) => tool.name);
    const groupToolNames = getSystemAssistantTools(GROUP_ASSISTANT_ID, 'room-1', {
      includeRoomContextTools: false,
    }).map((tool) => tool.name);

    assert.deepStrictEqual(legacyToolNames, []);
    assert.ok(!groupToolNames.includes('get_room_message_detail'));
    assert.ok(!groupToolNames.includes('get_recent_room_messages'));
    assert.ok(!groupToolNames.includes('search_room_messages'));
    assert.ok(groupToolNames.includes('create_agent'));
  });

  test('群助手创建群聊时沿用当前群主', async () => {
    const ownerId = 'system-tools-owner';
    const sourceRoomId = 'system-tools-source-room';
    await prisma.user.upsert({
      where: { id: ownerId },
      update: { username: 'system-tools-owner', password: 'password', updatedAt: new Date() },
      create: {
        id: ownerId,
        username: 'system-tools-owner',
        password: 'password',
        updatedAt: new Date(),
      },
    });
    await prisma.chatRoom.create({
      data: {
        id: sourceRoomId,
        name: '系统工具来源群',
        ownerId,
        updatedAt: new Date(),
      },
    });

    const tool = getSystemAssistantTools(GROUP_ASSISTANT_ID, sourceRoomId, {
      includeRoomContextTools: false,
    }).find((item) => item.name === 'create_chatroom');
    assert.ok(tool);

    const result = JSON.parse(String(await tool.invoke({
      name: '系统工具新群',
      description: '由群助手创建',
    })));
    assert.equal(result.success, true);

    const created = await prisma.chatRoom.findUniqueOrThrow({
      where: { id: result.chatRoom.id },
      include: { chatRoomAgents: true },
    });
    assert.equal(created.ownerId, ownerId);
    assert.ok(created.chatRoomAgents.some((item) => (
      item.userId === ownerId &&
      item.role === 'OWNER'
    )));
  });

  test('群消息查询工具参数校验', () => {
    const tools = getSystemAssistantTools(AGENT_CREATOR_ID, 'room-1');
    const recentTool = tools.find((tool) => tool.name === 'get_recent_room_messages');
    const searchTool = tools.find((tool) => tool.name === 'search_room_messages');

    assert.ok(recentTool);
    assert.ok(searchTool);
    assert.equal(schemaOf(recentTool.schema).safeParse({limit: 50, skip: 1000, order: 'asc'}).success, true);
    assert.equal(schemaOf(recentTool.schema).safeParse({limit: 50, skip: 1000, order: 'desc'}).success, true);
    assert.equal(schemaOf(recentTool.schema).safeParse({limit: 50, skip: 1001}).success, false);
    assert.equal(schemaOf(recentTool.schema).safeParse({limit: 50, order: 'latest'}).success, false);
    assert.equal(schemaOf(recentTool.schema).safeParse({limit: 51}).success, false);
    assert.equal(schemaOf(searchTool.schema).safeParse({query: '关键字', limit: 50}).success, true);
    assert.equal(schemaOf(searchTool.schema).safeParse({query: '关键字', limit: 51}).success, false);
  });
});
