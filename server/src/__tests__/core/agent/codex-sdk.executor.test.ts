import { describe, test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildBuiltinCodexMcpServerConfigs,
  buildCodexModelProviderConfig,
  buildCodexRouterBaseUrl,
  CodexSdkExecutor,
  extractCodexSessionTranscript,
  isInputLengthExceededError,
} from '../../../core/agent/codex-sdk.executor.js';
import {
  ensureAgentLongTermMemoryFile,
} from '../../../core/agent/agent-long-term-memory.js';

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-1',
    name: 'Codex Gateway',
    type: 'custom',
    apiProtocol: 'openai',
    apiUrl: 'https://dm-fox.rjj.cc/codex/v1/',
    apiKey: 'test-key',
    model: 'gpt-5.4',
    supportsThinking: null,
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [],
    ...overrides,
  } as any;
}

describe('Codex SDK Executor provider config', () => {
  test('自定义 OpenAI 网关禁用 Responses WebSocket', () => {
    const config = buildCodexModelProviderConfig(provider());

    assert.strictEqual(config.model, 'gpt-5.4');
    assert.strictEqual(config.model_provider, 'teamagentx_openai');

    const providers = config.model_providers as Record<string, any>;
    assert.strictEqual(providers.teamagentx_openai.base_url, 'https://dm-fox.rjj.cc/codex/v1');
    assert.strictEqual(providers.teamagentx_openai.wire_api, 'responses');
    assert.strictEqual(providers.teamagentx_openai.supports_websockets, false);
    assert.strictEqual(providers.teamagentx_openai.env_key, 'CODEX_API_KEY');
  });

  test('未配置 apiUrl 时继续使用内置 openai provider', () => {
    const config = buildCodexModelProviderConfig(provider({ apiUrl: '' }));

    assert.deepStrictEqual(config, {
      model: 'gpt-5.4',
      model_provider: 'openai',
    });
  });

  test('codexWireApi=chat 且提供 routerBaseUrl 时 base_url 指向本地网关', () => {
    const routerBaseUrl = buildCodexRouterBaseUrl(11053, 'tok-abc', 'provider-1');
    const config = buildCodexModelProviderConfig(
      provider({ codexWireApi: 'chat' }),
      { routerBaseUrl },
    );

    const providers = config.model_providers as Record<string, any>;
    assert.strictEqual(
      providers.teamagentx_openai.base_url,
      'http://127.0.0.1:11053/codex-router/tok-abc/provider-1/v1',
    );
    // codex 端仍以 responses 协议发请求，由网关转换。
    assert.strictEqual(providers.teamagentx_openai.wire_api, 'responses');
  });

  test('codexWireApi=responses 时仍直连真实 apiUrl（不走路由）', () => {
    const config = buildCodexModelProviderConfig(
      provider({ codexWireApi: 'responses' }),
      { routerBaseUrl: buildCodexRouterBaseUrl(11053, 'tok', 'provider-1') },
    );
    const providers = config.model_providers as Record<string, any>;
    assert.strictEqual(providers.teamagentx_openai.base_url, 'https://dm-fox.rjj.cc/codex/v1');
  });
});

describe('Codex SDK Executor input length detection', () => {
  test('命中路由模式上游返回的输入长度超限错误', () => {
    const codexExecError = new Error(
      'Codex Exec exited with code 1: {"error":{"message":"<400> InternalError.Algo.InvalidParameter: Range of input length should be [1, 202752]","type":"invalid_request_error","code":"invalid_parameter_error","param":null}}',
    );
    assert.strictEqual(isInputLengthExceededError(codexExecError), true);
  });

  test('命中常见 OpenAI 上下文长度超限错误', () => {
    assert.strictEqual(
      isInputLengthExceededError(new Error("This model's maximum context length is 128000 tokens")),
      true,
    );
    assert.strictEqual(
      isInputLengthExceededError(new Error('context_length_exceeded')),
      true,
    );
  });

  test('普通错误与非 Error 值不误判', () => {
    assert.strictEqual(isInputLengthExceededError(new Error('Codex Exec exited with code 1: ECONNRESET')), false);
    assert.strictEqual(isInputLengthExceededError('Range of input length'), false);
    assert.strictEqual(isInputLengthExceededError(null), false);
  });
});

