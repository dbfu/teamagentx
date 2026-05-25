import { FastifyInstance, FastifyReply } from 'fastify';
import { messageService } from '../modules/message/message.service.js';
import { executionRecordService } from '../modules/execution-record/execution-record.service.js';
import { checkpointService } from '../modules/checkpoint/checkpoint.service.js';
import { taskQueueService } from '../modules/task-queue/task-queue.service.js';
import { agentMemoryService } from '../modules/agent-memory/agent-memory.service.js';
import { abortControllers, processingMap } from '../core/agent/agent-handler/cache.js';
import {
  broadcastAgentStatus,
  broadcastAgentTaskQueue,
  clearExecutorCache,
  discardExecutionResultKeys,
  executorCache,
  clearClaudeSdkFileSystemContext,
  clearCodexSdkFileSystemContext,
} from '../core/agent/agent-handler/index.js';
import { clearInternalCoordinatorContext } from '../core/agent/agent-handler/internal-coordinator-context.js';
import { chatRoomService } from '../modules/chatroom/chatroom.service.js';
import { formatBridgeConversationSender } from '../modules/bridge/bridge-platform-display.js';
import prisma from '../lib/prisma.js';

const messageSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['MESSAGE', 'REPLY'] },
    content: { type: 'string' },
    time: { type: 'string' },
    userId: { type: 'string', nullable: true },
    agentId: { type: 'string', nullable: true },
    chatRoomId: { type: 'string' },
    replyMessageId: { type: 'string', nullable: true },
    isHuman: { type: 'boolean' },
    executionRecordId: { type: 'string', nullable: true },
    executionDuration: { type: 'integer', nullable: true },
    totalTokens: { type: 'integer', nullable: true },
    cacheReadTokens: { type: 'integer', nullable: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    user: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        socketId: { type: 'string' },
        username: { type: 'string' },
      },
    },
    agent: {
      type: 'object',
      nullable: true,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        avatar: { type: 'string', nullable: true },
        avatarColor: { type: 'string', nullable: true },
      },
    },
  },
};

interface MessageQuery {
  chatRoomId?: string;
  beforeMessageId?: string;
  take?: number;
}

type MessageListItem = Awaited<ReturnType<typeof messageService.findMany>>[number];
const DEFAULT_MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGE_SIZE = 100;

function normalizeMessagePageSize(value?: number) {
  if (!value || !Number.isFinite(value)) return DEFAULT_MESSAGE_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(value), 1), MAX_MESSAGE_PAGE_SIZE);
}

async function applyBridgeMessageSenders<T extends MessageListItem>(messages: T[]): Promise<T[]> {
  const messageIds = messages
    .filter((message) => message.isHuman && !message.userId && !message.user)
    .map((message) => message.id);
  if (messageIds.length === 0) return messages;

  const bridgeEvents = await prisma.bridgeEvent.findMany({
    where: {
      direction: 'inbound',
      status: 'success',
      messageId: { in: messageIds },
    },
    select: {
      messageId: true,
      platform: true,
      externalId: true,
      agentName: true,
    },
  });
  if (bridgeEvents.length === 0) return messages;

  const bridgeEventByMessageId = new Map(
    bridgeEvents
      .filter((event): event is typeof event & { messageId: string } => !!event.messageId)
      .map((event) => [event.messageId, event]),
  );

  return messages.map((message) => {
    const bridgeEvent = bridgeEventByMessageId.get(message.id);
    if (!bridgeEvent) return message;
    return {
      ...message,
      user: {
        id: `bridge:${bridgeEvent.platform}:${bridgeEvent.externalId}`,
        socketId: '',
        username: formatBridgeConversationSender(bridgeEvent.platform, bridgeEvent.externalId, bridgeEvent.agentName ?? undefined),
      },
    };
  }) as T[];
}

