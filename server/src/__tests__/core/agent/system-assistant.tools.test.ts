import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  AGENT_CREATOR_ID,
  GROUP_ASSISTANT_ID,
} from '../../../core/agent/system-assistant.constants.js';
import { getSystemAssistantTools } from '../../../core/agent/tools/system-assistant.tools.js';

describe('System assistant tools', () => {
  test('群助手聚合所有系统工具', () => {
    const toolNames = getSystemAssistantTools(GROUP_ASSISTANT_ID, 'room-1')
      .map((tool) => tool.name);

    assert.ok(toolNames.includes('get_room_message_detail'));
    assert.ok(toolNames.includes('get_recent_room_messages'));
    assert.ok(toolNames.includes('search_room_messages'));
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
});
