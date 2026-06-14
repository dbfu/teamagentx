import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  broadcastAgentJoinedMessage,
  broadcastChatRoomRulesUpdatedMessage,
  buildChatRoomRulesUpdatedMessageContent,
  parseKnownMentions,
} from '../../../core/agent/agent-handler/message-utils.js';
import { setGlobalBroadcastMessage } from '../../../core/agent/agent-handler/status.js';
import { messageService } from '../../../modules/message/message.service.js';

const originalMessageCreate = messageService.create;

afterEach(() => {
  messageService.create = originalMessageCreate;
  setGlobalBroadcastMessage(null);
});

test('parseKnownMentions matches agent names containing slashes', () => {
  const mentions = parseKnownMentions('@Codex/CLI 帮我看一下', [
    'Codex/CLI',
    'Codex',
  ]);

  assert.deepStrictEqual(mentions, ['Codex/CLI']);
});

test('parseKnownMentions treats regex characters in agent names literally', () => {
  const mentions = parseKnownMentions('@Agent.(A)/v2? 修复', [
    'Agent.(A)/v2?',
  ]);

  assert.deepStrictEqual(mentions, ['Agent.(A)/v2?']);
});

test('parseKnownMentions does not partially match shorter agent names', () => {
  const mentions = parseKnownMentions('@Alpha/Beta 继续', [
    'Alpha',
    'Alpha/Beta',
  ]);

  assert.deepStrictEqual(mentions, ['Alpha/Beta']);
});

test('parseKnownMentions ignores inline mentions after punctuation', () => {
  const mentions = parseKnownMentions(
    '遵旨。臣先传内阁首辅周大人上朝奏对。@内阁首辅·周延儒 首辅周大人，早朝已启。',
    ['内阁首辅·周延儒'],
  );

  assert.deepStrictEqual(mentions, []);
});

test('parseKnownMentions matches inline mentions after a space', () => {
  const mentions = parseKnownMentions(
    '遵旨。臣先传内阁首辅周大人上朝奏对。 @内阁首辅·周延儒 首辅周大人，早朝已启。',
    ['内阁首辅·周延儒'],
  );

  assert.deepStrictEqual(mentions, ['内阁首辅·周延儒']);
});

test('parseKnownMentions matches mentions at the start of a new line', () => {
  const mentions = parseKnownMentions('请处理下一步：\n@Codex/CLI 继续', [
    'Codex/CLI',
  ]);

  assert.deepStrictEqual(mentions, ['Codex/CLI']);
});

test('parseKnownMentions can match inline mentions when enabled', () => {
  const mentions = parseKnownMentions('请@Codex/CLI 继续', ['Codex/CLI'], {
    allowInline: true,
  });

  assert.deepStrictEqual(mentions, ['Codex/CLI']);
});

test('parseKnownMentions keeps inline mentions as plain text by default', () => {
  const mentions = parseKnownMentions('请@Codex/CLI 继续', ['Codex/CLI']);

  assert.deepStrictEqual(mentions, []);
});

test('parseKnownMentions ignores mentions inside fenced code blocks', () => {
  const content = [
    '已为群聊生成群调度规则，结果如下：',
    '```yaml',
    'constraints:',
    '  - 涉及项目立项、签约决策等关键节点，必须 @admin 确认',
    '```',
    '如需调整请告诉我。',
  ].join('\n');

  const mentions = parseKnownMentions(content, ['admin'], { allowInline: true });

  assert.deepStrictEqual(mentions, []);
});

test('parseKnownMentions still matches real mentions outside code blocks', () => {
  const content = [
    '@admin 请确认下面的配置：',
    '```yaml',
    'owner: @admin',
    '```',
  ].join('\n');

  const mentions = parseKnownMentions(content, ['admin'], { allowInline: true });

  assert.deepStrictEqual(mentions, ['admin']);
});

test('buildChatRoomRulesUpdatedMessageContent includes updated rules', () => {
  const content = buildChatRoomRulesUpdatedMessageContent('所有回复使用中文');

  assert.match(content, /群规则已更新/);
  assert.match(content, /请所有助手从现在开始使用新的群规则/);
  assert.match(content, /所有回复使用中文/);
});

test('buildChatRoomRulesUpdatedMessageContent handles cleared rules', () => {
  const content = buildChatRoomRulesUpdatedMessageContent('');

  assert.match(content, /群规则已清空/);
  assert.match(content, /不再沿用旧群规则/);
});

test('broadcastChatRoomRulesUpdatedMessage saves and broadcasts without agent dispatch', async () => {
  let created: any;
  const broadcasts: any[] = [];

  messageService.create = (async (data) => {
    created = data;
    return data as any;
  }) as typeof messageService.create;
  setGlobalBroadcastMessage((message, chatRoomId) => {
    broadcasts.push({ message, chatRoomId });
  });

  const messageId = await broadcastChatRoomRulesUpdatedMessage('room-1', '新的规则');

  assert.equal(created.id, messageId);
  assert.equal(created.chatRoomId, 'room-1');
  assert.equal(created.userId, null);
  assert.equal(created.agentId, null);
  assert.equal(created.isHuman, true);
  assert.match(created.content, /新的规则/);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].chatRoomId, 'room-1');
  assert.equal(broadcasts[0].message.id, messageId);
  assert.equal(broadcasts[0].message.user, '系统');
});

test('broadcastAgentJoinedMessage saves and broadcasts without agent dispatch', async () => {
  let created: any;
  const broadcasts: any[] = [];

  messageService.create = (async (data) => {
    created = data;
    return data as any;
  }) as typeof messageService.create;
  setGlobalBroadcastMessage((message, chatRoomId) => {
    broadcasts.push({ message, chatRoomId });
  });

  const messageId = await broadcastAgentJoinedMessage('room-1', '前端开发', '处理前端任务');

  assert.equal(created.id, messageId);
  assert.equal(created.chatRoomId, 'room-1');
  assert.equal(created.userId, null);
  assert.equal(created.agentId, null);
  assert.equal(created.isHuman, true);
  assert.match(created.content, /新助手加入群聊/);
  assert.match(created.content, /前端开发/);
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].chatRoomId, 'room-1');
  assert.equal(broadcasts[0].message.id, messageId);
  assert.equal(broadcasts[0].message.user, '系统');
});