describe('Codex SDK Executor session transcript extraction', () => {
  test('从 rollout 抽取用户/助手消息与工具调用，跳过 developer 与 reasoning', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-rollout-'));
    const sessionPath = path.join(tmpDir, 'rollout.jsonl');
    const lines = [
      { type: 'session_meta', payload: { id: 'x' } },
      { type: 'event_msg', payload: { type: 'task_started' } },
      {
        type: 'response_item',
        payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>...' }] },
      },
      {
        type: 'response_item',
        payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '帮我导出 PDF' }] },
      },
      {
        type: 'response_item',
        payload: { type: 'reasoning', content: null, encrypted_content: 'gAAAA...' },
      },
      {
        type: 'response_item',
        payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"rg printToPDF"}' },
      },
      {
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'c1', output: 'apps/desktop/electron/main.ts:1' },
      },
      {
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '可以用 printToPDF' }] },
      },
    ];
    fs.writeFileSync(sessionPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    try {
      const transcript = extractCodexSessionTranscript(sessionPath);
      assert.match(transcript, /User: 帮我导出 PDF/);
      assert.match(transcript, /Assistant: 可以用 printToPDF/);
      assert.match(transcript, /Tool\[exec_command\]: \{"cmd":"rg printToPDF"\}/);
      assert.match(transcript, /ToolResult: apps\/desktop\/electron\/main\.ts:1/);
      // developer 系统说明与 reasoning 加密块不应进入转写
      assert.doesNotMatch(transcript, /permissions instructions/);
      assert.doesNotMatch(transcript, /gAAAA/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('超过 maxChars 时保留最近的尾部内容', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-rollout-cap-'));
    const sessionPath = path.join(tmpDir, 'rollout.jsonl');
    const lines = [
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'OLD_MARKER ' + 'a'.repeat(500) }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'NEW_MARKER tail' }] } },
    ];
    fs.writeFileSync(sessionPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    try {
      const transcript = extractCodexSessionTranscript(sessionPath, 40);
      assert.ok(transcript.length <= 40);
      assert.match(transcript, /NEW_MARKER tail/);
      assert.doesNotMatch(transcript, /OLD_MARKER/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Codex SDK Executor builtin MCP servers', () => {
  test('图片生成开启时注入 tax，并在 GitNexus 可用时注入 gitnexus', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-mcp-'));
    const repoDir = path.join(tmpDir, 'repo');
    const binDir = path.join(tmpDir, 'bin');
    const gitnexusPath = path.join(binDir, 'gitnexus');
    fs.mkdirSync(path.join(repoDir, '.gitnexus'), { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(gitnexusPath, '#!/usr/bin/env sh\nexit 0\n', { mode: 0o755 });

    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    try {
      const mcpServers = buildBuiltinCodexMcpServerConfigs({
        workDir: repoDir,
        teamAgentXMcpServerPath: '/tmp/teamagentx-agent-tools-mcp.mjs',
        chatRoomId: 'room-1',
        agentId: 'agent-1',
        agentName: 'Codex',
        chatRoomAgents: [
          { agentId: 'agent-2', name: 'Claude' },
        ],
        generateImageEndpoint: 'http://127.0.0.1:3001/internal/agent-tools/generate-image',
        backgroundCommandStartEndpoint: 'http://127.0.0.1:3001/internal/agent-tools/background-command/start',
        backgroundCommandReadEndpoint: 'http://127.0.0.1:3001/internal/agent-tools/background-command/read',
        backgroundCommandStopEndpoint: 'http://127.0.0.1:3001/internal/agent-tools/background-command/stop',
        backgroundCommandListEndpoint: 'http://127.0.0.1:3001/internal/agent-tools/background-command/list',
      }) as Record<string, any>;

      assert.strictEqual(mcpServers.gitnexus.command, gitnexusPath);
      assert.deepStrictEqual(mcpServers.gitnexus.args, ['mcp']);
      assert.strictEqual(mcpServers.tax.command, process.execPath);
      assert.deepStrictEqual(mcpServers.tax.args, ['/tmp/teamagentx-agent-tools-mcp.mjs']);
      assert.strictEqual(mcpServers.tax.env.TEAMAGENTX_SOURCE_AGENT_ID, 'agent-1');
      assert.strictEqual(
        mcpServers.tax.env.TEAMAGENTX_GENERATE_IMAGE_ENDPOINT,
        'http://127.0.0.1:3001/internal/agent-tools/generate-image',
      );
      assert.strictEqual(mcpServers.tax.env.TEAMAGENTX_WORK_DIR, repoDir);
      assert.strictEqual(
        mcpServers.tax.env.TEAMAGENTX_BACKGROUND_COMMAND_START_ENDPOINT,
        'http://127.0.0.1:3001/internal/agent-tools/background-command/start',
      );
      assert.ok(mcpServers.tax.env.TEAMAGENTX_INTERNAL_TOOL_TOKEN);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('GitNexus 不可用且图片生成未开启时不注入 tax', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-mcp-'));
    try {
      const mcpServers = buildBuiltinCodexMcpServerConfigs({
        workDir: tmpDir,
        teamAgentXMcpServerPath: '/tmp/teamagentx-agent-tools-mcp.mjs',
        chatRoomId: 'room-1',
        agentName: 'Codex',
        chatRoomAgents: [],
      }) as Record<string, any>;

      assert.strictEqual(mcpServers.gitnexus, undefined);
      assert.strictEqual(mcpServers.tax, undefined);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Codex SDK Executor message context', () => {
  test('keeps system instructions in Codex developer_instructions instead of the task prompt', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-system-prompt-'));
    const chatRoomId = 'room-codex-system-prompt-test';
    const agentId = 'agent-codex-system-prompt-test';
    const agentMemoryFile = ensureAgentLongTermMemoryFile(
      agentId,
      'CodexAgent',
    );
    fs.writeFileSync(agentMemoryFile, 'Global memory applies.', 'utf-8');

    const executor = new CodexSdkExecutor(
      'CodexAgent',
      'You are a careful coding assistant.',
      chatRoomId,
      workDir,
      false,
      agentId,
      undefined,
      undefined,
      undefined,
      [
        { name: 'CodexAgent', agentId },
        { name: 'HelperAgent', agentId: 'helper-agent' },
      ],
    );

    try {
      const developerInstructions = (executor as any).buildDeveloperInstructions();
      const fullMessage = (executor as any).buildFullMessage('Do the task');

      assert.match(developerInstructions, /You are a careful coding assistant\./);
      assert.match(developerInstructions, /\[Long-Term Memory Rules\]/);
      assert.doesNotMatch(developerInstructions, /MEMORY\.md/);
      assert.ok(!developerInstructions.includes(agentMemoryFile));
      assert.match(
        developerInstructions,
        /Write the final answer in human-readable Markdown\./,
      );
      assert.match(developerInstructions, /\[Group Chat Member Info\]/);
      assert.match(
        developerInstructions,
        /Assistants in the current chatroom: CodexAgent, HelperAgent/,
      );
      assert.match(developerInstructions, /Other assistants: HelperAgent/);
      assert.match(
        developerInstructions,
        /When you need to message another assistant/,
      );
      assert.doesNotMatch(developerInstructions, /Global memory applies\./);
      assert.doesNotMatch(fullMessage, /\[System Instructions\]/);
      assert.doesNotMatch(fullMessage, /\[Long-Term Memory Rules\]/);
      assert.doesNotMatch(fullMessage, /\[Group Chat Member Info\]/);
      assert.doesNotMatch(fullMessage, /You are a careful coding assistant\./);
      assert.match(fullMessage, /\[Global Assistant Long-Term Memory\]/);
      assert.match(fullMessage, /Global memory applies\./);
      assert.doesNotMatch(fullMessage, /\[Current Room Assistant Long-Term Memory\]/);
      assert.match(fullMessage, /\[Current Message\]\nDo the task$/);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(agentMemoryFile, { force: true });
    }
  });

  test('does not inject full group history when group history tools are disabled', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-history-'));
    const executor = new CodexSdkExecutor(
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
      assert.doesNotMatch(fullMessage, /\[Group History Access\]/);
      assert.match(fullMessage, /\[Current Message\]\nA$/);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  test('injects only group message indexes when group history tools are enabled', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-codex-index-'));
    const executor = new CodexSdkExecutor(
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
      assert.match(fullMessage, /\[Group History Access\]/);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
