import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldTriggerCoordinatorAgent } from '../../../../core/agent/agent-handler/handler.js';
import { GROUP_COORDINATOR_ID } from '../../../../core/agent/system-assistant.constants.js';

test('coordinator mode lets explicit user mentions trigger the target assistant directly', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: true,
      messageIsHuman: true,
      sourceAgentId: null,
    }),
    false,
  );
});

test('coordinator mode routes assistant mentions through the coordinator', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: true,
      messageIsHuman: false,
      sourceAgentId: 'assistant-1',
    }),
    true,
  );
});

test('coordinator mode routes unmentioned messages through the coordinator', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: false,
      messageIsHuman: true,
      sourceAgentId: null,
    }),
    true,
  );
});

test('coordinator messages do not recursively trigger the coordinator', () => {
  assert.equal(
    shouldTriggerCoordinatorAgent({
      agentTriggerMode: 'coordinator',
      isQuickChatRoom: false,
      hasMentions: true,
      messageIsHuman: false,
      sourceAgentId: GROUP_COORDINATOR_ID,
    }),
    false,
  );
});
