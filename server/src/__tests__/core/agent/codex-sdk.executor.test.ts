import { describe, test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildBuiltinCodexMcpServerConfigs,
  buildCodexModelProviderConfig,
} from '../../../core/agent/codex-sdk.executor.js';

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