export async function messageGateway(app: FastifyInstance) {
  // Get messages - optionally filtered by chatRoom
  app.get<{ Querystring: MessageQuery }>('/messages', {
    schema: {
      description: '获取消息列表（可选按群聊筛选）',
      tags: ['Messages'],
      querystring: {
        type: 'object',
        properties: {
          chatRoomId: { type: 'string', description: 'Filter by chatRoom ID' },
          beforeMessageId: { type: 'string', description: 'Load messages older than this message ID' },
          take: { type: 'integer', minimum: 1, maximum: MAX_MESSAGE_PAGE_SIZE, description: 'Page size' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array', items: messageSchema },
            pagination: {
              type: 'object',
              properties: {
                hasMore: { type: 'boolean' },
                limit: { type: 'integer' },
                beforeMessageId: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { chatRoomId, beforeMessageId } = request.query;
    const take = normalizeMessagePageSize(request.query.take);

    if (chatRoomId) {
      const messages = await messageService.findByChatRoomId(chatRoomId, {
        take: take + 1,
        order: 'desc',
        beforeMessageId,
      });
      const hasMore = messages.length > take;
      const page = (hasMore ? messages.slice(0, take) : messages).reverse();
      return reply.send({
        success: true,
        data: await applyBridgeMessageSenders(page),
        pagination: {
          hasMore,
          limit: take,
          beforeMessageId: page[0]?.id ?? null,
        },
      });
    }

    const messages = await messageService.findMany({ take });
    return reply.send({ success: true, data: await applyBridgeMessageSenders(messages) });
  });

  // Get single message by ID
  app.get<{ Params: { id: string } }>('/messages/:id', {
    schema: {
      description: '根据 ID 获取单条消息',
      tags: ['Messages'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: messageSchema,
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const message = await messageService.findById(id);

    if (!message) {
      return reply.code(404).send({ success: false, error: '消息不存在' });
    }

    const [messageWithBridgeSender] = await applyBridgeMessageSenders([message]);
    return reply.send({ success: true, data: messageWithBridgeSender });
  });

  const deleteMessagesBatchHandler = async (
    request: { body?: { ids?: string[] } },
    reply: FastifyReply,
  ) => {
    const ids = Array.isArray(request.body?.ids) ? request.body.ids : [];
    const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) {
      return reply.code(400).send({ success: false, error: '消息 ID 不能为空' });
    }

    const result = await messageService.deleteByIds(uniqueIds);

    try {
      for (const chatRoomId of result.chatRoomIds) {
        const chatRoomAgents = await prisma.chatRoomAgent.findMany({
          where: { chatRoomId },
          include: {
            agent: { select: { id: true, name: true, type: true, acpTool: true } },
          },
        });

        for (const chatRoomAgent of chatRoomAgents) {
          if (!chatRoomAgent.agent) continue;

          await agentMemoryService.clear(chatRoomId, chatRoomAgent.agent.id);
          await chatRoomService.updateLastInjectedMessageId(chatRoomId, chatRoomAgent.agent.id, null);

          if (chatRoomAgent.agent.type === 'builtin') {
            await checkpointService.clearChatRoomAgentContext(chatRoomId, chatRoomAgent.agent.name);
          } else if (chatRoomAgent.agent.type === 'acp') {
            for (const [cacheKey, executor] of executorCache.entries()) {
              if (cacheKey.startsWith(`${chatRoomId}_`) && cacheKey.includes(`_${chatRoomAgent.agent.name}`)) {
                try {
                  await executor.cleanup?.();
                } catch (cleanupError) {
                  console.warn(`[MessageGateway] 清理 ACP executor 失败: ${cacheKey}`, cleanupError);
                }
              }
            }
            const acpTool = (chatRoomAgent.agent as any).acpTool;
            if (acpTool === 'codex') {
              clearCodexSdkFileSystemContext(chatRoomAgent.agent.id, chatRoomId);
            } else {
              clearClaudeSdkFileSystemContext(chatRoomAgent.agent.id, chatRoomId);
            }
          }

          clearExecutorCache(chatRoomAgent.agent.name, chatRoomId);
        }

        await clearInternalCoordinatorContext(chatRoomId, {
          abortRunning: false,
          deleteTasksAndExecutions: false,
        });
      }
    } catch (error) {
      console.error('[MessageGateway] 批量删除消息后清理上下文失败:', error);
    }

    return reply.send({ success: true, data: { count: result.count } });
  };

  const deleteMessagesBatchSchema = {
    description: '批量删除消息，并重置相关房间的上下文注入缓存',
    tags: ['Messages'],
    body: {
      type: 'object',
      required: ['ids'],
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
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
              count: { type: 'integer' },
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
  };

  // Delete multiple messages by IDs. Prefer POST because some clients/proxies drop DELETE bodies.
  app.post<{ Body: { ids?: string[] } }>('/messages/batch-delete', {
    schema: deleteMessagesBatchSchema,
  }, deleteMessagesBatchHandler);

  // Backward-compatible route for clients that already use DELETE with a JSON body.
  app.delete<{ Body: { ids?: string[] } }>('/messages/batch', {
    schema: {
      ...deleteMessagesBatchSchema,
      deprecated: true,
      description: '批量删除消息（兼容旧接口；推荐使用 POST /messages/batch-delete）',
    },
  }, deleteMessagesBatchHandler);

  // Delete single message by ID
  app.delete<{ Params: { id: string } }>('/messages/:id', {
    schema: {
      description: '根据 ID 删除单条消息',
      tags: ['Messages'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const message = await messageService.findById(id);

    if (!message) {
      return reply.code(404).send({ success: false, error: '消息不存在' });
    }

    await messageService.deleteById(id);
    return reply.send({ success: true });
  });

  // Get execution record for a message
  app.get<{ Params: { id: string } }>('/messages/:id/execution', {
    schema: {
      description: '获取消息关联的执行记录',
      tags: ['Messages'],
      params: {
        type: 'object',
        properties: { id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', nullable: true, additionalProperties: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const message = await messageService.findById(id);

    if (!message) {
      return reply.code(404).send({ success: false, error: '消息不存在' });
    }

    if (!message.executionRecordId) {
      return reply.code(404).send({ success: false, error: '该消息无执行记录' });
    }

    const executionRecord = await executionRecordService.findById(message.executionRecordId);
    if (!executionRecord) {
      return reply.code(404).send({ success: false, error: '执行记录不存在' });
    }

    return reply.send({ success: true, data: executionRecord });
  });

  // Clear all messages in a chatRoom
  app.delete<{ Params: { chatRoomId: string } }>('/messages/chatroom/:chatRoomId', {
    schema: {
      description: '清空群聊中的所有消息',
      tags: ['Messages'],
      params: {
        type: 'object',
        properties: { chatRoomId: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { chatRoomId } = request.params;

    // 1. 中止群内所有正在执行的任务
    let abortedCount = 0;
    for (const [key, controller] of abortControllers) {
      if (key.startsWith(`${chatRoomId}_`)) {
        discardExecutionResultKeys.add(key);
        controller.abort();
        abortControllers.delete(key);
        abortedCount++;
      }
    }
    for (const [key] of processingMap) {
      if (key.startsWith(`${chatRoomId}_`)) {
        processingMap.delete(key);
      }
    }
    if (abortedCount > 0) {
      console.log(`[MessageGateway] 已中止群聊 ${chatRoomId} 中 ${abortedCount} 个正在执行的任务`);
    }

    // 2. 删除群聊的所有待处理任务
    await taskQueueService.deleteByChatRoomId(chatRoomId);

    // 2.25. 删除群聊的所有消息
    const deletedMessages = await messageService.deleteByChatRoomId(chatRoomId);

    // 2.5. 删除群聊的所有执行记录
    await executionRecordService.deleteByChatRoomId(chatRoomId);

    const io = (app as any).io as { to: (room: string) => { emit: (event: string, payload: unknown) => void } } | undefined;

    // 3. 同时清空群聊中所有助手的上下文
    const affectedAgentIds = new Set<string>();
    try {
      // 获取群聊中的所有助手
      const chatRoomAgents = await prisma.chatRoomAgent.findMany({
        where: { chatRoomId },
        include: {
          agent: { select: { id: true, name: true, type: true, acpTool: true } },
        },
      });

      // 为每个助手清空上下文
      for (const chatRoomAgent of chatRoomAgents) {
        if (!chatRoomAgent.agent) continue;
        affectedAgentIds.add(chatRoomAgent.agent.id);

        // 清空长期记忆摘要
        await agentMemoryService.clear(chatRoomId, chatRoomAgent.agent.id);

        if (chatRoomAgent.agent.type === 'builtin') {
          await checkpointService.clearChatRoomAgentContext(
            chatRoomId,
            chatRoomAgent.agent.name
          );
        } else if (chatRoomAgent.agent.type === 'acp') {
          // 清理 executor 缓存中的 executor（如果有）
          for (const [cacheKey, executor] of executorCache.entries()) {
            if (cacheKey.startsWith(`${chatRoomId}_`) && cacheKey.includes(`_${chatRoomAgent.agent.name}`)) {
              try {
                await executor.cleanup?.();
              } catch (cleanupError) {
                console.warn(`[MessageGateway] 清理 ACP executor 失败: ${cacheKey}`, cleanupError);
              }
            }
          }
          // 清理文件系统上下文（无论 executor 是否在缓存中）
          const acpTool = (chatRoomAgent.agent as any).acpTool;
          if (acpTool === 'codex') {
            clearCodexSdkFileSystemContext(chatRoomAgent.agent.id, chatRoomId);
          } else {
            // 默认使用 Claude SDK 清理（包括 acpTool 为 null 或 'claude'）
            clearClaudeSdkFileSystemContext(chatRoomAgent.agent.id, chatRoomId);
          }
        }

        clearExecutorCache(chatRoomAgent.agent.name, chatRoomId);
        await chatRoomService.updateLastInjectedMessageId(chatRoomId, chatRoomAgent.agent.id, null);
      }

      await clearInternalCoordinatorContext(chatRoomId);

      console.log(`[MessageGateway] 已清空群聊 ${chatRoomId} 的所有助手上下文`);
    } catch (error) {
      console.error(`[MessageGateway] 清空助手上下文失败:`, error);
      // 即使清空上下文失败，消息已清空，仍返回成功
    }

    for (const agentId of affectedAgentIds) {
      broadcastAgentTaskQueue(chatRoomId, agentId, []);
    }
    io?.to(chatRoomId).emit('agent:inactive-tasks', { chatRoomId, tasks: [] });
    await broadcastAgentStatus(chatRoomId);

    return reply.send({ success: true, count: deletedMessages.count });
  });

  // Clear execution records for a chatRoom and agent
  app.delete<{ Params: { chatRoomId: string; agentId: string } }>('/chatrooms/:chatRoomId/agents/:agentId/executions', {
    schema: {
      description: '清除助手在群聊中的所有执行记录',
      tags: ['ExecutionRecords'],
      params: {
        type: 'object',
        properties: {
          chatRoomId: { type: 'string' },
          agentId: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { chatRoomId, agentId } = request.params;
    const result = await executionRecordService.deleteByChatRoomAndAgent(chatRoomId, agentId);
    return reply.send({ success: true, count: result.count });
  });
}
