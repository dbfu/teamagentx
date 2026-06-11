import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, test } from 'node:test';
import {
  ClaudeAgentSdkExecutor,
  __claudeSdkTestUtils,
} from '../../../core/agent/claude-sdk.executor.js';
import {
  ensureAgentLongTermMemoryFile,
} from '../../../core/agent/agent-long-term-memory.js';

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

  test('keeps per-agent user settings enabled when a custom LLM provider is used', () => {
    assert.deepEqual(
      __claudeSdkTestUtils.getClaudeSettingSources(true),
      ['user'],
    );
    assert.deepEqual(
      __claudeSdkTestUtils.getClaudeSettingSources(false),
      ['user', 'project', 'local'],
    );
  });

  test('passes the per-agent Claude config dir to MCP shell commands', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-claude-mcp-env-'));
    const agentId = 'agent-env-test';
    const executor = new ClaudeAgentSdkExecutor(
      'claude',
      'test prompt',
      'room-env-test',
      workDir,
      true,
      agentId,
    );

    try {
      const script = 'console.log(process.env.CLAUDE_CONFIG_DIR || "")';
      const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
      const result = await (executor as any).runShellCommandForMcp(command, 10_000);

      assert.equal(result.exitCode, 0);
      assert.equal(
        String(result.stdout).trim(),
        path.join(os.homedir(), '.teamagentx', 'acp-config', agentId),
      );
    } finally {
      fs.rmSync(workDir, {recursive: true, force: true});
    }
  });

  test('does not inject full group history when group history tools are disabled', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-claude-history-'));
    const executor = new ClaudeAgentSdkExecutor(
      '群调度助手',
      'route messages',
      'room-history-test',
      workDir,
      false,
      'coordinator-agent',
    );

    try {
      const fullMessage = (executor as any).buildFullMessage('A', [
        {
          kind: 'message',
          content: '这个 todolist 给谁用？A 自己用 B 团队用',
          senderName: '产品经理',
          isHuman: false,
        },
      ]);

      assert.doesNotMatch(fullMessage, /\[Recent Group History\]/);
      assert.doesNotMatch(fullMessage, /sender=产品经理/);
      assert.doesNotMatch(fullMessage, /这个 todolist 给谁用/);
      assert.doesNotMatch(fullMessage, /\[群历史访问\]/);
      assert.match(fullMessage, /\[当前消息\]\nA$/);
    } finally {
      fs.rmSync(workDir, {recursive: true, force: true});
    }
  });

  test('keeps system instructions in the Claude SDK systemPrompt instead of the task prompt', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-claude-system-prompt-'));
    const chatRoomId = 'room-system-prompt-test';
    const agentId = 'agent-system-prompt-test';
    const agentMemoryFile = ensureAgentLongTermMemoryFile(
      agentId,
      'ClaudeAgent',
    );
    fs.writeFileSync(agentMemoryFile, 'Global memory applies.', 'utf-8');

    const executor = new ClaudeAgentSdkExecutor(
      'ClaudeAgent',
      'You are a careful coding assistant.',
      chatRoomId,
      workDir,
      false,
      agentId,
      undefined,
      undefined,
      undefined,
      [
        {name: 'ClaudeAgent', agentId},
        {name: 'HelperAgent', agentId: 'helper-agent'},
      ],
    );

    try {
      const sdkSystemPrompt = (executor as any).buildSdkSystemPrompt();
      const fullMessage = (executor as any).buildFullMessage('Do the task');

      assert.match(sdkSystemPrompt, /You are a careful coding assistant\./);
      assert.match(sdkSystemPrompt, /\[Long-Term Memory Rules\]/);
      assert.doesNotMatch(sdkSystemPrompt, /MEMORY\.md/);
      assert.ok(!sdkSystemPrompt.includes(agentMemoryFile));
      assert.match(
        sdkSystemPrompt,
        /最终回答请使用人类可读的 Markdown。/,
      );
      assert.match(sdkSystemPrompt, /\[群聊成员信息\]/);
      assert.match(
        sdkSystemPrompt,
        /当前群聊中的助手：ClaudeAgent, HelperAgent/,
      );
      assert.match(sdkSystemPrompt, /其他助手：HelperAgent/);
      assert.match(
        sdkSystemPrompt,
        /当你需要给另一个助手发消息时/,
      );
      assert.doesNotMatch(sdkSystemPrompt, /Global memory applies\./);
      assert.doesNotMatch(fullMessage, /\[System Instructions\]/);
      assert.doesNotMatch(fullMessage, /\[Long-Term Memory Rules\]/);
      assert.doesNotMatch(fullMessage, /\[群聊成员信息\]/);
      assert.doesNotMatch(
        fullMessage,
        /当你需要给另一个助手发消息时/,
      );
      assert.doesNotMatch(fullMessage, /You are a careful coding assistant\./);
      assert.match(fullMessage, /\[Global Assistant Long-Term Memory\]/);
      assert.match(fullMessage, /Global memory applies\./);
      assert.doesNotMatch(fullMessage, /\[Current Room Assistant Long-Term Memory\]/);
      assert.match(fullMessage, /\[当前消息\]\nDo the task$/);
    } finally {
      fs.rmSync(workDir, {recursive: true, force: true});
      fs.rmSync(agentMemoryFile, {force: true});
    }
  });

  test('injects only group message indexes when group history tools are enabled', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-claude-index-'));
    const executor = new ClaudeAgentSdkExecutor(
      '群调度助手',
      'route messages',
      'room-index-test',
      workDir,
      true,
      'coordinator-agent',
    );

    try {
      const fullMessage = (executor as any).buildFullMessage('A', [
        {
          kind: 'message_index',
          messageId: 'message-1',
          time: '2026-05-28T09:33:46.000Z',
          senderName: '产品经理',
          senderType: 'agent',
          isHuman: false,
          preview: '这个 todolist 给谁用？',
          content: '完整正文不应直接注入',
          attachments: [],
        },
      ]);

      assert.match(fullMessage, /\[New Group Message Index\]/);
      assert.match(fullMessage, /messageId=message-1/);
      assert.match(fullMessage, /preview="这个 todolist 给谁用？"/);
      assert.doesNotMatch(fullMessage, /完整正文不应直接注入/);
      assert.match(fullMessage, /\[群历史访问\]/);
    } finally {
      fs.rmSync(workDir, {recursive: true, force: true});
    }
  });
});
