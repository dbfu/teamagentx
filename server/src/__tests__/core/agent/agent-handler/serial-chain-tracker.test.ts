import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startSerialChain,
  advanceSerialChain,
  bindSerialTask,
  clearSerialChainForTask,
  markSerialUserIntervention,
  hasActiveSerialChain,
  clearSerialChain,
} from '../../../../core/agent/agent-handler/serial-chain-tracker.js';
import { tryAdvanceSerialChain } from '../../../../core/agent/coordinator-dispatch.js';
import { agentService } from '../../../../core/agent/agent.service.js';

const ctx = (id: string) => ({ triggerMessageId: id });
const assignments = (...items: Array<[string, string]>) =>
  items.map(([agentId, content]) => ({ agentId, content }));

test('serial chain advances head-by-head in order', () => {
  const roomId = 'room-serial-order-test';
  try {
    startSerialChain(
      roomId,
      assignments(['A', '先分析'], ['B', '再实现'], ['C', '最后测试']),
      ctx('trigger-1'),
      'task-A',
    );
    assert.equal(hasActiveSerialChain(roomId), true);

    // 非队首助手的消息 → none，不推进
    assert.equal(advanceSerialChain(roomId, 'C', 'task-C').kind, 'none');
    // 同一助手的其它任务也不能推进
    assert.equal(advanceSerialChain(roomId, 'A', 'task-other').kind, 'none');

    // 队首 A 完成 → 派发 B
    const afterA = advanceSerialChain(roomId, 'A', 'task-A');
    assert.equal(afterA.kind, 'next');
    assert.equal(afterA.kind === 'next' && afterA.nextAgentId, 'B');
    assert.equal(afterA.kind === 'next' && afterA.context.triggerMessageId, 'trigger-1');
    assert.equal(afterA.kind === 'next' && afterA.context.dispatchContent, '再实现');
    assert.equal(bindSerialTask(roomId, 'B', 'task-B'), true);

    // B 完成 → 派发 C
    const afterB = advanceSerialChain(roomId, 'B', 'task-B');
    assert.equal(afterB.kind, 'next');
    assert.equal(afterB.kind === 'next' && afterB.nextAgentId, 'C');
    assert.equal(afterB.kind === 'next' && afterB.context.dispatchContent, '最后测试');
    assert.equal(bindSerialTask(roomId, 'C', 'task-C'), true);

    // C（队尾）完成 → last，链清空
    assert.equal(advanceSerialChain(roomId, 'C', 'task-C').kind, 'last');
    assert.equal(hasActiveSerialChain(roomId), false);

    // 链已清空 → none
    assert.equal(advanceSerialChain(roomId, 'A', 'task-A').kind, 'none');
  } finally {
    clearSerialChain(roomId);
  }
});

test('single-target chain is not started', () => {
  const roomId = 'room-serial-single-test';
  try {
    startSerialChain(roomId, assignments(['A', '单任务']), ctx('trigger-1'), 'task-A');
    assert.equal(hasActiveSerialChain(roomId), false);
    assert.equal(advanceSerialChain(roomId, 'A', 'task-A').kind, 'none');
  } finally {
    clearSerialChain(roomId);
  }
});

test('user intervention stops auto-advancing on next head completion', () => {
  const roomId = 'room-serial-intervention-test';
  try {
    startSerialChain(
      roomId,
      assignments(['A', '任务 A'], ['B', '任务 B'], ['C', '任务 C']),
      ctx('trigger-1'),
      'task-A',
    );
    // 用户在链进行期间发言 → 接管
    markSerialUserIntervention(roomId);
    // 队首 A 完成 → 不再派发 B，静默收口并清链
    assert.equal(advanceSerialChain(roomId, 'A', 'task-A').kind, 'last_user_intervened');
    assert.equal(hasActiveSerialChain(roomId), false);

    // 无链时标记为空操作，不影响下一条链
    markSerialUserIntervention(roomId);
    startSerialChain(
      roomId,
      assignments(['A', '任务 A2'], ['B', '任务 B2']),
      ctx('trigger-2'),
      'task-A2',
    );
    assert.equal(advanceSerialChain(roomId, 'A', 'task-A2').kind, 'next');
    assert.equal(bindSerialTask(roomId, 'B', 'task-B2'), true);
    assert.equal(advanceSerialChain(roomId, 'B', 'task-B2').kind, 'last');
  } finally {
    clearSerialChain(roomId);
  }
});

