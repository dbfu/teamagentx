import type { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma.js';
import {
  ensureWorkspaceRoot,
  listWorkspaceEntries,
  readWorkspaceFile,
  resolveChatRoomWorkspaceRoot,
} from '../modules/chatroom/workspace-files.service.js';

interface WorkspaceRoomParams {
  id: string;
}

interface WorkspaceFileQuery {
  path?: string;
}

interface WorkspaceRoom {
  id: string;
  workDir: string | null;
  ownerId: string | null;
}

async function getWorkspaceRoom(chatRoomId: string, userId?: string): Promise<{ room: WorkspaceRoom | null; allowed: boolean }> {
  const room = await prisma.chatRoom.findUnique({
    where: { id: chatRoomId },
    select: { id: true, workDir: true, ownerId: true },
  });
  if (!room || !userId) return { room, allowed: false };
  if (room.ownerId === userId) return { room, allowed: true };

  const member = await prisma.chatRoomAgent.findFirst({
    where: { chatRoomId, userId },
    select: { id: true },
  });
  return { room, allowed: Boolean(member) };
}

export async function workspaceGateway(app: FastifyInstance) {
  app.get<{ Params: WorkspaceRoomParams }>('/chatrooms/:id/workspace/tree', {
    schema: {
      description: '获取群聊工作目录文件树',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { room, allowed } = await getWorkspaceRoom(request.params.id, request.user?.id);
    if (!room) return reply.code(404).send({ success: false, error: '群聊不存在' });
    if (!allowed) return reply.code(403).send({ success: false, error: '无权读取该群聊工作目录' });

    try {
      const root = ensureWorkspaceRoot(resolveChatRoomWorkspaceRoot(room.id, room.workDir));
      return reply.send({ success: true, data: { root, entries: listWorkspaceEntries(root) } });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '读取工作目录失败' });
    }
  });

  app.get<{ Params: WorkspaceRoomParams; Querystring: WorkspaceFileQuery }>('/chatrooms/:id/workspace/file', {
    schema: {
      description: '读取群聊工作目录文件',
      tags: ['ChatRooms'],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string', minLength: 1, maxLength: 4_096 } },
      },
    },
  }, async (request, reply) => {
    const { room, allowed } = await getWorkspaceRoom(request.params.id, request.user?.id);
    if (!room) return reply.code(404).send({ success: false, error: '群聊不存在' });
    if (!allowed) return reply.code(403).send({ success: false, error: '无权读取该群聊工作目录' });

    const relativePath = request.query.path?.trim();
    if (!relativePath) return reply.code(400).send({ success: false, error: '文件路径不能为空' });

    try {
      const root = ensureWorkspaceRoot(resolveChatRoomWorkspaceRoot(room.id, room.workDir));
      return reply.send({ success: true, data: { file: readWorkspaceFile(root, relativePath) } });
    } catch (error) {
      return reply.code(400).send({ success: false, error: error instanceof Error ? error.message : '读取文件失败' });
    }
  });
}
