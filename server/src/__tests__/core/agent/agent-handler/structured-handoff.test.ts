import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../../../config/index.js';
import {
  advanceHandoffContext,
  createRootHandoffContext,
} from '../../../../types/handoff.js';
import type { Message } from '../../../../types/message.js';
import {
  clearStructuredHandoffRuntime,
  completeStructuredHandoffBranch,
  markStructuredHandoffUserIntervention,
  reserveHandoffDispatches,
  startStructuredHandoffBatch,
} from '../../../../core/agent/agent-handler/structured-handoff-runtime.js';
import {
  buildConvergencePrompt,
  evaluateHandoffTargetGuardrail,
} from '../../../../core/agent/agent-handler/structured-handoff.service.js';

const sourceMessage: Message = {
  id: 'message-root',
  type: 'reply',
  content: '开始并行处理',
  time: new Date(),
  agentId: 'owner',
  agentName: '负责人',
  chatRoomId: 'room-1',
  isHuman: false,
};

test.afterEach(() => {
  clearStructuredHandoffRuntime();
});

test('结构化级联预算按 rootMessageId 在并行分支间共享', () => {
  const context = createRootHandoffContext('root-1', 'owner');
  assert.deepEqual(reserveHandoffDispatches(context, 2, 3), {
    ok: true,
    dispatchCount: 2,
  });
  const branchContext = advanceHandoffContext(context, 'branch-a', { dispatchCount: 2 });
  assert.deepEqual(reserveHandoffDispatches(branchContext, 1, 3), {
    ok: true,
    dispatchCount: 3,
  });
  assert.deepEqual(reserveHandoffDispatches(branchContext, 1, 3), {
    ok: false,
    dispatchCount: 3,
  });
});

test('多目标叶子全部完成后只返回一次汇合批次', () => {
  const ownerContext = createRootHandoffContext('root-2', 'owner');
  startStructuredHandoffBatch({
    id: 'batch-1',
    chatRoomId: 'room-1',
    rootMessageId: 'root-2',
    ownerAgentId: 'owner',
    ownerAgentName: '负责人',
    ownerContext,
    sourceMessage,
    pendingAgentIds: new Set(['a', 'b']),
    results: [],
    userIntervened: false,
  });
  assert.equal(completeStructuredHandoffBranch('batch-1', {
    agentId: 'a',
    agentName: 'A',
    status: 'completed',
    finalMessage: { ...sourceMessage, id: 'a-result', agentId: 'a', agentName: 'A' },
    suggestions: [],
  }).kind, 'waiting');
  const completed = completeStructuredHandoffBranch('batch-1', {
    agentId: 'b',
    agentName: 'B',
    status: 'completed',
    finalMessage: { ...sourceMessage, id: 'b-result', agentId: 'b', agentName: 'B' },
    suggestions: [{ agentId: 'c', agentName: 'C', task: '复核结果' }],
  });
  assert.equal(completed.kind, 'ready');
  if (completed.kind !== 'ready') return;
  assert.match(buildConvergencePrompt(completed.batch), /分支建议：\n- @C 复核结果/);
  assert.equal(completeStructuredHandoffBranch('batch-1', {
    agentId: 'b', agentName: 'B', status: 'completed', suggestions: [],
  }).kind, 'none');
});

test('用户介入会让结构化批次静默收口', () => {
  const ownerContext = createRootHandoffContext('root-3', 'owner');
  startStructuredHandoffBatch({
    id: 'batch-user',
    chatRoomId: 'room-1',
    rootMessageId: 'root-3',
    ownerAgentId: 'owner',
    ownerAgentName: '负责人',
    ownerContext,
    sourceMessage,
    pendingAgentIds: new Set(['a']),
    results: [],
    userIntervened: false,
  });
  markStructuredHandoffUserIntervention('room-1');
  assert.equal(completeStructuredHandoffBranch('batch-user', {
    agentId: 'a', agentName: 'A', status: 'completed', suggestions: [],
  }).kind, 'silenced');
});

test('血缘重访与 depth 护栏按配置裁决', () => {
  const oldDepth = config.agent.handoffDepthMax;
  const oldRevisit = config.agent.handoffRevisitMax;
  config.agent.handoffDepthMax = 2;
  config.agent.handoffRevisitMax = 1;
  try {
    const context = {
      rootMessageId: 'root-4',
      lineage: ['a', 'b', 'a'],
      depth: 2,
      dispatchCount: 2,
    };
    assert.equal(evaluateHandoffTargetGuardrail(context, 'c'), 'depth');
    config.agent.handoffDepthMax = 100;
    assert.equal(evaluateHandoffTargetGuardrail(context, 'a'), 'revisit');
    assert.equal(evaluateHandoffTargetGuardrail(context, 'c'), null);
  } finally {
    config.agent.handoffDepthMax = oldDepth;
    config.agent.handoffRevisitMax = oldRevisit;
  }
});
