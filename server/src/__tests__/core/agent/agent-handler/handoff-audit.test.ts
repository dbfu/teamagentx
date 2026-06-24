import test from 'node:test';
import assert from 'node:assert/strict';
import type { IAgentExecutor } from '../../../../core/agent/executor.interface.js';
import {
  HandoffAuditTimeoutError,
  buildHandoffAuditPrompt,
  createHandoffOutputBuffer,
  mergeHandoffAuditResult,
  runSilentHandoffAudit,
  shouldDeferHandoffOutput,
  shouldRunHandoffAudit,
} from '../../../../core/agent/agent-handler/handoff-audit.js';

const eligible = {
  enabled: true,
  agentTriggerMode: 'coordinator',
  agentLevel: 'business',
  agentId: 'developer',
  coordinatorAgentId: 'coordinator',
  suppressAssistantHandoff: false,
  isLeaf: false,
  isQuickChatRoom: false,
  hasFinalMessage: true,
  finalMessageMentionsUser: false,
  pendingMentionCount: 0,
};

test('只有正常完成且未登记交接的业务助手进入一次交接复核', () => {
  assert.equal(shouldDeferHandoffOutput(eligible), true);
  assert.equal(shouldRunHandoffAudit(eligible), true);

  const skippedCases = [
    { enabled: false },
    { agentTriggerMode: 'manual' },
    { agentLevel: 'system' },
    { agentId: 'coordinator' },
    { suppressAssistantHandoff: true },
    { isLeaf: true },
    { isQuickChatRoom: true },
    { hasFinalMessage: false },
    { finalMessageMentionsUser: true },
    { pendingMentionCount: 1 },
  ];
  for (const override of skippedCases) {
    assert.equal(shouldRunHandoffAudit({ ...eligible, ...override }), false);
  }

  const baseEligibility = {
    enabled: eligible.enabled,
    agentTriggerMode: eligible.agentTriggerMode,
    agentLevel: eligible.agentLevel,
    agentId: eligible.agentId,
    coordinatorAgentId: eligible.coordinatorAgentId,
    suppressAssistantHandoff: eligible.suppressAssistantHandoff,
    isLeaf: eligible.isLeaf,
    isQuickChatRoom: eligible.isQuickChatRoom,
  };
  assert.equal(shouldDeferHandoffOutput(baseEligibility), true);
  assert.equal(shouldDeferHandoffOutput({ ...eligible, agentTriggerMode: 'manual' }), false);
});

test('交接复核提示只允许调用 mention_agents，不重复正文', () => {
  const zh = buildHandoffAuditPrompt('zh-CN');
  assert.match(zh, /只做一次最终交接检查/);
  assert.match(zh, /立即调用 mention_agents/);
  assert.match(zh, /不要调用其他工具/);
  assert.match(zh, /文本回复会被丢弃/);

  const en = buildHandoffAuditPrompt('en-US');
  assert.match(en, /Perform exactly one final handoff check/);
  assert.match(en, /call mention_agents now/);
});

test('最终正文等待交接复核完成后再与交接块一起发布', async () => {
  const published: string[] = [];
  let mentionBlock = '';
  const buffer = createHandoffOutputBuffer(async (content) => {
    published.push(`${content}${mentionBlock}`);
  });

  buffer.enqueue('开发完成');
  assert.equal(buffer.latestContent, '开发完成');
  assert.equal(buffer.size, 1);
  assert.deepEqual(published, []);

  mentionBlock = '\n\n@测试助手 请进行独立验收';
  await buffer.flush();

  assert.deepEqual(published, ['开发完成\n\n@测试助手 请进行独立验收']);
  assert.equal(buffer.size, 0);
});

test('静默复核复用同一执行器、丢弃文本并保留工具事件', async () => {
  const toolCalls: string[] = [];
  const executor = {
    exec: async (
      prompt: string,
      emit: (content: string) => Promise<void>,
      _messageId: string,
      _history: unknown,
      emitStream: (content: string) => void,
      emitToolCall: (toolCall: { name: string }) => void,
      emitThinking: (content: string) => void,
      _signal: AbortSignal,
      _attachments: unknown,
      emitRecord: (content: string) => void,
    ) => {
      assert.match(prompt, /最终交接检查/);
      await emit('这段正文不应发送到群里');
      emitStream('stream');
      emitThinking('thinking');
      emitRecord('record');
      emitToolCall({ name: 'mention_agents' });
      return {
        actions: [],
        model: 'audit-model',
        tokenUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      };
    },
  } as unknown as IAgentExecutor;

  const result = await runSilentHandoffAudit({
    executor,
    prompt: buildHandoffAuditPrompt('zh-CN'),
    originalMessageId: 'message-1',
    timeoutMs: 100,
    onToolCall: (toolCall) => toolCalls.push(toolCall.name),
  });

  assert.equal(result.model, 'audit-model');
  assert.deepEqual(toolCalls, ['mention_agents']);
});

test('静默复核超时后可由 watchdog 接管', async () => {
  const executor = {
    exec: async (
      _prompt: string,
      _emit: unknown,
      _messageId: string,
      _history: unknown,
      _emitStream: unknown,
      _emitToolCall: unknown,
      _emitThinking: unknown,
      signal: AbortSignal,
    ) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  } as unknown as IAgentExecutor;

  await assert.rejects(
    runSilentHandoffAudit({
      executor,
      prompt: 'audit',
      originalMessageId: 'message-1',
      timeoutMs: 5,
    }),
    HandoffAuditTimeoutError,
  );
});

test('交接复核 token 会合并到原执行记录，但不覆盖原正文 action', () => {
  const merged = mergeHandoffAuditResult(
    {
      actions: [{ type: 'message', content: '原始正文' }],
      model: 'primary-model',
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cacheReadTokens: 4,
      },
    },
    {
      actions: [{ type: 'message', content: '隐藏复核正文' }],
      model: 'audit-model',
      tokenUsage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        cacheCreationTokens: 5,
      },
    },
  );

  assert.deepEqual(merged.actions, [{ type: 'message', content: '原始正文' }]);
  assert.equal(merged.model, 'primary-model');
  assert.deepEqual(merged.tokenUsage, {
    inputTokens: 11,
    outputTokens: 22,
    totalTokens: 33,
    cacheReadTokens: 4,
    cacheCreationTokens: 5,
  });
});
