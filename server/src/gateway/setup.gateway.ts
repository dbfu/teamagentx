import type { FastifyInstance } from 'fastify';
import { appSettingService } from '../modules/app-setting/app-setting.service.js';
import { checkAllAcpTools } from '../core/agent/acp-tools.service.js';
import { spawnAcpToolInstall } from '../core/agent/acp-tool-install.service.js';

/**
 * 首次引导设置 Gateway
 *
 * 仅桌面版使用。提供：
 * - GET /setup/status  — 获取引导状态 + 已安装工具
 * - POST /setup/complete — 完成引导（注册 + 选默认 Agent）
 */
export async function setupGateway(app: FastifyInstance) {
  // 获取引导状态
  app.get('/setup/status', {
    schema: {
      description: '获取首次引导状态及 ACP 工具安装情况（桌面版专用）',
      tags: ['Setup'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                setupCompleted: { type: 'boolean' },
                defaultAcpTool: { type: 'string' },
                installedTools: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      installed: { type: 'boolean' },
                      version: { type: 'string', nullable: true },
                      cliInstalled: { type: 'boolean' },
                      cliVersion: { type: 'string', nullable: true },
                      sdkInstalled: { type: 'boolean' },
                      sdkVersion: { type: 'string', nullable: true },
                      preferredRuntime: { type: 'string', enum: ['sdk', 'cli'], nullable: true },
                      localConfigAvailable: { type: 'boolean', nullable: true },
                      localConfigPath: { type: 'string', nullable: true },
                      localConfigLabel: { type: 'string', nullable: true },
                      localModels: {
                        type: 'array',
                        nullable: true,
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            apiUrl: { type: 'string', nullable: true },
                            apiKey: { type: 'string', nullable: true },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, reply) => {
    const [setupCompleted, defaultAcpTool, installedTools] = await Promise.all([
      appSettingService.isSetupCompleted(),
      appSettingService.getDefaultAcpTool(),
      Promise.resolve(checkAllAcpTools()),
    ]);

    return reply.send({
      success: true,
      data: { setupCompleted, defaultAcpTool, installedTools },
    });
  });

  // 完成引导
  app.post<{
    Body: {
      username: string;
      password: string;
      avatar?: string;
      defaultAcpTool: string;
      modelConfig?: {
        apiUrl?: string;
        apiKey: string;
        model: string;
        apiProtocol: string;
      };
    };
  }>('/setup/complete', {
    schema: {
      description: '完成首次引导（注册用户 + 设置默认 Agent）',
      tags: ['Setup'],
      body: {
        type: 'object',
        required: ['username', 'password', 'defaultAcpTool'],
        properties: {
          username: { type: 'string', minLength: 2, maxLength: 20 },
          password: { type: 'string', minLength: 4 },
          avatar: { type: 'string' },
          defaultAcpTool: { type: 'string', enum: ['claude', 'codex'] },
          modelConfig: {
            type: 'object',
            required: ['apiKey', 'model', 'apiProtocol'],
            properties: {
              apiUrl: { type: 'string' },
              apiKey: { type: 'string' },
              model: { type: 'string' },
              apiProtocol: { type: 'string', enum: ['anthropic', 'openai'] },
            },
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                token: { type: 'string' },
                userId: { type: 'string' },
                username: { type: 'string' },
                defaultChatRoomId: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { username, password, avatar, defaultAcpTool, modelConfig } = request.body;

    // 幂等检查：已完成则返回错误
    const alreadyDone = await appSettingService.isSetupCompleted();
    if (alreadyDone) {
      return reply.status(400).send({ success: false, error: '引导已完成' });
    }

    try {
      const result = await appSettingService.completeSetup({
        username,
        password,
        avatar,
        defaultAcpTool,
        modelConfig,
      });

      return reply.send({ success: true, data: result });
    } catch (error: any) {
      return reply.status(400).send({ success: false, error: error.message || '引导设置失败' });
    }
  });

  // 安装 ACP 工具
  app.post<{
    Body: { toolId: string };
  }>('/setup/install-tool', {
    schema: {
      description: '自动安装 ACP 工具（桌面版专用）',
      tags: ['Setup'],
      body: {
        type: 'object',
        required: ['toolId'],
        properties: {
          toolId: { type: 'string', enum: ['claude', 'codex'] },
        },
      },
    },
  }, async (request, reply) => {
    const { toolId } = request.body;

    // 流式返回输出
    reply.raw.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    });

    let child: ReturnType<typeof spawnAcpToolInstall>['child'];
    try {
      child = spawnAcpToolInstall(toolId).child;
    } catch (error: any) {
      reply.raw.write(`__ERROR__:${error.message || '安装失败'}`);
      reply.raw.end();
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      reply.raw.write(chunk.toString());
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      reply.raw.write(chunk.toString());
    });

    child.on('close', (code) => {
      reply.raw.write(`\n__EXIT_CODE__:${code}`);
      reply.raw.end();
    });

    child.on('error', (err) => {
      reply.raw.write(`\n__ERROR__:${err.message}`);
      reply.raw.end();
    });
  });
}
