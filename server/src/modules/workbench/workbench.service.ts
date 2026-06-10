import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma.js';
import { messageService } from '../message/message.service.js';
import { chatRoomService } from '../chatroom/chatroom.service.js';
import { llmProviderService } from '../llm-provider/llm-provider.service.js';
import { createLlmClient } from '../../lib/llm-client.js';
import { GROUP_COORDINATOR_ID } from '../../core/agent/system-assistant.constants.js';
import { globalEmit, globalEmitWorkbenchTaskUpdated } from '../../core/agent/agent-handler/status.js';
import type { Message } from '../../types/message.js';

export type WorkbenchTaskStatus =
  | 'draft'
  | 'dispatched'
  | 'in_progress'
  | 'waiting_review'
  | 'needs_input'
  | 'completed';

export type WorkbenchTaskPriority = 'low' | 'medium' | 'high';

const VALID_STATUSES = new Set<WorkbenchTaskStatus>([
  'draft',
  'dispatched',
  'in_progress',
  'waiting_review',
  'needs_input',
  'completed',
]);

const VALID_PRIORITIES = new Set<WorkbenchTaskPriority>(['low', 'medium', 'high']);

interface CreateTaskData {
  title: string;
  description?: string | null;
  chatRoomId: string;
  priority?: WorkbenchTaskPriority;
  dueText?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

interface UpdateTaskData {
  title?: string;
  description?: string | null;
  chatRoomId?: string;
  status?: WorkbenchTaskStatus;
  priority?: WorkbenchTaskPriority;
  dueText?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
}

interface RecommendRoomData {
  title: string;
  description?: string | null;
  expectedOutput?: string | null;
  note?: string | null;
}

export interface WorkbenchRoomRecommendation {
  chatRoomId: string | null;
  reason: string;
}

function trimOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function assertStatus(status: string | undefined): WorkbenchTaskStatus | undefined {
  if (!status) return undefined;
  if (!VALID_STATUSES.has(status as WorkbenchTaskStatus)) {
    throw new Error('任务状态无效');
  }
  return status as WorkbenchTaskStatus;
}

function assertPriority(priority: string | undefined): WorkbenchTaskPriority | undefined {
  if (!priority) return undefined;
  if (!VALID_PRIORITIES.has(priority as WorkbenchTaskPriority)) {
    throw new Error('任务优先级无效');
  }
  return priority as WorkbenchTaskPriority;
}

function getDayRange(date?: string) {
  const base = date ? new Date(`${date}T00:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error('日期格式无效');
  }
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function buildDispatchContent(
  task: Awaited<ReturnType<typeof workbenchTaskService.findByIdOrThrow>>,
  mentionCoordinator: boolean,
) {
  const lines = [
    mentionCoordinator ? '@群调度助手 工作台派发今日任务：' : '工作台派发今日任务：',
    '',
    `任务ID：${task.id}`,
    `任务：${task.title}`,
  ];

  if (task.expectedOutput) lines.push(`期望产出：${task.expectedOutput}`);
  if (task.description) lines.push('', `说明：${task.description}`);
  if (task.note) lines.push('', `补充资料：${task.note}`);

  lines.push(
    '',
    '请拆解任务、分配给合适助手，并持续汇报进展。',
    '如果需要老板确认或补充信息，请在回复中明确说明。',
  );

  return lines.join('\n');
}

function extractJsonCandidate(content: string): string {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) return jsonMatch[1].trim();

  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) return content.slice(start, end + 1).trim();

  return content.trim();
}

function parseRecommendationResponse(content: string, candidateIds: Set<string>): WorkbenchRoomRecommendation {
  try {
    const parsed = JSON.parse(extractJsonCandidate(content)) as Record<string, unknown>;
    const chatRoomId = typeof parsed.chatRoomId === 'string' && candidateIds.has(parsed.chatRoomId)
      ? parsed.chatRoomId
      : null;
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : chatRoomId
        ? 'LLM 根据任务内容推荐该群聊'
        : 'LLM 没有给出明确匹配的群聊';
    return { chatRoomId, reason };
  } catch {
    return { chatRoomId: null, reason: 'LLM 返回格式无法解析，请手动选择目标群聊' };
  }
}

const RECOMMEND_ROOM_PROMPT = `你是 TeamAgentX 工作台的目标群聊推荐器。
根据用户要创建的任务，从候选群聊中选择最适合承接执行的一个群聊。

要求：
- 只能从候选群聊的 id 中选择，不能编造 id。
- 优先考虑群聊名称、描述、规则、群内助手能力与任务的匹配程度。
- 如果没有明确匹配，chatRoomId 返回 null，不要强行猜测。
- 只返回 JSON，不要 Markdown，不要额外说明。

返回格式：
{"chatRoomId":"候选群聊ID或null","reason":"一句中文推荐理由"}`;

export const workbenchTaskService = {
  async findByIdOrThrow(id: string) {
    const task = await prisma.workbenchTask.findUnique({
      where: { id },
      include: {
        chatRoom: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    if (!task) {
      throw new Error('任务不存在');
    }

    return task;
  },

  async findToday(createdBy: string, date?: string) {
    const { start, end } = getDayRange(date);
    return prisma.workbenchTask.findMany({
      where: {
        createdBy,
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      include: {
        chatRoom: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
      orderBy: [
        { createdAt: 'asc' },
      ],
    });
  },

  async create(data: CreateTaskData) {
    const title = data.title.trim();
    if (!title) {
      throw new Error('任务内容不能为空');
    }
    await this.assertCanUseChatRoom(data.chatRoomId, data.createdBy ?? null);

    return prisma.workbenchTask.create({
      data: {
        title,
        description: trimOptional(data.description),
        chatRoomId: data.chatRoomId,
        priority: assertPriority(data.priority) ?? 'medium',
        dueText: trimOptional(data.dueText),
        expectedOutput: trimOptional(data.expectedOutput),
        note: trimOptional(data.note),
        createdBy: data.createdBy ?? null,
        lastActivityAt: new Date(),
      },
      include: {
        chatRoom: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });
  },

  async update(id: string, data: UpdateTaskData, userId: string) {
    const task = await this.findByIdOrThrow(id);
    this.assertOwner(task.createdBy, userId);

    const nextChatRoomId = data.chatRoomId ?? task.chatRoomId;
    if (nextChatRoomId !== task.chatRoomId) {
      await this.assertCanUseChatRoom(nextChatRoomId, userId);
    }

    const status = assertStatus(data.status);
    const completedAt = status === 'completed' && task.status !== 'completed'
      ? new Date()
      : status && status !== 'completed'
        ? null
        : undefined;

    return prisma.workbenchTask.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined ? { description: trimOptional(data.description) } : {}),
        ...(data.chatRoomId !== undefined ? { chatRoomId: nextChatRoomId } : {}),
        ...(status ? { status } : {}),
        ...(data.priority !== undefined ? { priority: assertPriority(data.priority) } : {}),
        ...(data.dueText !== undefined ? { dueText: trimOptional(data.dueText) } : {}),
        ...(data.expectedOutput !== undefined ? { expectedOutput: trimOptional(data.expectedOutput) } : {}),
        ...(data.note !== undefined ? { note: trimOptional(data.note) } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        lastActivityAt: new Date(),
      },
      include: {
        chatRoom: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });
  },

  async delete(id: string, userId: string) {
    const task = await this.findByIdOrThrow(id);
    this.assertOwner(task.createdBy, userId);
    await prisma.workbenchTask.delete({ where: { id } });
  },

  async dispatch(id: string, user: { id: string; username: string }) {
    const task = await this.findByIdOrThrow(id);
    this.assertOwner(task.createdBy, user.id);
    await this.assertCanUseChatRoom(task.chatRoomId, user.id);

    const chatRoom = await prisma.chatRoom.findUnique({
      where: { id: task.chatRoomId },
      select: { agentTriggerMode: true, defaultAgentId: true },
    });
    const triggerMode = chatRoom?.agentTriggerMode ?? 'coordinator';

    // 调度模式决定派发方式：
    // - coordinator（群调度）：直接发普通消息，handler 自动唤起群调度助手分配任务
    // - manual（手动）：@群调度助手 来派发任务
    // - auto（自由协调）：指定了默认接收助手则发普通消息交给它，否则 @群调度助手
    const mentionCoordinator =
      triggerMode === 'manual'
        ? true
        : triggerMode === 'auto'
          ? !chatRoom?.defaultAgentId
          : false;
    // 协调模式由 handler 自动唤起群调度助手；其余模式仅在显式 @ 时才依赖它
    const requireCoordinator = triggerMode === 'coordinator' || mentionCoordinator;

    if (requireCoordinator) {
      const coordinatorAgent = await prisma.agent.findUnique({
        where: { id: GROUP_COORDINATOR_ID },
        select: { id: true, name: true, isActive: true },
      });
      if (!coordinatorAgent?.isActive) {
        throw new Error('群调度助手不存在或未启用');
      }
    }

    const messageId = randomUUID();
    const now = new Date();
    const content = buildDispatchContent(task, mentionCoordinator);

    await messageService.create({
      id: messageId,
      type: 'MESSAGE',
      content,
      time: now,
      userId: user.id,
      chatRoomId: task.chatRoomId,
      replyMessageId: null,
      isHuman: true,
    });

    // 必须先把工作台任务落库为 dispatched，再广播消息触发群调度助手。
    // 协调器在 dispatch 决策后会调用 syncRoomDispatchTaskStatus(false) 把 dispatched→in_progress；
    // 若广播在前、落库在后，协调器（即便经过 LLM 调用）可能在状态写入前就执行该流转，
    // 此时任务仍是 draft，流转因查不到 dispatched 任务而丢失，导致任务永久停留在「已派发」、
    // 进不到「执行中」。
    const updated = await prisma.workbenchTask.update({
      where: { id },
      data: {
        status: 'dispatched',
        dispatchMessageId: messageId,
        dispatchedAt: now,
        lastActivityAt: now,
        completedAt: null,
      },
      include: {
        chatRoom: {
          select: {
            id: true,
            name: true,
            avatar: true,
            avatarColor: true,
          },
        },
      },
    });

    const message: Message = {
      id: messageId,
      type: 'message',
      content,
      time: now,
      user: user.username,
      userId: user.id,
      chatRoomId: task.chatRoomId,
      replyMessageId: null,
      isHuman: true,
    };

    if (globalEmit) {
      await globalEmit(message, task.chatRoomId);
    }

    return updated;
  },

  async dispatchMany(ids: string[], user: { id: string; username: string }) {
    const dispatched = [];
    for (const id of ids) {
      const task = await this.findByIdOrThrow(id);
      this.assertOwner(task.createdBy, user.id);
      if (task.status !== 'draft') continue;
      dispatched.push(await this.dispatch(id, user));
    }
    return dispatched;
  },

  /**
   * 随群内 agent 执行进度，自动推进该群「已派发」任务的状态。
   * 由群调度助手在做出决策后调用：
   * - roomIdle=false（群调度助手调度了 agent）：dispatched → in_progress
   * - roomIdle=true（群调度助手确认无需调度）：dispatched / in_progress → waiting_review
   * 仅做状态流转，不写 completedAt；最终是否「已完成」由用户手动确认。
   * 状态变更会通过 socket 推送给任务创建者，实现前端实时刷新。
   */
  async syncRoomDispatchTaskStatus(chatRoomId: string, roomIdle: boolean) {
    console.log('[workbench] syncRoomDispatchTaskStatus 调用:', {
      chatRoomId,
      roomIdle,
    });
    const targets = await prisma.workbenchTask.findMany({
      where: {
        chatRoomId,
        status: { in: ['dispatched', 'in_progress'] },
      },
    });
    console.log('[workbench] 找到目标任务:', {
      count: targets.length,
      statuses: targets.map(t => ({ id: t.id, status: t.status })),
    });
    if (targets.length === 0) return;

    const now = new Date();
    for (const target of targets) {
      let nextStatus: WorkbenchTaskStatus | null = null;
      if (roomIdle) {
        nextStatus = 'waiting_review';
      } else if (target.status === 'dispatched') {
        nextStatus = 'in_progress';
      }
      console.log('[workbench] 任务状态更新:', {
        taskId: target.id,
        currentStatus: target.status,
        nextStatus,
      });
      if (!nextStatus) continue;

      const updated = await prisma.workbenchTask.update({
        where: { id: target.id },
        data: { status: nextStatus, lastActivityAt: now },
        include: {
          chatRoom: {
            select: { id: true, name: true, avatar: true, avatarColor: true },
          },
        },
      });

      console.log('[workbench] 状态已更新:', {
        taskId: updated.id,
        status: updated.status,
      });

      if (globalEmitWorkbenchTaskUpdated && updated.createdBy) {
        globalEmitWorkbenchTaskUpdated(updated, updated.createdBy);
      }
    }
  },

  /**
   * 助手消息中 @了用户时，把该群「已派发 / 执行中」的工作台任务流转为 needs_input（需补充）。
   * 表示助手在等待用户提供额外信息，任务暂时卡住。
   */
  async syncNeedsInputOnUserMention(chatRoomId: string) {
    const targets = await prisma.workbenchTask.findMany({
      where: {
        chatRoomId,
        status: { in: ['dispatched', 'in_progress'] },
      },
    });
    if (targets.length === 0) return;

    const now = new Date();
    for (const target of targets) {
      const updated = await prisma.workbenchTask.update({
        where: { id: target.id },
        data: { status: 'needs_input', lastActivityAt: now },
        include: {
          chatRoom: {
            select: { id: true, name: true, avatar: true, avatarColor: true },
          },
        },
      });
      if (globalEmitWorkbenchTaskUpdated && updated.createdBy) {
        globalEmitWorkbenchTaskUpdated(updated, updated.createdBy);
      }
    }
  },

  async recommendRoom(data: RecommendRoomData, userId: string): Promise<WorkbenchRoomRecommendation> {
    const taskText = [
      data.title?.trim(),
      trimOptional(data.expectedOutput),
      trimOptional(data.description),
      trimOptional(data.note),
    ].filter(Boolean).join('\n');

    if (!taskText) {
      throw new Error('请先填写任务内容或补充说明');
    }

    const rooms = await prisma.chatRoom.findMany({
      where: {
        isQuickChatRoom: false,
        OR: [
          { ownerId: userId },
          { chatRoomAgents: { some: { userId } } },
        ],
      },
      include: {
        chatRoomAgents: {
          include: {
            agent: {
              select: {
                name: true,
                description: true,
              },
            },
          },
        },
      },
      orderBy: [
        { isPinned: 'desc' },
        { updatedAt: 'desc' },
      ],
    });

    if (rooms.length === 0) {
      throw new Error('暂无可推荐的群聊');
    }

    const provider = await llmProviderService.findDefault('text');
    if (!provider) {
      throw new Error('没有可用的默认模型配置，无法使用 LLM 推荐');
    }

    const candidates = rooms.map((room) => ({
      id: room.id,
      name: room.name,
      description: room.description ?? '',
      rules: room.rules ?? '',
      agents: room.chatRoomAgents
        .map((member) => member.agent)
        .filter(Boolean)
        .map((agent) => ({
          name: agent!.name,
          description: agent!.description ?? '',
        })),
    }));
    const candidateIds = new Set(candidates.map((room) => room.id));

    const client = createLlmClient(provider, { temperature: 0, maxTokens: 500 });
    const content = await client.invoke([
      { role: 'system', content: RECOMMEND_ROOM_PROMPT },
      {
        role: 'user',
        content: JSON.stringify({
          task: {
            title: data.title,
            expectedOutput: data.expectedOutput ?? null,
            description: data.description ?? null,
            note: data.note ?? null,
          },
          candidates,
        }, null, 2),
      },
    ]);

    return parseRecommendationResponse(content, candidateIds);
  },

  async assertCanUseChatRoom(chatRoomId: string, userId: string | null) {
    const chatRoom = await chatRoomService.findById(chatRoomId);
    if (!chatRoom) {
      throw new Error('目标群聊不存在');
    }
    if (!userId) return;
    if (chatRoom.ownerId === userId) return;
    const isMember = await chatRoomService.isAgent(chatRoomId, userId);
    if (!isMember) {
      throw new Error('你不是该群聊成员，不能派发任务');
    }
  },

  assertOwner(createdBy: string | null, userId: string) {
    if (createdBy && createdBy !== userId) {
      throw new Error('只能操作自己创建的工作台任务');
    }
  },
};
