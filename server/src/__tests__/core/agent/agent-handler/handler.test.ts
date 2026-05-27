import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COORDINATOR_RECENT_HISTORY_LIMIT,
  buildCoordinatorDispatchOptions,
  getTriggerMentionNames,
  shouldTriggerCoordinatorAgent,
} from '../../../../core/agent/agent-handler/handler.js';
import { GROUP_COORDINATOR_ID } from '../../../../core/agent/system-assistant.constants.js';
import { agentMemoryService } from '../../../../modules/agent-memory/agent-memory.service.js';

const originalBuildRecentHistory = agentMemoryService.buildRecentHistory;

test.afterEach(() => {
  agentMemoryService.buildRecentHistory = originalBuildRecentHistory;
});

test('coordinator mode lets explicit user mentions trigger the target assistant directly', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: true,
      messageIsHuman: true,
      sourceAgentId: null,
    }),
    false,
  );
});

test('coordinator mode routes assistant mentions through the coordinator', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: true,
      messageIsHuman: false,
      sourceAgentId: 'assistant-1',
    }),
    true,
  );
});

test('coordinator mode routes unmentioned messages through the coordinator', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: false,
      messageIsHuman: true,
      sourceAgentId: null,
    }),
    true,
  );
});

test('coordinator dispatch includes short recent history for routing context', async () => {
  const history = [
    {
      kind: 'message' as const,
      content: '产品给谁用？A 内部 B 垂直 C 大众',
      senderName: '产品经理',
      isHuman: false,
    },
  ];
  const calls: Array<{chatRoomId: string; currentMessageId: string; take: number}> = [];

  agentMemoryService.buildRecentHistory = (async (chatRoomId, currentMessageId, take) => {
    calls.push({chatRoomId, currentMessageId, take: take ?? 0});
    return history;
  }) as typeof agentMemoryService.buildRecentHistory;

  const options = await buildCoordinatorDispatchOptions('room-1', 'message-1');

  assert.deepEqual(options, {history});
  assert.deepEqual(calls, [
    {
      chatRoomId: 'room-1',
      currentMessageId: 'message-1',
      take: COORDINATOR_RECENT_HISTORY_LIMIT,
    },
  ]);
});

test('coordinator messages do not recursively trigger the coordinator', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: true,
      messageIsHuman: false,
      sourceAgentId: GROUP_COORDINATOR_ID,
    }),
    false,
  );
});

test('coordinator mode lets only the internal coordinator trigger multiple mentions', () => {
  assert.deepEqual(
    getTriggerMentionNames({
      agentTriggerMode: 'coordinator',
      sourceAgentId: GROUP_COORDINATOR_ID,
      mentionNames: ['工程师', '测试员', '文档员'],
    }),
    ['工程师', '测试员', '文档员'],
  );

  assert.deepEqual(
    getTriggerMentionNames({
      agentTriggerMode: 'coordinator',
      sourceAgentId: 'assistant-1',
      mentionNames: ['工程师', '测试员'],
    }),
    ['工程师'],
  );

  assert.deepEqual(
    getTriggerMentionNames({
      agentTriggerMode: 'auto',
      sourceAgentId: GROUP_COORDINATOR_ID,
      mentionNames: ['工程师', '测试员'],
    }),
    ['工程师'],
  );
});
