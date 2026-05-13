import { describe, test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createAcpProviderCommand } from '../../../core/agent/acp-provider.adapter.js';

function provider(overrides: Record<string, unknown>) {
  return {
    id: 'provider-1',
    name: 'Test Provider',
    type: 'custom',
    apiProtocol: 'anthropic',
    apiUrl: 'https://example.com',
    apiKey: 'test-key',
    model: 'test-model',
    supportsThinking: null,
    isActive: true,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    agents: [],
    ...overrides,
  } as any;
}

describe('ACP Provider Adapter', () => {
  test('未配置供应商时返回原始命令', () => {
    const result = createAcpProviderCommand({
      acpTool: 'claude',
      agentCommand: 'embedded-claude-agent',
      agentName: 'Claude',
      wrapperRoot: path.join(os.tmpdir(), 'teamagentx-acp-test-unused'),
    });

    assert.strictEqual(result.command, 'embedded-claude-agent');
    assert.strictEqual(result.providerInfo, undefined);
  });

  test('Claude + anthropic 协议生成 wrapper', () => {
    const wrapperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-acp-'));
    const result = createAcpProviderCommand({
      acpTool: 'claude',
      agentCommand: 'embedded-claude-agent --stdio',
      provider: provider({ apiProtocol: 'anthropic' }),
      agentId: 'agent-1',
      agentName: 'Claude',
      wrapperRoot,
    });

    assert.match(result.command, /^".+\.mjs"$/);
    assert.strictEqual(result.providerInfo?.apiProtocol, 'anthropic');

    const wrapperPath = result.command.slice(1, -1);
    const content = fs.readFileSync(wrapperPath, 'utf-8');
    assert.match(content, /ANTHROPIC_API_KEY/);
    assert.match(content, /ANTHROPIC_MODEL/);
    assert.doesNotMatch(result.command, /test-key/);
  });

  test('Codex + openai 协议生成 wrapper', () => {
    const wrapperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-acp-'));
    const result = createAcpProviderCommand({
      acpTool: 'codex',
      agentCommand: 'codex-acp',
      provider: provider({ apiProtocol: 'openai' }),
      agentId: 'agent-2',
      agentName: 'Codex',
      wrapperRoot,
    });

    const wrapperPath = result.command.slice(1, -1);
    const content = fs.readFileSync(wrapperPath, 'utf-8');
    assert.match(content, /OPENAI_API_KEY/);
    assert.match(content, /OPENAI_MODEL/);
  });

  test('wrapper 不注入图片模型环境变量，避免 ACP 进程读取密钥', () => {
    const wrapperRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamagentx-acp-'));
    const result = createAcpProviderCommand({
      acpTool: 'claude',
      agentCommand: 'embedded-claude-agent --stdio',
      provider: provider({ apiProtocol: 'anthropic' }),
      agentId: 'agent-image',
      agentName: 'Claude',
      wrapperRoot,
    });

    const wrapperPath = result.command.slice(1, -1);
    const content = fs.readFileSync(wrapperPath, 'utf-8');
    assert.doesNotMatch(content, /IMAGE_GEN_API_KEY/);
    assert.doesNotMatch(content, /IMAGE_GEN_BASE_URL/);
    assert.doesNotMatch(content, /TEAMAGENTX_IMAGE_OUTPUT_DIR/);
    assert.doesNotMatch(result.command, /image-key/);
  });

  test('不支持的 ACP 工具会报错', () => {
    assert.throws(
      () =>
        createAcpProviderCommand({
          acpTool: 'gemini',
          agentCommand: 'gemini --acp',
          provider: provider({ apiProtocol: 'openai' }),
          agentName: 'Gemini',
          wrapperRoot: path.join(os.tmpdir(), 'teamagentx-acp-test-unused'),
        }),
      /暂不支持自定义 LLM 供应商/,
    );
  });

  test('工具和协议不匹配会报错', () => {
    assert.throws(
      () =>
        createAcpProviderCommand({
          acpTool: 'claude',
          agentCommand: 'embedded-claude-agent',
          provider: provider({ apiProtocol: 'openai' }),
          agentName: 'Claude',
          wrapperRoot: path.join(os.tmpdir(), 'teamagentx-acp-test-unused'),
        }),
      /Claude ACP 仅支持 anthropic 协议/,
    );
  });
});
