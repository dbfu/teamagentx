import { describe, test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutor } from '../../../core/agent/executor.factory.js';

function testAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    name: 'TestAgent',
    prompt: 'You are a test assistant.',
    type: 'builtin',
    acpTool: null,
    workDir: null,
    proxyConfig: null,
    codexModel: null,
    codexFastMode: false,
    isActive: true,
    ...overrides,
  } as any;
}

describe('createExecutor', () => {
  test('将群规则注入 Claude 执行器系统指令', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-rules-'));
    try {
      const executor = createExecutor({
        agent: testAgent({ type: 'builtin', name: 'ClaudeAgent' }),
        chatRoomId: 'room-1',
        threadId: 'room-1_ClaudeAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        chatRoomRules: '所有回复必须使用中文。',
        agentTriggerMode: 'auto',
      });

      const debugInfo = executor.getDebugInfo();
      assert.match(debugInfo.systemPrompt, /## 群规则/);
      assert.match(debugInfo.systemPrompt, /所有回复必须使用中文。/);
      assert.match(debugInfo.systemPrompt, /## 助手提及/);
      assert.match(debugInfo.systemPrompt, /最多包含一个可触发的 @助手 提及/);
      assert.match(debugInfo.systemPrompt, /收尾交接协议（强制）/);
      assert.match(debugInfo.systemPrompt, /每条回复必须恰好以下面两种方式之一结束/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('将群规则注入 Codex 执行器系统指令', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-rules-'));
    try {
      const executor = createExecutor({
        agent: testAgent({
          id: 'agent-2',
          name: 'CodexAgent',
          type: 'acp',
          acpTool: 'codex',
        }),
        chatRoomId: 'room-1',
        threadId: 'room-1_CodexAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        chatRoomRules: '输出前先检查群规则。',
        agentTriggerMode: 'auto',
      });

      const debugInfo = executor.getDebugInfo();
      assert.match(debugInfo.systemPrompt, /## 群规则/);
      assert.match(debugInfo.systemPrompt, /输出前先检查群规则。/);
      assert.match(debugInfo.systemPrompt, /## 助手提及/);
      assert.match(debugInfo.systemPrompt, /最多包含一个可触发的 @助手 提及/);
      assert.match(debugInfo.systemPrompt, /收尾交接协议（强制）/);
      assert.match(debugInfo.systemPrompt, /每条回复必须恰好以下面两种方式之一结束/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('非自由协作模式不注入交接意图自检提示', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-rules-'));
    try {
      const coordinatorExecutor = createExecutor({
        agent: testAgent({ type: 'builtin', name: 'CoordinatorModeAgent' }),
        chatRoomId: 'room-1',
        threadId: 'room-1_CoordinatorModeAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        agentTriggerMode: 'coordinator',
      });
      const manualExecutor = createExecutor({
        agent: testAgent({
          id: 'agent-5',
          name: 'ManualModeAgent',
          type: 'acp',
          acpTool: 'codex',
        }),
        chatRoomId: 'room-1',
        threadId: 'room-1_ManualModeAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        agentTriggerMode: 'manual',
      });

      assert.doesNotMatch(
        coordinatorExecutor.getDebugInfo().systemPrompt,
        /End-of-Turn Handoff Protocol \(MANDATORY\)/,
      );
      assert.doesNotMatch(
        manualExecutor.getDebugInfo().systemPrompt,
        /End-of-Turn Handoff Protocol \(MANDATORY\)/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('系统助手在自由协作模式下也不注入交接意图自检提示', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-rules-'));
    try {
      const executor = createExecutor({
        agent: testAgent({
          type: 'builtin',
          name: 'SystemAgent',
          agentLevel: 'system',
        }),
        chatRoomId: 'room-1',
        threadId: 'room-1_SystemAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        agentTriggerMode: 'auto',
      });

      assert.doesNotMatch(
        executor.getDebugInfo().systemPrompt,
        /End-of-Turn Handoff Protocol \(MANDATORY\)/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('将 Codex Fast 模式传入执行器', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-fast-'));
    try {
      const executor = createExecutor({
        agent: testAgent({
          id: 'agent-3',
          name: 'FastCodexAgent',
          type: 'acp',
          acpTool: 'codex',
          codexFastMode: true,
        }),
        chatRoomId: 'room-1',
        threadId: 'room-1_FastCodexAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
      });

      assert.strictEqual((executor as any).codexFastMode, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('将 stateless 模式传入执行器', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-stateless-'));
    try {
      const claudeExecutor = createExecutor({
        agent: testAgent({ type: 'builtin', name: 'StatelessClaudeAgent' }),
        chatRoomId: 'room-1',
        threadId: 'room-1_StatelessClaudeAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        stateless: true,
      });
      assert.strictEqual((claudeExecutor as any).stateless, true);

      const codexExecutor = createExecutor({
        agent: testAgent({
          id: 'agent-4',
          name: 'StatelessCodexAgent',
          type: 'acp',
          acpTool: 'codex',
        }),
        chatRoomId: 'room-1',
        threadId: 'room-1_StatelessCodexAgent',
        injectGroupHistory: true,
        chatRoomAgents: [],
        customWorkDir: tmpDir,
        stateless: true,
      });
      assert.strictEqual((codexExecutor as any).stateless, true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
