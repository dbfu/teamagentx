import { strict as assert } from 'assert';
import { describe, test } from 'node:test';
import { __claudeSdkTestUtils } from '../../../core/agent/claude-sdk.executor.js';

describe('ClaudeAgentSdkExecutor background idle finish', () => {
  test('uses a conservative default background idle finish timeout', () => {
    const originalValue = process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;
    delete process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;

    try {
      assert.equal(__claudeSdkTestUtils.getBackgroundIdleFinishMs(), 60 * 1000);
    } finally {
      if (originalValue === undefined) {
        delete process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;
      } else {
        process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS = originalValue;
      }
    }
  });

  test('allows overriding the background idle finish timeout', () => {
    const originalValue = process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;
    process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS = '90000';

    try {
      assert.equal(__claudeSdkTestUtils.getBackgroundIdleFinishMs(), 90 * 1000);
    } finally {
      if (originalValue === undefined) {
        delete process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS;
      } else {
        process.env.CLAUDE_AGENT_BACKGROUND_IDLE_FINISH_MS = originalValue;
      }
    }
  });

  test('finishes idle backgrounded commands even before final assistant text', () => {
    assert.equal(
      __claudeSdkTestUtils.shouldApplyBackgroundIdleFinish({
        hasBackgroundedLongRunningCommand: true,
        waitingForTaskOutput: false,
        waitingForAssistantAfterToolResult: false,
      }),
      true,
    );
  });

  test('does not finish while waiting for task output or assistant follow-up', () => {
    assert.equal(
      __claudeSdkTestUtils.shouldApplyBackgroundIdleFinish({
        hasBackgroundedLongRunningCommand: true,
        waitingForTaskOutput: true,
        waitingForAssistantAfterToolResult: false,
      }),
      false,
    );

    assert.equal(
      __claudeSdkTestUtils.shouldApplyBackgroundIdleFinish({
        hasBackgroundedLongRunningCommand: true,
        waitingForTaskOutput: false,
        waitingForAssistantAfterToolResult: true,
      }),
      false,
    );
  });
});
