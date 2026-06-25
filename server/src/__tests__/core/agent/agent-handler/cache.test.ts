import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abortControllers,
  abortLocales,
  clearAllExecutionState,
  stopAgentExecution,
} from '../../../../core/agent/agent-handler/cache.js';

describe('agent execution cancellation cache', () => {
  afterEach(() => {
    clearAllExecutionState();
  });

  test('keeps aborted controller until processor cleanup so repeated stop is idempotent', () => {
    const chatRoomId = 'room-stop-idempotent';
    const agentId = 'agent-stop-idempotent';
    const key = `${chatRoomId}_${agentId}`;
    const controller = new AbortController();
    abortControllers.set(key, controller);

    assert.equal(stopAgentExecution(chatRoomId, agentId, 'zh-CN'), true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(abortControllers.get(key), controller);
    assert.equal(abortLocales.get(key), 'zh-CN');

    assert.equal(stopAgentExecution(chatRoomId, agentId, 'en-US'), true);
    assert.equal(abortControllers.get(key), controller);
    assert.equal(abortLocales.get(key), 'en-US');
  });

  test('returns false when no running execution exists', () => {
    assert.equal(stopAgentExecution('missing-room', 'missing-agent'), false);
  });
});