test('user intervention at the tail silences the join arbitration', () => {
  const roomId = 'room-serial-tail-intervention-test';
  try {
    startSerialChain(
      roomId,
      assignments(['A', '任务 A'], ['B', '任务 B']),
      ctx('trigger-1'),
      'task-A',
    );
    assert.equal(advanceSerialChain(roomId, 'A', 'task-A').kind, 'next');
    assert.equal(bindSerialTask(roomId, 'B', 'task-B'), true);
    markSerialUserIntervention(roomId);
    // 队尾 B 完成，但用户已介入 → 静默收口而非放行协调器
    assert.equal(advanceSerialChain(roomId, 'B', 'task-B').kind, 'last_user_intervened');
    assert.equal(hasActiveSerialChain(roomId), false);
  } finally {
    clearSerialChain(roomId);
  }
});

test('starting a new chain replaces the previous one', () => {
  const roomId = 'room-serial-replace-test';
  try {
    startSerialChain(
      roomId,
      assignments(['A', '旧 A'], ['B', '旧 B'], ['C', '旧 C']),
      ctx('trigger-1'),
      'task-A',
    );
    advanceSerialChain(roomId, 'A', 'task-A'); // index → B
    // 新计划整体替换旧计划（不合并）
    startSerialChain(
      roomId,
      assignments(['X', '新 X'], ['Y', '新 Y']),
      ctx('trigger-2'),
      'task-X',
    );
    // 旧队首 B 不再属于当前链
    assert.equal(advanceSerialChain(roomId, 'B', 'task-B').kind, 'none');
    const afterX = advanceSerialChain(roomId, 'X', 'task-X');
    assert.equal(afterX.kind, 'next');
    assert.equal(afterX.kind === 'next' && afterX.nextAgentId, 'Y');
    assert.equal(afterX.kind === 'next' && afterX.context.triggerMessageId, 'trigger-2');
  } finally {
    clearSerialChain(roomId);
  }
});

test('only cancelling the current bound task clears the chain', () => {
  const roomId = 'room-serial-cancel-test';
  try {
    startSerialChain(
      roomId,
      assignments(['A', '任务 A'], ['B', '任务 B']),
      ctx('trigger-1'),
      'task-A',
    );
    assert.equal(clearSerialChainForTask(roomId, 'A', 'task-other'), false);
    assert.equal(clearSerialChainForTask(roomId, 'B', 'task-A'), false);
    assert.equal(hasActiveSerialChain(roomId), true);
    assert.equal(clearSerialChainForTask(roomId, 'A', 'task-A'), true);
    assert.equal(hasActiveSerialChain(roomId), false);
  } finally {
    clearSerialChain(roomId);
  }
});

test('failed current task terminates the serial chain without advancing', async () => {
  const roomId = 'room-serial-failure-test';
  try {
    startSerialChain(
      roomId,
      assignments(['A', '任务 A'], ['B', '任务 B']),
      ctx('trigger-1'),
      'task-A',
    );
    const result = await tryAdvanceSerialChain(
      roomId,
      'A',
      'task-A',
      'failure-message',
      'failed',
    );
    assert.equal(result, 'terminated');
    assert.equal(hasActiveSerialChain(roomId), false);
  } finally {
    clearSerialChain(roomId);
  }
});

test('lookup failure while dispatching the next step clears the chain', async () => {
  const roomId = 'room-serial-dispatch-failure-test';
  const originalFindById = agentService.findById;
  try {
    startSerialChain(
      roomId,
      assignments(['A', '任务 A'], ['B', '任务 B']),
      ctx('trigger-1'),
      'task-A',
    );
    agentService.findById = (async () => {
      throw new Error('database unavailable');
    }) as typeof agentService.findById;

    const result = await tryAdvanceSerialChain(
      roomId,
      'A',
      'task-A',
      'message-A',
      'completed',
    );
    assert.equal(result, 'terminated');
    assert.equal(hasActiveSerialChain(roomId), false);
  } finally {
    agentService.findById = originalFindById;
    clearSerialChain(roomId);
  }
});
