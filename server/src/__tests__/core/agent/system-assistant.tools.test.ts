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

    assert.ok(toolNames.includes('create_agent'));
    assert.ok(toolNames.includes('create_skill'));
    assert.ok(toolNames.includes('create_cron_task'));
    assert.ok(toolNames.includes('create_chatroom'));
    assert.ok(toolNames.includes('save_bridge_platform_config'));
  });

  test('旧系统助手不再暴露系统工具', () => {
    assert.deepStrictEqual(getSystemAssistantTools(AGENT_CREATOR_ID, 'room-1'), []);
  });
});
