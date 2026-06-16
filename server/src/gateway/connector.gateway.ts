import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { connectorService } from '../modules/connector/connector.service.js';
import type {
  ConnectorTransport,
  CreateConnectorInput,
  UpdateConnectorInput,
} from '../modules/connector/connector.service.js';
import { clearExecutorCache } from '../core/agent/agent-handler/index.js';
import { authService } from '../modules/auth/auth.service.js';

const TRANSPORTS = ['stdio', 'http'] as const;

const stringMap = {
  type: 'object',
  additionalProperties: { type: 'string' },
} as const;

const connectorBodyProps = {
  name: { type: 'string', description: '命名空间 key（仅字母数字下划线连字符）' },
  displayName: { type: 'string', description: '显示名' },
  description: { type: 'string', nullable: true },
  transport: { type: 'string', enum: TRANSPORTS },
  command: { type: 'string', nullable: true, description: 'stdio 启动命令' },
  args: { type: 'array', items: { type: 'string' }, description: 'stdio 参数' },
  env: { ...stringMap, description: 'stdio 环境变量' },
  url: { type: 'string', nullable: true, description: 'http 服务地址' },
  headers: { ...stringMap, description: 'http 请求头' },
  enabled: { type: 'boolean' },
} as const;

interface ConnectorParams {
  id: string;
}

interface AgentParams {
  agentId: string;
}

function clearConnectorDependentExecutors() {
  clearExecutorCache();
}

export async function connectorGateway(app: FastifyInstance) {
  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
      return false;
    }
    const user = await authService.getUserFromToken(token);
    if (!user) {
      reply.code(401).send({ success: false, error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // 列出所有连接器
  app.get('/connectors', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    const connectors = await connectorService.findAll();
    return reply.send({ success: true, data: connectors });
  });

  // 读取全部连接器的标准 MCP JSON 配置
  app.get('/connectors/config', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    const config = await connectorService.getConfig();
    return reply.send({ success: true, data: config });
  });

  // 用标准 MCP JSON 覆盖式同步连接器
  app.put<{ Body: { mcpServers: Record<string, unknown> } }>(
    '/connectors/config',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mcpServers'],
          properties: { mcpServers: { type: 'object', additionalProperties: true } },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      try {
        await connectorService.syncFromConfig(request.body.mcpServers);
        clearConnectorDependentExecutors();
        return reply.send({ success: true });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'P2002') {
          return reply.code(409).send({ success: false, error: '连接器名称重复' });
        }
        return reply.code(400).send({ success: false, error: err.message || '保存失败' });
      }
    },
  );

  // 追加标准 MCP JSON 中的新连接器，不删除已有连接器，也不覆盖同名连接器
  app.patch<{ Body: { mcpServers: Record<string, unknown> } }>(
    '/connectors/config',
    {
      schema: {
        body: {
          type: 'object',
          required: ['mcpServers'],
          properties: { mcpServers: { type: 'object', additionalProperties: true } },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      try {
        await connectorService.mergeFromConfig(request.body.mcpServers);
        clearConnectorDependentExecutors();
        return reply.send({ success: true });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'P2002') {
          return reply.code(409).send({ success: false, error: '连接器名称重复' });
        }
        if (err.code === 'CONNECTOR_DUPLICATE') {
          return reply.code(409).send({ success: false, error: err.message || '连接器已存在' });
        }
        return reply.code(400).send({ success: false, error: err.message || '保存失败' });
      }
    },
  );

  // 创建连接器
  app.post<{ Body: CreateConnectorInput }>(
    '/connectors',
    { schema: { body: { type: 'object', required: ['name', 'displayName'], properties: connectorBodyProps } } },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      try {
        const connector = await connectorService.create(request.body);
        clearConnectorDependentExecutors();
        return reply.code(201).send({ success: true, data: connector });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'P2002') {
          return reply.code(409).send({ success: false, error: '连接器名称已存在' });
        }
        return reply.code(400).send({ success: false, error: err.message || '创建失败' });
      }
    },
  );

  // 更新连接器
  app.put<{ Params: ConnectorParams; Body: UpdateConnectorInput }>(
    '/connectors/:id',
    { schema: { body: { type: 'object', properties: connectorBodyProps } } },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      try {
        const connector = await connectorService.update(request.params.id, request.body);
        clearConnectorDependentExecutors();
        return reply.send({ success: true, data: connector });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'P2025') {
          return reply.code(404).send({ success: false, error: '连接器不存在' });
        }
        if (err.code === 'P2002') {
          return reply.code(409).send({ success: false, error: '连接器名称已存在' });
        }
        return reply.code(400).send({ success: false, error: err.message || '更新失败' });
      }
    },
  );

  // 删除连接器
  app.delete<{ Params: ConnectorParams }>('/connectors/:id', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    try {
      await connectorService.delete(request.params.id);
      clearConnectorDependentExecutors();
      return reply.send({ success: true });
    } catch (error: unknown) {
      const err = error as { code?: string };
      if (err.code === 'P2025') {
        return reply.code(404).send({ success: false, error: '连接器不存在' });
      }
      throw error;
    }
  });

  // 启用/停用连接器（全局开关）
  app.patch<{ Params: ConnectorParams; Body: { enabled: boolean } }>(
    '/connectors/:id/status',
    { schema: { body: { type: 'object', required: ['enabled'], properties: { enabled: { type: 'boolean' } } } } },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      try {
        const connector = await connectorService.setEnabled(request.params.id, request.body.enabled);
        clearConnectorDependentExecutors();
        return reply.send({ success: true, data: connector });
      } catch (error: unknown) {
        const err = error as { code?: string };
        if (err.code === 'P2025') {
          return reply.code(404).send({ success: false, error: '连接器不存在' });
        }
        throw error;
      }
    },
  );

  // 测试连接器（MCP 握手 + 工具列表）
  app.post<{ Body: CreateConnectorInput }>(
    '/connectors/test',
    { schema: { body: { type: 'object', properties: connectorBodyProps } } },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      const result = await connectorService.test(request.body);
      return reply.send({ success: true, data: result });
    },
  );

  // 列出某助手绑定的连接器
  app.get<{ Params: AgentParams }>('/agents/:agentId/connectors', async (request, reply) => {
    if (!(await requireAuth(request, reply))) return;
    const bindings = await connectorService.listAgentConnectors(request.params.agentId);
    return reply.send({ success: true, data: bindings });
  });

  // 覆盖式设置某助手启用的连接器
  app.put<{ Params: AgentParams; Body: { connectorIds: string[] } }>(
    '/agents/:agentId/connectors',
    {
      schema: {
        body: {
          type: 'object',
          required: ['connectorIds'],
          properties: { connectorIds: { type: 'array', items: { type: 'string' } } },
        },
      },
    },
    async (request, reply) => {
      if (!(await requireAuth(request, reply))) return;
      try {
        await connectorService.setAgentConnectors(
          request.params.agentId,
          request.body.connectorIds || [],
        );
        clearConnectorDependentExecutors();
        return reply.send({ success: true });
      } catch (error: unknown) {
        const err = error as { code?: string; message?: string };
        if (err.code === 'P2003') {
          return reply.code(404).send({ success: false, error: '助手或连接器不存在' });
        }
        return reply.code(400).send({ success: false, error: err.message || '保存失败' });
      }
    },
  );
}
