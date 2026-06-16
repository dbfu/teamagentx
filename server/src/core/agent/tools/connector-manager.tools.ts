import { z } from 'zod';
import { connectorService, type CreateConnectorInput } from '../../../modules/connector/connector.service.js';
import { clearExecutorCacheEntries } from '../agent-handler/cache.js';
import { createSystemTool as tool } from './system-tool.js';

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw == null) continue;
    result[key] = String(raw);
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item != null).map((item) => String(item));
}

function splitCommandLine(commandLine: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const char of commandLine.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) result.push(current);
  return result;
}

function buildRepairPlan(input: {
  name: string;
  transport?: string;
  message: string;
  command?: string | null;
  args?: string[] | null;
}) {
  const lower = input.message.toLowerCase();
  const actions: string[] = [];
  const retryPolicy =
    '修复后必须再次调用 create_mcp_connector 重新测试；只有测试通过才会落库。';

  if (lower.includes('enoent') || lower.includes('not found') || lower.includes('command')) {
    actions.push('确认本机已安装启动命令，并且服务端进程 PATH 可以找到该命令。');
    if (input.command === 'npx') {
      actions.push(`可先运行 ${['npx', ...(input.args || [])].join(' ')} 验证包可以下载和启动。`);
    }
  }
  if (lower.includes('timeout') || input.message.includes('连接超时')) {
    actions.push('检查 MCP server 是否能在 15 秒内完成初始化；数据库、网络或首次 npx 下载过慢时，先在后台命令中预热启动依赖。');
  }
  if (lower.includes('access denied') || lower.includes('auth') || lower.includes('password')) {
    actions.push('检查 env 中的账号、密码、token、数据库名或权限是否正确；不要在最终回复中复述密钥。');
  }
  if (lower.includes('econnrefused') || lower.includes('connect') || lower.includes('network')) {
    actions.push('检查目标服务地址、端口、防火墙和网络连通性。');
  }
  if (actions.length === 0) {
    actions.push('根据错误信息修正 MCP JSON、环境变量或本机依赖后重试。');
  }

  return {
    connector: input.name,
    saved: false,
    retryPolicy,
    suggestedActions: actions,
  };
}

function parseMcpConfig(input: {
  configJson?: string;
  mcpServers?: Record<string, unknown>;
}): Record<string, unknown> {
  if (input.mcpServers && typeof input.mcpServers === 'object' && !Array.isArray(input.mcpServers)) {
    return input.mcpServers;
  }

  if (!input.configJson?.trim()) {
    throw new Error('请提供包含 mcpServers 的 JSON 配置');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.configJson);
  } catch {
    throw new Error('JSON 格式错误，请检查后重试');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP 配置必须是 JSON 对象');
  }

  const maybeConfig = parsed as { mcpServers?: unknown };
  if (
    maybeConfig.mcpServers &&
    typeof maybeConfig.mcpServers === 'object' &&
    !Array.isArray(maybeConfig.mcpServers)
  ) {
    return maybeConfig.mcpServers as Record<string, unknown>;
  }

  return parsed as Record<string, unknown>;
}

function mcpServerToConnectorInput(name: string, rawValue: unknown): CreateConnectorInput {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    throw new Error(`连接器「${name}」配置必须是对象`);
  }

  const raw = rawValue as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const isHttp = (typeof raw.type === 'string' && raw.type.toLowerCase() === 'http') || !!url;

  if (isHttp) {
    if (!url) throw new Error(`HTTP 连接器「${name}」缺少 url`);
    return {
      name,
      displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : name,
      description: typeof raw.description === 'string' ? raw.description : null,
      transport: 'http',
      url,
      headers: toStringRecord(raw.headers),
      enabled: true,
    };
  }

  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!command) throw new Error(`stdio 连接器「${name}」缺少 command`);
  const rawArgs = toStringArray(raw.args);
  const commandParts = rawArgs.length === 0 ? splitCommandLine(command) : [];
  const normalizedCommand = commandParts.length > 1 ? commandParts[0] : command;
  const normalizedArgs = commandParts.length > 1 ? commandParts.slice(1) : rawArgs;

  return {
    name,
    displayName: typeof raw.displayName === 'string' && raw.displayName.trim() ? raw.displayName.trim() : name,
    description: typeof raw.description === 'string' ? raw.description : null,
    transport: 'stdio',
    command: normalizedCommand,
    args: normalizedArgs,
    env: toStringRecord(raw.env),
    enabled: true,
  };
}

