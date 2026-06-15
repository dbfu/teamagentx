import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notifyAgentTaskSettled,
  setAgentTaskSettledHandler,
  type AgentTaskSettledEvent,
} from '../../../../core/agent/agent-handler/task-lifecycle.js';

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
