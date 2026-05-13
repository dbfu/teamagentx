import { FastifyInstance } from 'fastify';
import { sendMessageToAgent } from '../core/agent/agent-handler/agent-dispatch.service.js';
import { isValidInternalAgentToolToken } from '../core/agent/agent-handler/internal-agent-tool-auth.js';
import { generateImageForAgent } from '../core/agent/image-generation.service.js';

interface SendMessageBody {
  chatRoomId: string;
  sourceAgentId: string;
  targetAgentId?: string;
  targetAgentName?: string;
  content: string;
}

interface GenerateImageBody {
  sourceAgentId: string;
  prompt: string;
  size?: string;
  n?: number;
  filename?: string;
  extraJson?: Record<string, unknown>;
}

function getInternalToolToken(authorization?: string): string | undefined {
  return authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined;
}

export async function internalAgentToolsGateway(app: FastifyInstance) {
  app.post<{ Body: SendMessageBody }>('/internal/agent-tools/send-message-to-agent', {
    schema: {
      description: '内部接口：助手通过工具向同群聊其他助手发送公开消息并触发任务',
      tags: ['Internal Agent Tools'],
      body: {
        type: 'object',
        required: ['chatRoomId', 'sourceAgentId', 'content'],
        properties: {
          chatRoomId: { type: 'string' },
          sourceAgentId: { type: 'string' },
          targetAgentId: { type: 'string' },
          targetAgentName: { type: 'string' },
          content: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const token = getInternalToolToken(request.headers.authorization);
    if (!isValidInternalAgentToolToken(token)) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }

    try {
      const result = await sendMessageToAgent(request.body);
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '发送助手消息失败';
      return reply.code(400).send({ success: false, error: message });
    }
  });

  app.post<{ Body: GenerateImageBody }>('/internal/agent-tools/generate-image', {
    schema: {
      description: '内部接口：助手通过受控服务端工具生成图片。API Key 只在服务端使用。',
      tags: ['Internal Agent Tools'],
      body: {
        type: 'object',
        required: ['sourceAgentId', 'prompt'],
        properties: {
          sourceAgentId: { type: 'string' },
          prompt: { type: 'string' },
          size: { type: 'string' },
          n: { type: 'integer', minimum: 1, maximum: 4 },
          filename: { type: 'string' },
          extraJson: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (request, reply) => {
    const token = getInternalToolToken(request.headers.authorization);
    if (!isValidInternalAgentToolToken(token)) {
      return reply.code(401).send({ success: false, error: 'Unauthorized' });
    }

    try {
      const result = await generateImageForAgent(request.body.sourceAgentId, {
        prompt: request.body.prompt,
        size: request.body.size,
        n: request.body.n,
        filename: request.body.filename,
        extraJson: request.body.extraJson,
      });
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '图片生成失败';
      return reply.code(400).send({ success: false, error: message });
    }
  });
}
