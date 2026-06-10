import { FastifyInstance } from 'fastify';
import { chatRoomCommandService } from '../modules/chatroom/chatroom-command.service.js';

const commandSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    chatRoomId: { type: 'string' },
    name: { type: 'string' },
    content: { type: 'string' },
    sortOrder: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    createdBy: { type: 'string', nullable: true },
  },
};

interface CreateCommandBody {
  name: string;
  content: string;
  sortOrder?: number;
}

interface UpdateCommandBody {
  name?: string;
  content?: string;
  sortOrder?: number;
}

export async function chatRoomCommandGateway(app: FastifyInstance) {
  // 获取群聊的自定义指令列表
  app.get<{ Params: { chatRoomId: string } }>('/chatrooms/:chatRoomId/commands', {
    schema: {
      description: '获取群聊的自定义指令列表',
      tags: ['ChatRoomCommands'],
      params: {
        type: 'object',
        properties: { chatRoomId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: commandSchema },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { chatRoomId } = request.params;
    const commands = await chatRoomCommandService.findByChatRoom(chatRoomId);
    return reply.send({ success: true, data: commands });
  });

  // 创建自定义指令
  app.post<{ Params: { chatRoomId: string }; Body: CreateCommandBody }>('/chatrooms/:chatRoomId/commands', {
    schema: {
      description: '为群聊创建自定义指令',
      tags: ['ChatRoomCommands'],
      params: {
        type: 'object',
        properties: { chatRoomId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['name', 'content'],
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
          sortOrder: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: commandSchema },
        },
        400: {
          type: 'object',
          properties: { success: { type: 'boolean' }, error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { chatRoomId } = request.params;
    const name = request.body.name?.trim();
    const content = request.body.content;

    if (!name) {
      return reply.code(400).send({ success: false, error: '指令名称不能为空' });
    }
    if (!content || !content.trim()) {
      return reply.code(400).send({ success: false, error: '指令内容不能为空' });
    }

    try {
      const command = await chatRoomCommandService.create({
        chatRoomId,
        name,
        content,
        sortOrder: request.body.sortOrder,
        createdBy: (request as any).user?.id,
      });
      return reply.send({ success: true, data: command });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.code(400).send({ success: false, error: '该指令名称已存在' });
      }
      throw error;
    }
  });

  // 更新自定义指令
  app.put<{ Params: { commandId: string }; Body: UpdateCommandBody }>('/commands/:commandId', {
    schema: {
      description: '更新自定义指令',
      tags: ['ChatRoomCommands'],
      params: {
        type: 'object',
        properties: { commandId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
          sortOrder: { type: 'integer' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: commandSchema },
        },
        400: {
          type: 'object',
          properties: { success: { type: 'boolean' }, error: { type: 'string' } },
        },
        404: {
          type: 'object',
          properties: { success: { type: 'boolean' }, error: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const { commandId } = request.params;
    const existing = await chatRoomCommandService.findById(commandId);
    if (!existing) {
      return reply.code(404).send({ success: false, error: '自定义指令不存在' });
    }

    if (request.body.name !== undefined && !request.body.name.trim()) {
      return reply.code(400).send({ success: false, error: '指令名称不能为空' });
    }
    if (request.body.content !== undefined && !request.body.content.trim()) {
      return reply.code(400).send({ success: false, error: '指令内容不能为空' });
    }

    try {
      const command = await chatRoomCommandService.update(commandId, request.body);
      return reply.send({ success: true, data: command });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.code(400).send({ success: false, error: '该指令名称已存在' });
      }
      throw error;
    }
  });

  // 删除自定义指令
  app.delete<{ Params: { commandId: string } }>('/commands/:commandId', {
    schema: {
      description: '删除自定义指令',
      tags: ['ChatRoomCommands'],
      params: {
        type: 'object',
        properties: { commandId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
      },
    },
  }, async (request, reply) => {
    const { commandId } = request.params;
    const existing = await chatRoomCommandService.findById(commandId);
    if (existing) {
      await chatRoomCommandService.delete(commandId);
    }
    return reply.send({ success: true });
  });
}
