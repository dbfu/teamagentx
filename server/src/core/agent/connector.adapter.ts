import prisma from '../../lib/prisma.js';

/**
 * 连接器（Connector）适配层。
 *
 * 连接器是用户在全局注册、助手按需启用的 MCP server。
 * 本模块负责：
 *  - 从数据库加载某个助手已启用的连接器
 *  - 把连接器配置翻译成两种 SDK 的 MCP server 形状
 *    - Claude Agent SDK 的 `mcpServers`
 *    - Codex SDK 的 `mcp_servers`
 *
 * 协议层仍然是 MCP，这里只做「连接器 -> SDK 配置」的转换。
 */

export type ConnectorTransport = 'stdio' | 'http';

/** 归一化后的连接器配置（JSON 字段已解析为对象） */
export interface NormalizedConnector {
  id: string;
  name: string;
  transport: ConnectorTransport;
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val == null) continue;
    result[key] = String(val);
  }
  return result;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item != null).map((item) => String(item));
}

/** 把数据库中的连接器记录归一化（解析 JSON 字段） */
export function normalizeConnector(record: {
  id: string;
  name: string;
  transport: string;
  command?: string | null;
  args?: string | null;
  env?: string | null;
  url?: string | null;
  headers?: string | null;
}): NormalizedConnector {
  const transport: ConnectorTransport = record.transport === 'http' ? 'http' : 'stdio';
  return {
    id: record.id,
    name: record.name,
    transport,
    command: record.command || undefined,
    args: toStringArray(safeJsonParse(record.args, [])),
    env: toStringRecord(safeJsonParse(record.env, {})),
    url: record.url || undefined,
    headers: toStringRecord(safeJsonParse(record.headers, {})),
  };
}

/**
 * 加载某个助手已启用的连接器列表。
 * 过滤条件：助手绑定开关 enabled 且连接器全局开关 enabled。
 */
export async function getAgentConnectors(
  agentId: string | null | undefined,
): Promise<NormalizedConnector[]> {
  if (!agentId) return [];
  const bindings = await prisma.agentConnector.findMany({
    where: {
      agentId,
      enabled: true,
      connector: { enabled: true },
    },
    include: { connector: true },
  });
  return bindings
    .map((binding) => binding.connector)
    .filter((connector): connector is NonNullable<typeof connector> => !!connector)
    .map((connector) => normalizeConnector(connector))
    .filter((connector) => isConnectorRunnable(connector));
}

/** 判断连接器配置是否完整可运行 */
export function isConnectorRunnable(connector: NormalizedConnector): boolean {
  if (connector.transport === 'stdio') return !!connector.command;
  if (connector.transport === 'http') return !!connector.url;
  return false;
}

/**
 * 转换为 Claude Agent SDK 的 mcpServers 形状。
 * stdio: { type:'stdio', command, args, env }
 * http:  { type:'http', url, headers }
 */
export function toClaudeMcpServers(
  connectors: NormalizedConnector[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const connector of connectors) {
    if (!isConnectorRunnable(connector)) continue;
    if (connector.transport === 'http') {
      result[connector.name] = {
        type: 'http',
        url: connector.url,
        ...(Object.keys(connector.headers).length > 0
          ? { headers: connector.headers }
          : {}),
      };
    } else {
      result[connector.name] = {
        type: 'stdio',
        command: connector.command,
        args: connector.args,
        ...(Object.keys(connector.env).length > 0 ? { env: connector.env } : {}),
      };
    }
  }
  return result;
}

/**
 * 转换为 Codex SDK 的 mcp_servers 配置对象。
 * stdio: { command, args, env }
 * http:  { url, http_headers }（需较新版本 Codex 二进制支持 streamable HTTP）
 */
export function toCodexMcpServers(
  connectors: NormalizedConnector[],
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const connector of connectors) {
    if (!isConnectorRunnable(connector)) continue;
    if (connector.transport === 'http') {
      console.warn(
        `[Connector] Codex MCP over HTTP 需要较新版本的 Codex 二进制（streamable HTTP），连接器「${connector.name}」可能不可用`,
      );
      result[connector.name] = {
        url: connector.url,
        ...(Object.keys(connector.headers).length > 0
          ? { http_headers: connector.headers }
          : {}),
      };
    } else {
      result[connector.name] = {
        command: connector.command,
        args: connector.args,
        ...(Object.keys(connector.env).length > 0 ? { env: connector.env } : {}),
      };
    }
  }
  return result;
}
