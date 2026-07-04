import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notifyAgentTaskSettled,
  setAgentTaskSettledHandler,
  type AgentTaskSettledEvent,
} from '../../../../core/agent/agent-handler/task-lifecycle.js';
import {
  shouldAttemptContextCompactionAfterNoActivityRetry,
  shouldPublishFinalFailureMessage,
} from '../../../../core/agent/agent-handler/processor.js';
import {
  NoActivityTimeoutError,
} from '../../../../core/agent/agent-handler/no-activity-timeout.js';

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

test('context compaction is attempted only after no-activity retries are exhausted', () => {
  assert.equal(
    shouldAttemptContextCompactionAfterNoActivityRetry({
      error: new NoActivityTimeoutError('silent'),
      noActivityAttempt: 2,
      maxNoActivityAttempts: 3,
      compactionAttempted: false,
      canCompactContext: true,
    }),
    false,
  );

  assert.equal(
    shouldAttemptContextCompactionAfterNoActivityRetry({
      error: new NoActivityTimeoutError('silent'),
      noActivityAttempt: 3,
      maxNoActivityAttempts: 3,
      compactionAttempted: false,
      canCompactContext: true,
    }),
    true,
  );
});

test('context compaction is skipped after it already ran or executor cannot compact', () => {
  assert.equal(
    shouldAttemptContextCompactionAfterNoActivityRetry({
      error: new NoActivityTimeoutError('silent'),
      noActivityAttempt: 3,
      maxNoActivityAttempts: 3,
      compactionAttempted: true,
      canCompactContext: true,
    }),
    false,
  );

  assert.equal(
    shouldAttemptContextCompactionAfterNoActivityRetry({
      error: new Error('not no activity'),
      noActivityAttempt: 3,
      maxNoActivityAttempts: 3,
      compactionAttempted: false,
      canCompactContext: true,
    }),
    false,
  );

  assert.equal(
    shouldAttemptContextCompactionAfterNoActivityRetry({
      error: new NoActivityTimeoutError('silent'),
      noActivityAttempt: 3,
      maxNoActivityAttempts: 3,
      compactionAttempted: false,
      canCompactContext: false,
    }),
    false,
  );
});
