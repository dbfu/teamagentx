import type { FastifyInstance } from 'fastify';

/**
 * 注册 Swagger API 文档
 * 仅在开发模式下使用，Electron 打包后不需要
 */
export async function registerSwagger(app: FastifyInstance, port: number): Promise<void> {
  const [{ default: swagger }, { default: swaggerUi }] = await Promise.all([
    import('@fastify/swagger'),
    import('@fastify/swagger-ui'),
  ]);

  // 注册 Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'TeamAgentX API',
        description: 'AI 面试模拟聊天室 API',
        version: '1.0.0',
      },
      servers: [
        {
          url: `http://localhost:${port}`,
          description: 'Local server',
        },
      ],
      tags: [
        { name: 'Health', description: '健康检查接口' },
        { name: 'Auth', description: '认证接口' },
        { name: 'Categories', description: '助手分类管理接口' },
        { name: 'LlmProviders', description: 'LLM 供应商管理接口' },
        { name: 'Agents', description: 'Agent 管理接口' },
        { name: 'Messages', description: '消息管理接口' },
        { name: 'ChatRooms', description: '群聊管理接口' },
        { name: 'Skills', description: 'Skills 安装管理接口' },
        { name: 'CronTasks', description: '定时任务管理接口' },
        { name: 'TokenUsage', description: 'Token 使用统计接口' },
        { name: 'Upload', description: '文件上传接口' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  // OpenAPI JSON 规范
  app.get('/openapi.json', async (_request, reply) => {
    return reply.send(app.swagger());
  });
}
