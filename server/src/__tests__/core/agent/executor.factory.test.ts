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
    prompt: '你是测试助手。',
    type: 'builtin',
    acpTool: null,
    workDir: null,
    proxyConfig: null,
    codexModel: null,
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
      });

      const debugInfo = executor.getDebugInfo();
      assert.match(debugInfo.systemPrompt, /## 群规则/);
      assert.match(debugInfo.systemPrompt, /所有回复必须使用中文。/);
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
      });

      const debugInfo = executor.getDebugInfo();
      assert.match(debugInfo.systemPrompt, /## 群规则/);
      assert.match(debugInfo.systemPrompt, /输出前先检查群规则。/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
