import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REPLY_CONTEXT_CONTENT_CHARS,
  buildReplyContextSection,
  prependReplyContextSection,
} from '../../../../core/agent/agent-handler/reply-context.js';

test('prependReplyContextSection adds reply target metadata before current message body', () => {
  const prompt = prependReplyContextSection('好的，我继续细化。', {
    id: 'reply-target-1',
    chatRoomId: 'room-1',
    content: '请先确认这个 PRD 方案。',
    time: new Date('2026-07-01T08:00:00.000Z'),
    isHuman: false,
    agent: { name: '产品经理' },
    attachments: [{ filename: 'prd.png', type: 'image' }],
  });

  assert.match(prompt, /^\[当前消息引用\]/);
  assert.match(prompt, /replyMessageId=reply-target-1/);
  assert.match(prompt, /time=2026-07-01T08:00:00.000Z/);
  assert.match(prompt, /sender="产品经理"/);
  assert.match(prompt, /senderType=agent/);
  assert.match(prompt, /content="请先确认这个 PRD 方案。"/);
  assert.match(prompt, /attachments=\[\{"filename":"prd.png","type":"image"\}\]/);
  assert.match(prompt, /\[当前消息正文\]\n好的，我继续细化。/);
});

test('buildReplyContextSection truncates long reply target content', () => {
  const longContent = 'x'.repeat(MAX_REPLY_CONTEXT_CONTENT_CHARS + 20);
  const section = buildReplyContextSection({
    id: 'reply-target-2',
    chatRoomId: 'room-1',
    content: longContent,
    time: '2026-07-01T08:00:00.000Z',
    isHuman: true,
    user: { username: 'admin' },
  });

  assert.match(section, /sender="admin"/);
  assert.match(section, /senderType=user/);
  assert.match(section, /contentTruncated=true/);
  assert.ok(section.length < longContent.length + 400);
});
