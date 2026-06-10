import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTriggerMentionNames,
  shouldTriggerCoordinatorAgent,
} from '../../../../core/agent/agent-handler/handler.js';
import {
  cancelStallWatchdog,
  checkAndClearInterrupted,
  scheduleStallWatchdog,
} from '../../../../core/agent/agent-handler/stall-watchdog.js';
import {
  COORDINATOR_RECENT_HISTORY_LIMIT,
  buildCoordinatorRecentContext,
  withCoordinatorContext,
} from '../../../../core/agent/agent-handler/coordinator-context.js';
import { GROUP_COORDINATOR_ID } from '../../../../core/agent/system-assistant.constants.js';
import { config } from '../../../../config/index.js';
import { chatRoomService } from '../../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../../modules/message/message.service.js';
import { roomMessageIndexService } from '../../../../modules/message/room-message-index.service.js';
import { taskQueueService } from '../../../../modules/task-queue/task-queue.service.js';
import { agentService } from '../../../../core/agent/agent.service.js';

const originalBuildMessageIndex = roomMessageIndexService.buildMessageIndex;
const originalStallWatchdogDelayMs = config.agent.stallWatchdogDelayMs;
const originalFindChatRoomById = chatRoomService.findById;
const originalGetUserMembers = chatRoomService.getUserMembers;
const originalFindMessagesByChatRoomId = messageService.findByChatRoomId;
const originalGetActiveTasks = taskQueueService.getActiveTasks;
const originalFindAgentById = agentService.findById;
const WATCHDOG_USER_MENTION_ROOM_ID = 'room-watchdog-user-mention';

test.afterEach(() => {
  roomMessageIndexService.buildMessageIndex = originalBuildMessageIndex;
  config.agent.stallWatchdogDelayMs = originalStallWatchdogDelayMs;
  chatRoomService.findById = originalFindChatRoomById;
  chatRoomService.getUserMembers = originalGetUserMembers;
  messageService.findByChatRoomId = originalFindMessagesByChatRoomId;
  taskQueueService.getActiveTasks = originalGetActiveTasks;
  agentService.findById = originalFindAgentById;
  cancelStallWatchdog(WATCHDOG_USER_MENTION_ROOM_ID);
  checkAndClearInterrupted(WATCHDOG_USER_MENTION_ROOM_ID);
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

  // withCoordinatorContext 把上下文拼到 [待裁决消息] 之后；空上下文时原样返回
  const merged = withCoordinatorContext('请继续', context);
  assert.ok(merged.includes('[待裁决消息]'));
  assert.ok(merged.startsWith('[待裁决消息]\n请继续'));
  assert.ok(merged.includes(context));
  assert.equal(withCoordinatorContext('原文', ''), '[待裁决消息]\n原文');
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

test('auto stall watchdog skips when the latest assistant message mentions a room user', async () => {
  let coordinatorLookups = 0;

  config.agent.stallWatchdogDelayMs = 1;
  chatRoomService.findById = (async () => ({
    id: WATCHDOG_USER_MENTION_ROOM_ID,
    agentTriggerMode: 'auto',
    isQuickChatRoom: false,
  })) as unknown as typeof chatRoomService.findById;
  taskQueueService.getActiveTasks = (async () => []) as typeof taskQueueService.getActiveTasks;
  messageService.findByChatRoomId = (async () => [
    {
      id: 'last-message',
      type: 'REPLY',
      content: '这里需要 @admin 确认后再继续。',
      time: new Date('2026-06-09T10:00:00.000Z'),
      agentId: 'assistant-1',
      agent: {
        name: '工程师',
        avatar: null,
        avatarColor: null,
      },
      chatRoomId: WATCHDOG_USER_MENTION_ROOM_ID,
      replyMessageId: null,
      isHuman: false,
    },
  ]) as unknown as typeof messageService.findByChatRoomId;
  chatRoomService.getUserMembers = (async () => [
    { user: { username: 'admin' } },
  ]) as unknown as typeof chatRoomService.getUserMembers;
  agentService.findById = (async () => {
    coordinatorLookups += 1;
    return null;
  }) as typeof agentService.findById;

  scheduleStallWatchdog(WATCHDOG_USER_MENTION_ROOM_ID);
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(coordinatorLookups, 0);
});
