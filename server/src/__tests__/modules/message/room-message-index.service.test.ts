import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoomHistorySection,
  buildRoomMessageIndexSection,
} from '../../../modules/message/room-message-index.service.js';

test('buildRoomHistorySection renders recent non-index history messages', () => {
  const section = buildRoomHistorySection([
    {
      kind: 'message',
      content: '这个 todolist 给谁用？A 自己用 B 团队用',
      senderName: '产品经理',
      isHuman: false,
    },
  ]);

  assert.match(section, /\[Recent Group History\]/);
  assert.match(section, /sender=产品经理/);
  assert.match(section, /senderType=agent/);
  assert.match(section, /这个 todolist 给谁用/);
});

test('buildRoomHistorySection preserves message index history format', () => {
  const history = [
    {
      kind: 'message_index',
      messageId: 'message-1',
      time: '2026-05-28T09:33:46.000Z',
      senderName: '产品经理',
      senderType: 'agent',
      isHuman: false,
      preview: '这个 todolist 给谁用？',
      content: '这个 todolist 给谁用？',
      attachments: [],
    },
  ];

  assert.equal(buildRoomHistorySection(history), buildRoomMessageIndexSection(history));
});