function connectorInputToMcpServer(input: CreateConnectorInput): Record<string, unknown> {
  if (input.transport === 'http') {
    return {
      type: 'http',
      url: input.url || '',
      ...(input.headers && Object.keys(input.headers).length > 0 ? { headers: input.headers } : {}),
    };
  }
  return {
    command: input.command || '',
    ...(input.args && input.args.length > 0 ? { args: input.args } : {}),
    ...(input.env && Object.keys(input.env).length > 0 ? { env: input.env } : {}),
  };
}

export const createMcpConnectorTool = tool(
  async (input: { configJson?: string; mcpServers?: Record<string, unknown> }) => {
    const mcpServers = parseMcpConfig(input);
    const entries = Object.entries(mcpServers);
    if (entries.length === 0) {
      throw new Error('mcpServers 不能为空');
    }

    const current = await connectorService.getConfig();
    const duplicatedNames = entries
      .map(([name]) => name)
      .filter((name) => Object.prototype.hasOwnProperty.call(current.mcpServers, name));
    if (duplicatedNames.length > 0) {
      throw new Error(`连接器已存在：${duplicatedNames.join(', ')}`);
    }

    const connectorInputs = entries.map(([name, rawValue]) => mcpServerToConnectorInput(name, rawValue));
    const testResults = [];
    for (const connectorInput of connectorInputs) {
      const result = await connectorService.test(connectorInput);
      if (!result.connected) {
        return {
          success: false,
          saved: false,
          failedConnector: connectorInput.name,
          message: `连接器「${connectorInput.name}」测试失败：${result.message}`,
          testedConnectors: testResults,
          repairPlan: buildRepairPlan({
            name: connectorInput.name,
            transport: connectorInput.transport,
            message: result.message,
            command: connectorInput.command,
            args: connectorInput.args,
          }),
        };
      }
      testResults.push({
        name: connectorInput.name,
        connected: true,
        message: result.message,
        tools: result.tools.map((item) => ({
          name: item.name,
          description: item.description,
        })),
      });
    }

    const normalizedMcpServers = Object.fromEntries(
      connectorInputs.map((connectorInput) => [
        connectorInput.name,
        connectorInputToMcpServer(connectorInput),
      ]),
    );
    await connectorService.mergeFromConfig(normalizedMcpServers);
    clearExecutorCacheEntries();

    return {
      success: true,
      saved: true,
      createdConnectors: connectorInputs.map((item) => ({
        name: item.name,
        displayName: item.displayName,
        transport: item.transport,
      })),
      testedConnectors: testResults,
      message: `已创建 ${connectorInputs.length} 个 MCP 连接器，并通过 MCP 握手测试。需要让某个助手使用时，请到该助手的「连接器」标签页启用对应连接器。`,
    };
  },
  {
    name: 'create_mcp_connector',
    description:
      'Create one or more global MCP connectors from standard MCP JSON. The tool tests every MCP server with an MCP handshake and tools/list before saving. If any server cannot connect, nothing is saved.',
    schema: z.object({
      configJson: z
        .string()
        .optional()
        .describe('A JSON string containing {"mcpServers": {...}}. Use this when the user pastes MCP JSON.'),
      mcpServers: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('The mcpServers object when already parsed from JSON.'),
    }),
  },
);

export const connectorManagerTools = [createMcpConnectorTool];
