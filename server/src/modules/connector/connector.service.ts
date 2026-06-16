import prisma from '../../lib/prisma.js';
import type { Connector } from '@prisma/client';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeConnector, isConnectorRunnable } from '../../core/agent/connector.adapter.js';

/** 连接器命名空间 key 规则：仅字母数字下划线连字符 */
const CONNECTOR_NAME_RE = /^[A-Za-z0-9_-]+$/;

export type ConnectorTransport = 'stdio' | 'http';

export interface CreateConnectorInput {
  name: string;
  displayName: string;
  description?: string | null;
  transport?: ConnectorTransport;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

export type UpdateConnectorInput = Partial<CreateConnectorInput>;

export interface ConnectorTestResult {
  connected: boolean;
  message: string;
  tools: { name: string; description?: string }[];
}

const MCP_CONFIG_PATH = path.join(os.homedir(), '.teamagentx', 'mcp.json');

function validateName(name: string): void {
  if (!name || !CONNECTOR_NAME_RE.test(name)) {
    throw new Error('连接器名称仅允许字母、数字、下划线和连字符');
  }
}

function validateUrl(url: string | null | undefined): void {
  if (!url) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('连接器 URL 格式无效，请输入合法的 HTTP/HTTPS 地址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('连接器 URL 协议不支持，仅允许 http 或 https');
  }
}

function validateTransport(transport: unknown): ConnectorTransport {
  if (transport === undefined || transport === null) return 'stdio';
  if (transport === 'stdio' || transport === 'http') return transport;
  throw new Error('连接器传输类型不支持');
}

function validateRunnableInput(input: {
  transport: ConnectorTransport;
  command?: string | null;
  url?: string | null;
}): void {
  if (input.transport === 'stdio' && !input.command?.trim()) {
    throw new Error('stdio 连接器必须填写启动命令');
  }
  if (input.transport === 'http') {
    if (!input.url?.trim()) {
      throw new Error('http 连接器必须填写 URL');
    }
    validateUrl(input.url);
  }
}

async function ensureMcpConfigDir(): Promise<void> {
  await fs.mkdir(path.dirname(MCP_CONFIG_PATH), { recursive: true, mode: 0o700 });
}

async function readMcpConfigFile(): Promise<{ mcpServers: Record<string, unknown> } | null> {
  try {
    const content = await fs.readFile(MCP_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content) as { mcpServers?: unknown };
    if (
      !parsed.mcpServers ||
      typeof parsed.mcpServers !== 'object' ||
      Array.isArray(parsed.mcpServers)
    ) {
      throw new Error('配置格式错误：缺少 mcpServers 对象');
    }
    return { mcpServers: parsed.mcpServers as Record<string, unknown> };
  } catch (error: unknown) {
    const err = error as { code?: string };
    if (err.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeMcpConfigFile(config: { mcpServers: Record<string, unknown> }): Promise<void> {
  await ensureMcpConfigDir();
  await fs.writeFile(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  await fs.chmod(MCP_CONFIG_PATH, 0o600).catch(() => {});
}

async function upsertMcpConfigFileEntry(
  name: string,
  value: Record<string, unknown>,
): Promise<void> {
  const fileConfig = (await readMcpConfigFile()) ?? { mcpServers: {} };
  await writeMcpConfigFile({
    mcpServers: {
      ...fileConfig.mcpServers,
      [name]: value,
    },
  });
}

/** 将输入中的对象/数组字段序列化为数据库存储的 JSON 字符串 */
function serializeWriteFields(input: CreateConnectorInput | UpdateConnectorInput) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.description !== undefined) data.description = input.description;
  if (input.transport !== undefined) data.transport = input.transport;
  if (input.command !== undefined) data.command = input.command;
  if (input.url !== undefined) data.url = input.url;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.args !== undefined) data.args = JSON.stringify(input.args ?? []);
  if (input.env !== undefined) data.env = JSON.stringify(input.env ?? {});
  if (input.headers !== undefined) data.headers = JSON.stringify(input.headers ?? {});
  return data;
}

function connectorInputToMcpServer(input: {
  transport: ConnectorTransport;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  headers?: Record<string, string> | null;
}): Record<string, unknown> {
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

function normalizeStdioCommand(raw: Record<string, unknown>): { command: string; args: string[] } {
  const rawCommand = typeof raw.command === 'string' ? raw.command.trim() : '';
  const rawArgs = Array.isArray(raw.args) ? raw.args.map(String) : [];
  if (!rawCommand || rawArgs.length > 0) {
    return { command: rawCommand, args: rawArgs };
  }
  const parts = splitCommandLine(rawCommand);
  if (parts.length <= 1) {
    return { command: rawCommand, args: [] };
  }
  return { command: parts[0], args: parts.slice(1) };
}

export const connectorService = {
  async findAll() {
    return prisma.connector.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { agents: true } } },
    });
  },

  async findById(id: string) {
    return prisma.connector.findUnique({ where: { id } });
  },

  async create(input: CreateConnectorInput): Promise<Connector> {
    validateName(input.name);
    const transport = validateTransport(input.transport);
    validateRunnableInput({ transport, command: input.command, url: input.url });
    const connector = await prisma.connector.create({
      data: {
        transport,
        ...serializeWriteFields(input),
      } as never,
    });
    await upsertMcpConfigFileEntry(
      connector.name,
      connectorInputToMcpServer({ ...input, transport }),
    );
    return connector;
  },

  async update(id: string, input: UpdateConnectorInput): Promise<Connector> {
    if (input.name !== undefined) validateName(input.name);
    const current = await prisma.connector.findUniqueOrThrow({ where: { id } });
    const transport =
      input.transport !== undefined
        ? validateTransport(input.transport)
        : validateTransport(current.transport);
    validateRunnableInput({
      transport,
      command: input.command !== undefined ? input.command : current.command,
      url: input.url !== undefined ? input.url : current.url,
    });
    const connector = await prisma.connector.update({
      where: { id },
      data: serializeWriteFields(input) as never,
    });
    await upsertMcpConfigFileEntry(
      connector.name,
      connectorInputToMcpServer({
        transport,
        command: input.command !== undefined ? input.command : current.command,
        args: input.args !== undefined ? input.args : JSON.parse(current.args || '[]'),
        env: input.env !== undefined ? input.env : JSON.parse(current.env || '{}'),
        url: input.url !== undefined ? input.url : current.url,
        headers: input.headers !== undefined ? input.headers : JSON.parse(current.headers || '{}'),
      }),
    );
    return connector;
  },

  async delete(id: string): Promise<Connector> {
    const connector = await prisma.connector.delete({ where: { id } });
    await this.removeFromConfigFile(connector.name);
    return connector;
  },

  async setEnabled(id: string, enabled: boolean): Promise<Connector> {
    return prisma.connector.update({ where: { id }, data: { enabled } });
  },

  /**
   * 导出全部连接器为标准 MCP JSON：{ mcpServers: { name: { ... } } }
   * stdio -> { command, args, env }；http -> { type:'http', url, headers }
   */
  async getConfig(): Promise<{ mcpServers: Record<string, Record<string, unknown>> }> {
    const fileConfig = await readMcpConfigFile();
    if (fileConfig) {
      return fileConfig as { mcpServers: Record<string, Record<string, unknown>> };
    }

    const connectors = await prisma.connector.findMany({ orderBy: { createdAt: 'asc' } });
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const c of connectors) {
      const args = JSON.parse(c.args || '[]');
      const env = JSON.parse(c.env || '{}');
      const headers = JSON.parse(c.headers || '{}');
      if (c.transport === 'http') {
        mcpServers[c.name] = {
          type: 'http',
          url: c.url || '',
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        };
      } else {
        mcpServers[c.name] = {
          command: c.command || '',
          ...(Array.isArray(args) && args.length > 0 ? { args } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };
      }
    }
    const config = { mcpServers };
    await writeMcpConfigFile(config);
    return config;
  },

  /**
   * 用标准 MCP JSON 覆盖式同步连接器。
   * 按 name upsert（保留已有连接器的 enabled 与 id，使助手绑定不丢失），
   * 删除 JSON 中不存在的连接器。
   */
  async syncFromConfig(
    mcpServers: Record<string, unknown>,
  ): Promise<void> {
    if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
      throw new Error('配置格式错误：缺少 mcpServers 对象');
    }

    const names: string[] = [];
    const ops: ReturnType<typeof prisma.connector.upsert>[] = [];

    for (const [name, rawValue] of Object.entries(mcpServers)) {
      validateName(name);
      const raw = (rawValue || {}) as Record<string, unknown>;
      const isHttp = typeof raw.url === 'string' && raw.url.length > 0;

      if (isHttp) {
        validateUrl(raw.url as string);
      } else if (typeof raw.command !== 'string' || !raw.command) {
        throw new Error(`连接器「${name}」缺少 command 或 url`);
      }
      const stdio = isHttp ? null : normalizeStdioCommand(raw);

      const data = {
        name,
        displayName: typeof raw.displayName === 'string' ? raw.displayName : name,
        description: typeof raw.description === 'string' ? raw.description : null,
        transport: isHttp ? 'http' : 'stdio',
        command: isHttp ? null : stdio!.command,
        args: JSON.stringify(isHttp ? [] : stdio!.args),
        env: JSON.stringify(
          raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env) ? raw.env : {},
        ),
        url: isHttp ? (raw.url as string) : null,
        headers: JSON.stringify(
          raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
            ? raw.headers
            : {},
        ),
      };

      names.push(name);
      ops.push(
        prisma.connector.upsert({
          where: { name },
          // 更新时不覆盖 enabled，保留全局开关状态
          update: {
            displayName: data.displayName,
            description: data.description,
            transport: data.transport,
            command: data.command,
            args: data.args,
            env: data.env,
            url: data.url,
            headers: data.headers,
          },
          create: data,
        }),
      );
    }

    await writeMcpConfigFile({ mcpServers });

    await prisma.$transaction([
      ...ops,
      prisma.connector.deleteMany({ where: { name: { notIn: names } } }),
    ]);
  },

  /**
   * 追加 MCP JSON 中的一批新连接器，不删除文件里已有的其它连接器。
   * 若传入名称已存在，则拒绝保存，避免“新建”误覆盖已有配置。
   */
  async mergeFromConfig(mcpServers: Record<string, unknown>): Promise<void> {
    if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
      throw new Error('配置格式错误：缺少 mcpServers 对象');
    }
    const current = await this.getConfig();
    const duplicatedNames = Object.keys(mcpServers).filter((name) => name in current.mcpServers);
    if (duplicatedNames.length > 0) {
      const error = new Error(`连接器已存在：${duplicatedNames.join(', ')}`);
      (error as Error & { code?: string }).code = 'CONNECTOR_DUPLICATE';
      throw error;
    }
    await this.syncFromConfig({
      ...current.mcpServers,
      ...mcpServers,
    });
  },

  async removeFromConfigFile(name: string): Promise<void> {
    const fileConfig = await readMcpConfigFile();
    if (!fileConfig || !(name in fileConfig.mcpServers)) return;
    const nextServers = { ...fileConfig.mcpServers };
    delete nextServers[name];
    await writeMcpConfigFile({ mcpServers: nextServers });
  },

  /** 列出某助手绑定的连接器（含绑定开关状态） */
  async listAgentConnectors(agentId: string) {
    return prisma.agentConnector.findMany({
      where: { agentId },
      include: { connector: true },
    });
  },

  /** 覆盖式设置某助手启用的连接器 */
  async setAgentConnectors(agentId: string, connectorIds: string[]): Promise<void> {
    const unique = Array.from(new Set(connectorIds));
    if (unique.length > 0) {
      const existing = await prisma.connector.findMany({
        where: { id: { in: unique } },
        select: { id: true },
      });
      if (existing.length !== unique.length) {
        throw new Error('包含不存在的连接器');
      }
    }
    await prisma.$transaction([
      prisma.agentConnector.deleteMany({ where: { agentId } }),
      ...(unique.length > 0
        ? [
            prisma.agentConnector.createMany({
              data: unique.map((connectorId) => ({ agentId, connectorId, enabled: true })),
            }),
          ]
        : []),
    ]);
  },

  /** 通过 MCP 握手测试连接器是否可用，并返回暴露的工具列表 */
  async test(input: CreateConnectorInput): Promise<ConnectorTestResult> {
    const transport = input.transport ?? 'stdio';
    const normalized = normalizeConnector({
      id: 'test',
      name: input.name || 'test',
      transport,
      command: input.command ?? null,
      args: JSON.stringify(input.args ?? []),
      env: JSON.stringify(input.env ?? {}),
      url: input.url ?? null,
      headers: JSON.stringify(input.headers ?? {}),
    });

    if (!isConnectorRunnable(normalized)) {
      return { connected: false, message: '连接器配置不完整', tools: [] };
    }

    const client = new Client(
      { name: 'teamagentx-connector-test', version: '1.0.0' },
      { capabilities: {} },
    );

    let clientTransport: StdioClientTransport | StreamableHTTPClientTransport;
    if (normalized.transport === 'http') {
      clientTransport = new StreamableHTTPClientTransport(new URL(normalized.url!), {
        requestInit: { headers: normalized.headers },
      });
    } else {
      clientTransport = new StdioClientTransport({
        command: normalized.command!,
        args: normalized.args,
        env: { ...(process.env as Record<string, string>), ...normalized.env },
      });
    }

    const timeoutMs = 15_000;
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('连接超时')), timeoutMs),
    );

    try {
      await Promise.race([client.connect(clientTransport), timeout]);
      const result = (await Promise.race([client.listTools(), timeout])) as {
        tools: { name: string; description?: string }[];
      };
      const tools = (result.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
      }));
      return {
        connected: true,
        message: `连接成功，发现 ${tools.length} 个工具`,
        tools,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '连接失败';
      return { connected: false, message, tools: [] };
    } finally {
      await client.close().catch(() => {});
    }
  },
};
