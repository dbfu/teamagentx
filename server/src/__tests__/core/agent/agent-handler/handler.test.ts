import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTriggerMentionNames,
  shouldTriggerCoordinatorAgent,
} from '../../../../core/agent/agent-handler/handler.js';
import {
  COORDINATOR_RECENT_HISTORY_LIMIT,
  buildCoordinatorRecentContext,
  withCoordinatorContext,
} from '../../../../core/agent/agent-handler/coordinator-context.js';
import { GROUP_COORDINATOR_ID } from '../../../../core/agent/system-assistant.constants.js';
import { roomMessageIndexService } from '../../../../modules/message/room-message-index.service.js';

const originalBuildMessageIndex = roomMessageIndexService.buildMessageIndex;

test.afterEach(() => {
  roomMessageIndexService.buildMessageIndex = originalBuildMessageIndex;
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

test('coordinator context block includes only the latest message previews and is marked reference-only', async () => {
  const history = [
    {
      kind: 'message_index' as const,
      content: '旧消息',
      preview: '旧消息',
      senderName: '产品经理',
      isHuman: false,
      messageId: 'old-message',
      time: '2026-05-28T10:00:00.000Z',
      senderType: 'agent' as const,
      attachments: [],
    },
    ...Array.from({length: COORDINATOR_RECENT_HISTORY_LIMIT}, (_, index) => ({
      kind: 'message_index' as const,
      content: `消息 ${index + 1}`,
      preview: `消息 ${index + 1}`,
      senderName: 'admin',
      isHuman: true,
      messageId: `message-${index + 1}`,
      time: `2026-05-28T10:0${index + 1}:00.000Z`,
      senderType: 'user' as const,
      attachments: [],
    })),
  ];
  const calls: Array<{chatRoomId: string; currentMessageId: string; afterMessageId?: string}> = [];

  roomMessageIndexService.buildMessageIndex = (async (chatRoomId, currentMessageId, afterMessageId) => {
    calls.push({chatRoomId, currentMessageId, afterMessageId});
    return history;
  }) as typeof roomMessageIndexService.buildMessageIndex;

  const context = await buildCoordinatorRecentContext('room-1', 'message-1');

  // 只保留最近 LIMIT 条，更早的「旧消息」被切掉
  assert.ok(!context.includes('旧消息'));
  for (let i = 1; i <= COORDINATOR_RECENT_HISTORY_LIMIT; i++) {
    assert.ok(context.includes(`消息 ${i}`));
  }
  // 含「仅供裁决参考」标注，防止调度助手转发该区块
  assert.match(context, /仅供裁决参考/);
  assert.deepEqual(calls, [
    {
      chatRoomId: 'room-1',
      currentMessageId: 'message-1',
      afterMessageId: undefined,
    },
  ]);

  // withCoordinatorContext 把上下文拼到 [待裁决消息] 之前；空上下文时原样返回
  const merged = withCoordinatorContext('请继续', context);
  assert.ok(merged.includes('[待裁决消息]'));
  assert.ok(merged.endsWith('请继续'));
  assert.equal(withCoordinatorContext('原文', ''), '原文');
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
