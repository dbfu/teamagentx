import test from 'node:test';
import assert from 'node:assert/strict';
import { findDirectReplyAgentId } from '../../../../core/agent/agent-handler/user-mention-utils.js';
import { messageService } from '../../../../modules/message/message.service.js';
import { GROUP_COORDINATOR_ID } from '../../../../core/agent/system-assistant.constants.js';
import type { Message } from '../../../../types/message.js';

const ROOM_ID = 'room-direct-reply';
const originalFindByChatRoomId = messageService.findByChatRoomId;

test.afterEach(() => {
  messageService.findByChatRoomId = originalFindByChatRoomId;
});

function mockPreviousMessage(previous: unknown) {
  messageService.findByChatRoomId = (async () =>
    (previous ? [previous] : [])) as unknown as typeof messageService.findByChatRoomId;
}

function humanReply(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-current',
    type: 'message',
    content: '好的，继续',
    time: new Date('2026-06-11T10:01:00.000Z'),
    user: 'admin',
    isHuman: true,
    chatRoomId: ROOM_ID,
    ...overrides,
  };
}

test('紧邻的上一条助手消息 @ 了发消息用户时，返回该助手 agentId', async () => {
  mockPreviousMessage({
    id: 'msg-prev',
    content: '这里需要 @admin 确认后再继续。',
    agentId: 'assistant-1',
    isHuman: false,
    chatRoomId: ROOM_ID,
  });

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply());

  assert.equal(result, 'assistant-1');
});

test('上一条助手 @ 的是另一个用户（非回复者）时返回 null', async () => {
  mockPreviousMessage({
    id: 'msg-prev',
    content: '请 @bob 看一下这个问题。',
    agentId: 'assistant-1',
    isHuman: false,
    chatRoomId: ROOM_ID,
  });

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply({ user: 'admin' }));

  assert.equal(result, null);
});

test('上一条助手消息没有 @ 任何用户时返回 null', async () => {
  mockPreviousMessage({
    id: 'msg-prev',
    content: '我已经把任务做完了。',
    agentId: 'assistant-1',
    isHuman: false,
    chatRoomId: ROOM_ID,
  });

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply());

  assert.equal(result, null);
});

test('上一条是群调度助手 @ 了发消息用户时返回 null（回落到群调度裁决，不直达执行群调度助手）', async () => {
  mockPreviousMessage({
    id: 'msg-prev',
    content: '@admin 请确认以上产品方案是否符合您的预期？',
    agentId: GROUP_COORDINATOR_ID,
    isHuman: false,
    chatRoomId: ROOM_ID,
  });

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply());

  assert.equal(result, null);
});

test('上一条是人类消息时返回 null', async () => {
  mockPreviousMessage({
    id: 'msg-prev',
    content: '@admin 你看下',
    agentId: null,
    isHuman: true,
    chatRoomId: ROOM_ID,
  });

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply());

  assert.equal(result, null);
});

test('没有上一条消息时返回 null', async () => {
  mockPreviousMessage(null);

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply());

  assert.equal(result, null);
});

test('当前消息不是人类消息时返回 null（不查询历史）', async () => {
  let queried = false;
  messageService.findByChatRoomId = (async () => {
    queried = true;
    return [];
  }) as unknown as typeof messageService.findByChatRoomId;

  const result = await findDirectReplyAgentId(
    ROOM_ID,
    humanReply({ isHuman: false, agentId: 'assistant-2', user: undefined }),
  );

  assert.equal(result, null);
  assert.equal(queried, false);
});

test('发消息用户没有用户名时返回 null（不查询历史）', async () => {
  let queried = false;
  messageService.findByChatRoomId = (async () => {
    queried = true;
    return [];
  }) as unknown as typeof messageService.findByChatRoomId;

  const result = await findDirectReplyAgentId(ROOM_ID, humanReply({ user: undefined }));

  assert.equal(result, null);
  assert.equal(queried, false);
});
