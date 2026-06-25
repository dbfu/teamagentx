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
  beginMentionExecution,
  endMentionExecution,
  peekMentionState,
  takeMentionState,
  clearMentions,
  recordMentions,
} from '../agent-handler/mention-buffer.js';

let roomSeq = 0;

function makeCtx(
  agents: Array<{ id: string; name: string }>,
  selfAgentId: string,
): MentionToolContext {
  const byName = new Map(agents.map((a) => [a.name, a]));
  const chatRoomId = `mention-test-room-${roomSeq++}`;
  beginMentionExecution(chatRoomId, selfAgentId, chatRoomId);
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
    peekMentionState(ctx.chatRoomId).mentions.map((p) => p.agentId).sort(),
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
    peekMentionState(ctx.chatRoomId).mentions.map((p) => p.agentId),
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

  const pending = peekMentionState(ctx.chatRoomId).mentions;
  assert.equal(pending.length, 2);
  const design = pending.find((p) => p.agentId === 'a1');
  assert.equal(design?.task, '终版');
});

test('单次调用记录为一个批次，默认 mode=parallel', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }, { id: 'a2', name: '前端' }], 'self');
  const bundle = createMentionTools(ctx);

  await invoke(bundle, {
    mentions: [{ agent: '设计', task: 'x' }, { agent: '前端', task: 'y' }],
  });

  const state = peekMentionState(ctx.chatRoomId);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0]?.mode, 'parallel');
  assert.deepEqual(state.batches[0]?.mentions.map((m) => m.agentId), ['a1', 'a2']);
});

test('mode=serial 写入批次', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }, { id: 'a2', name: '前端' }], 'self');

  await invoke(createMentionTools(ctx), {
    mentions: [{ agent: '设计', task: 'x' }, { agent: '前端', task: 'y' }],
    mode: 'serial',
  });

  const state = peekMentionState(ctx.chatRoomId);
  assert.equal(state.batches.length, 1);
  assert.equal(state.batches[0]?.mode, 'serial');
});

test('多次调用保留为多个有序批次，拍平并集仍去重', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }, { id: 'a2', name: '前端' }], 'self');
  const bundle = createMentionTools(ctx);

  await invoke(bundle, { mentions: [{ agent: '设计', task: '1' }] });
  await invoke(bundle, { mentions: [{ agent: '前端', task: '2' }] });

  const state = peekMentionState(ctx.chatRoomId);
  assert.equal(state.batches.length, 2);
  assert.deepEqual(state.batches[0]?.mentions.map((m) => m.agentId), ['a1']);
  assert.deepEqual(state.batches[1]?.mentions.map((m) => m.agentId), ['a2']);
  assert.deepEqual(state.mentions.map((m) => m.agentId).sort(), ['a1', 'a2']);
});

test('只有 intent 无目标的登记不产生新批次', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }], 'self');
  await invoke(createMentionTools(ctx), { mentions: [{ agent: '设计', task: 'x' }] });

  // buffer 层直接登记一个无目标、仅 intent 的调用（工具 schema 要求 min(1)，此路径走内部）。
  recordMentions(ctx.chatRoomId, 'self', [], 'parallel', '只更新意图');

  const state = peekMentionState(ctx.chatRoomId);
  assert.equal(state.batches.length, 1);
  assert.equal(state.intent, '只更新意图');
});

test('takeMentionState 返回完整 pending 并清空当前 task buffer', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }], 'self');
  const bundle = createMentionTools(ctx);

  await invoke(bundle, { mentions: [{ agent: '设计', task: '出视觉稿' }] });

  assert.deepEqual(takeMentionState(ctx.chatRoomId).mentions, [
    { agentId: 'a1', agentName: '设计', task: '出视觉稿' },
  ]);
  assert.equal(peekMentionState(ctx.chatRoomId).mentions.length, 0);
});

test('clearMentions 清空 buffer', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }], 'self');
  const bundle = createMentionTools(ctx);
  await invoke(bundle, { mentions: [{ agent: '设计', task: 'x' }] });
  assert.equal(peekMentionState(ctx.chatRoomId).mentions.length, 1);
  clearMentions(ctx.chatRoomId);
  assert.equal(peekMentionState(ctx.chatRoomId).mentions.length, 0);
});

test('intent 跟随当前 TaskQueue 执行保存', async () => {
  const ctx = makeCtx([{ id: 'a1', name: '设计' }], 'self');
  await invoke(createMentionTools(ctx), {
    mentions: [{ agent: '设计', task: '出稿' }],
    intent: '并行完成发布准备',
  });
  assert.equal(peekMentionState(ctx.chatRoomId).intent, '并行完成发布准备');
  endMentionExecution(ctx.chatRoomId, 'self', ctx.chatRoomId);
});

test('连续 TaskQueue 执行不会互相读取或清空 mention buffer', async () => {
  const chatRoomId = `mention-isolation-${roomSeq++}`;
  const agents = new Map([['设计', { id: 'a1', name: '设计' }]]);
  const ctx: MentionToolContext = {
    chatRoomId,
    selfAgentId: 'self',
    resolveAgent: (name) => agents.get(name) ?? null,
  };
  beginMentionExecution(chatRoomId, 'self', 'task-1');
  await invoke(createMentionTools(ctx), {
    mentions: [{ agent: '设计', task: '第一轮' }],
  });
  beginMentionExecution(chatRoomId, 'self', 'task-2');
  assert.equal(peekMentionState('task-2').mentions.length, 0);
  assert.equal(peekMentionState('task-1').mentions[0]?.task, '第一轮');
  endMentionExecution(chatRoomId, 'self', 'task-1');
  await invoke(createMentionTools(ctx), {
    mentions: [{ agent: '设计', task: '第二轮' }],
  });
  assert.equal(peekMentionState('task-2').mentions[0]?.task, '第二轮');
  endMentionExecution(chatRoomId, 'self', 'task-2');
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

test('叶子 mention 块明确标记为建议', () => {
  assert.equal(
    appendMentionBlock('正文', [
      { agentId: 'a1', agentName: '设计', task: '复核' },
    ], { suggestion: true }),
    '正文\n\n建议 @设计 复核',
  );
});
