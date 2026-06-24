import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTriggerMode,
  isSmartCollaborationMode,
} from '../../../../core/agent/agent-handler/trigger-mode.js';
import {
  startParallelBatch,
  markBatchAgentComplete,
  markBatchUserIntervention,
  hasActiveParallelBatch,
  clearParallelBatch,
} from '../../../../core/agent/agent-handler/parallel-batch-tracker.js';
import {
  cancelStallWatchdog,
  clearStallWatchdogTimer,
  checkAndClearInterrupted,
  scheduleStallWatchdog,
} from '../../../../core/agent/agent-handler/stall-watchdog.js';
import {
  COORDINATOR_RECENT_HISTORY_LIMIT,
  buildCoordinatorRecentContext,
  withCoordinatorContext,
} from '../../../../core/agent/agent-handler/coordinator-context.js';
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

test('trigger mode normalization maps legacy auto to smart collaboration', () => {
  assert.equal(normalizeTriggerMode('auto'), 'coordinator');
  assert.equal(normalizeTriggerMode('coordinator'), 'coordinator');
  assert.equal(normalizeTriggerMode(undefined), 'coordinator');
  assert.equal(normalizeTriggerMode('manual'), 'manual');
  assert.equal(isSmartCollaborationMode('auto'), true);
  assert.equal(isSmartCollaborationMode('manual'), false);
});

test('parallel batch merges concurrent dispatches instead of overwriting', () => {
  const roomId = 'room-batch-merge-test';
  try {
    startParallelBatch(roomId, ['B', 'C']);
    assert.equal(hasActiveParallelBatch(roomId), true);
    // 批次进行中又开新批次 → 合并，不覆盖
    startParallelBatch(roomId, ['D', 'E']);
    assert.equal(markBatchAgentComplete(roomId, 'B'), 'pending');
    assert.equal(markBatchAgentComplete(roomId, 'C'), 'pending');
    assert.equal(markBatchAgentComplete(roomId, 'D'), 'pending');
    assert.equal(markBatchAgentComplete(roomId, 'E'), 'last');
    assert.equal(hasActiveParallelBatch(roomId), false);
    // 不在批次里 → none
    assert.equal(markBatchAgentComplete(roomId, 'B'), 'none');
  } finally {
    clearParallelBatch(roomId);
  }
});

test('user intervention during a batch silences the join arbitration', () => {
  const roomId = 'room-batch-intervention-test';
  try {
    startParallelBatch(roomId, ['B', 'C']);
    // 用户在批次期间发言 → 接管：join 不再自动派发
    markBatchUserIntervention(roomId);
    assert.equal(markBatchAgentComplete(roomId, 'B'), 'pending');
    assert.equal(markBatchAgentComplete(roomId, 'C'), 'last_user_intervened');
    assert.equal(hasActiveParallelBatch(roomId), false);
    // 无批次时标记为空操作，不影响下一个批次
    markBatchUserIntervention(roomId);
    startParallelBatch(roomId, ['B', 'C']);
    assert.equal(markBatchAgentComplete(roomId, 'B'), 'pending');
    assert.equal(markBatchAgentComplete(roomId, 'C'), 'last');
  } finally {
    clearParallelBatch(roomId);
  }
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

test('smart-mode stall watchdog skips when the latest assistant message mentions a room user', async () => {
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

test('clearing a stall watchdog timer prevents a duplicate coordinator wake-up', async () => {
  const roomId = 'room-watchdog-clear-test';
  const originalDelay = config.agent.stallWatchdogDelayMs;
  let roomLookupCount = 0;
  config.agent.stallWatchdogDelayMs = 10;
  chatRoomService.findById = (async () => {
    roomLookupCount += 1;
    return null;
  }) as typeof chatRoomService.findById;

  try {
    scheduleStallWatchdog(roomId);
    assert.equal(clearStallWatchdogTimer(roomId), true);
    assert.equal(clearStallWatchdogTimer(roomId), false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(roomLookupCount, 0);
  } finally {
    config.agent.stallWatchdogDelayMs = originalDelay;
    clearStallWatchdogTimer(roomId);
  }
});
