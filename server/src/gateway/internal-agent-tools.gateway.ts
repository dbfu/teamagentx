import { FastifyInstance } from 'fastify';
import { sendMessageToAgent } from '../core/agent/agent-handler/agent-dispatch.service.js';
import { isValidInternalAgentToolToken } from '../core/agent/agent-handler/internal-agent-tool-auth.js';

interface SendMessageBody {
  chatRoomId: string;
  sourceAgentId: string;
  targetAgentId?: string;
  targetAgentName?: string;
  content: string;
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
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;
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
}
