import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAutoReturnToAssigner,
  getImmediateAssignerId,
  shouldAutoReturnToAssigner,
} from '../../../../core/agent/agent-handler/automatic-handoff.js';
import type { HandoffContext } from '../../../../types/handoff.js';

function makeContext(overrides: Partial<HandoffContext> = {}): HandoffContext {
  return {
    rootMessageId: 'root-1',
    lineage: ['owner', 'worker'],
    depth: 1,
    dispatchCount: 1,
    ...overrides,
  };
}

const baseInput = {
  handoffContext: makeContext(),
  agentId: 'worker',
  agentLevel: 'builtin',
  agentTriggerMode: 'coordinator',
  coordinatorAgentId: 'coordinator',
  suppressAssistantHandoff: false,
  isLeaf: false,
  isQuickChatRoom: false,
};

test('嵌套交接任务结束且没有后续 @ 时自动回传给直接分配者', () => {
  assert.equal(canAutoReturnToAssigner(baseInput), true);
  assert.equal(shouldAutoReturnToAssigner({
    ...baseInput,
    hasFinalMessage: true,
    finalMessageMentionsUser: false,
    pendingMentionCount: 0,
  }), true);
  assert.equal(getImmediateAssignerId(baseInput.handoffContext, baseInput.agentId), 'owner');
});

test('有后续助手、用户提问、叶子批次或已自动回传时不再回传', () => {
  const common = {
    ...baseInput,
    hasFinalMessage: true,
    finalMessageMentionsUser: false,
    pendingMentionCount: 0,
  };
  assert.equal(shouldAutoReturnToAssigner({ ...common, pendingMentionCount: 1 }), false);
  assert.equal(shouldAutoReturnToAssigner({ ...common, finalMessageMentionsUser: true }), false);
  assert.equal(shouldAutoReturnToAssigner({ ...common, isLeaf: true }), false);
  assert.equal(shouldAutoReturnToAssigner({
    ...common,
    handoffContext: makeContext({ skipAutoReturn: true }),
  }), false);
});

test('收敛者自我唤醒和根任务不会生成回传目标', () => {
  assert.equal(getImmediateAssignerId(makeContext({ lineage: ['owner', 'owner'] }), 'owner'), null);
  assert.equal(getImmediateAssignerId(makeContext({ lineage: ['worker'] }), 'worker'), null);
});
