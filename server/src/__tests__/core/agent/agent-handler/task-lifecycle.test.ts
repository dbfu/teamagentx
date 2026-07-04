import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notifyAgentTaskSettled,
  setAgentTaskSettledHandler,
  type AgentTaskSettledEvent,
} from '../../../../core/agent/agent-handler/task-lifecycle.js';
import {
  shouldPublishFinalFailureMessage,
} from '../../../../core/agent/agent-handler/processor.js';

test.afterEach(() => {
  setAgentTaskSettledHandler(null);
});

test('task lifecycle notification awaits the registered handler', async () => {
  const received: AgentTaskSettledEvent[] = [];
  setAgentTaskSettledHandler(async (event) => {
    await Promise.resolve();
    received.push(event);
  });

  const event: AgentTaskSettledEvent = {
    chatRoomId: 'room-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    status: 'completed',
  };
  await notifyAgentTaskSettled(event);

  assert.deepEqual(received, [event]);
});

test('final failure message is published when fallback is enabled', () => {
  assert.equal(
    shouldPublishFinalFailureMessage({
      shouldUseModelFallback: true,
      generatedMessageCount: 1,
    }),
    true,
  );
});

test('final failure message is published without fallback when nothing was emitted', () => {
  assert.equal(
    shouldPublishFinalFailureMessage({
      shouldUseModelFallback: false,
      generatedMessageCount: 0,
    }),
    true,
  );
});

test('final failure message is not duplicated when executor already emitted one', () => {
  assert.equal(
    shouldPublishFinalFailureMessage({
      shouldUseModelFallback: false,
      generatedMessageCount: 1,
    }),
    false,
  );
});
