import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMentionTools,
  appendMentionBlock,
  MENTION_TOOL_NAME,
  type MentionToolContext,
  type MentionToolResult,
} from './mention.tools.js';
import {
  peekMentions,
  takeMentions,
  clearMentions,
} from '../agent-handler/mention-buffer.js';

let roomSeq = 0;

function makeCtx(
  agents: Array<{ id: string; name: string }>,
  selfAgentId: string,
): MentionToolContext {
  const byName = new Map(agents.map((a) => [a.name, a]));
  const chatRoomId = `mention-test-room-${roomSeq++}`;
  return {
    chatRoomId,
    selfAgentId,
    resolveAgent: (name) => byName.get(name.trim()) ?? null,
  };
}

async function invoke(
  bundle: ReturnType<typeof createMentionTools>,
  input: Record<string, unknown>,
): Promise<MentionToolResult> {
  const tool = bundle.tools.find((t) => t.name === MENTION_TOOL_NAME);
  assert.ok(tool, 'mention_agents tool missing');
  return (await tool.invoke(input as never)) as MentionToolResult;
}

test('登记有效目标并写入 buffer', async () => {
  const ctx = makeCtx(
    [
      { id: 'a1', name: '设计' },
      { id: 'a2', name: '前端' },
    ],
    'self',
  );
  const bundle = createMentionTools(ctx);

  const res = await invoke(bundle, {
    mentions: [
      { agent: '设计', task: '出视觉稿' },
      { agent: '前端', task: '实现交互' },
    ],
  });

  assert.equal(res.ok, true);
  assert.deepEqual(res.accepted.map((a) => a.agentId).sort(), ['a1', 'a2']);
  assert.deepEqual(
    peekMentions(ctx.chatRoomId, 'self').map((p) => p.agentId).sort(),
    ['a1', 'a2'],
  );
});

test('拒绝未知助手与 @自己', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }, { id: 'self', name: '我' }], 'self');
  const bundle = createMentionTools(ctx);

  const res = await invoke(bundle, {
    mentions: [
      { agent: '不存在', task: 'x' },
      { agent: '我', task: 'y' },
      { agent: '设计', task: 'z' },
    ],
  });

  assert.equal(res.ok, false);
  assert.deepEqual(
    res.rejected.map((r) => r.reason).sort(),
    ['self', 'unknown_agent'],
  );
  assert.deepEqual(
    peekMentions(ctx.chatRoomId, 'self').map((p) => p.agentId),
    ['a1'],
  );
});

test('多次调用并集去重，task 后写覆盖', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }, { id: 'a2', name: '前端' }], 'self');
  const bundle = createMentionTools(ctx);

  await invoke(bundle, { mentions: [{ agent: '设计', task: '初版' }] });
  await invoke(bundle, {
    mentions: [
      { agent: '前端', task: '交互' },
      { agent: '设计', task: '终版' },
    ],
  });

  const pending = peekMentions(ctx.chatRoomId, 'self');
  assert.equal(pending.length, 2);
  const design = pending.find((p) => p.agentId === 'a1');
  assert.equal(design?.task, '终版');
});

test('takeMentions 返回完整 pending 并清空 buffer', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }], 'self');
  const bundle = createMentionTools(ctx);

  await invoke(bundle, { mentions: [{ agent: '设计', task: '出视觉稿' }] });

  assert.deepEqual(takeMentions(ctx.chatRoomId, 'self'), [
    { agentId: 'a1', agentName: '设计', task: '出视觉稿' },
  ]);
  assert.equal(peekMentions(ctx.chatRoomId, 'self').length, 0);
});

test('clearMentions 清空 buffer', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }], 'self');
  const bundle = createMentionTools(ctx);
  await invoke(bundle, { mentions: [{ agent: '设计', task: 'x' }] });
  assert.equal(peekMentions(ctx.chatRoomId, 'self').length, 1);
  clearMentions(ctx.chatRoomId, 'self');
  assert.equal(peekMentions(ctx.chatRoomId, 'self').length, 0);
});

test('appendMentionBlock 生成行首 @名称 块', () => {
  const out = appendMentionBlock('我已经完成方案设计。', [
    { agentId: 'a1', agentName: '设计', task: '出视觉稿' },
    { agentId: 'a2', agentName: '前端', task: '实现交互' },
  ]);
  assert.equal(out, '我已经完成方案设计。\n\n@设计 出视觉稿\n@前端 实现交互');
});

test('appendMentionBlock 空 pending 原样返回', () => {
  assert.equal(appendMentionBlock('正文', []), '正文');
});
