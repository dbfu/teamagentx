import prisma from '../../lib/prisma.js';
import type { QuickChatSession, ChatRoom } from '@prisma/client';
import {
  getSessionMessages,
  listSessions,
  type SDKSessionInfo,
  type SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface QuickChatSessionCreateData {
  agentId: string;
  chatRoomId: string;
}

export interface QuickChatSessionWithRoom extends QuickChatSession {
  chatRoom: ChatRoom & {
    chatRoomAgents: Array<{
      id: string;
      userId: string | null;
      agentId: string | null;
    }>;
  };
}

export interface LocalClaudeSessionInfo {
  sessionId: string;
  title: string;
  summary: string;
  customTitle: string | null;
  firstPrompt: string | null;
  cwd: string | null;
  gitBranch: string | null;
  tag: string | null;
  createdAt: string | null;
  lastModified: string;
  fileSize: number | null;
  isCurrent: boolean;
}

export interface ClaudeSessionBinding {
  sessionId: string;
  title: string | null;
  lastModified: Date | null;
}

export interface ImportedClaudeSessionMessage {
  role: 'user' | 'assistant';
  content: string;
}

type QuickChatSessionRuntime = QuickChatSession & {
  chatRoom: {isQuickChatRoom: boolean};
  agent: {type: string; acpTool: string | null};
};

function sanitizeClaudeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getGlobalClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function getTeamAgentClaudeConfigDir(agentId: string): string {
  return path.join(os.homedir(), '.teamagentx', 'acp-config', agentId || 'default');
}

function findClaudeTranscriptFile(configDir: string, cwd: string, sessionId: string): string | null {
  const directPath = path.join(
    configDir,
    'projects',
    sanitizeClaudeProjectPath(cwd),
    `${sessionId}.jsonl`,
  );
  if (fs.existsSync(directPath)) return directPath;

  const projectsDir = path.join(configDir, 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  for (const projectKey of fs.readdirSync(projectsDir)) {
    const candidate = path.join(projectsDir, projectKey, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function copyClaudeTranscriptToTeamAgentConfig(params: {
  agentId: string;
  workDir: string;
  sourceCwd: string;
  sessionId: string;
}): void {
  const sourceConfigDir = getGlobalClaudeConfigDir();
  const targetConfigDir = getTeamAgentClaudeConfigDir(params.agentId);
  const sourceFile = findClaudeTranscriptFile(
    sourceConfigDir,
    params.sourceCwd,
    params.sessionId,
  );

  if (!sourceFile) {
    throw new Error('未找到该 Claude 本地会话 transcript 文件');
  }

  const targetProjectDir = path.join(
    targetConfigDir,
    'projects',
    sanitizeClaudeProjectPath(params.workDir),
  );
  fs.mkdirSync(targetProjectDir, {recursive: true});
  fs.copyFileSync(sourceFile, path.join(targetProjectDir, `${params.sessionId}.jsonl`));

  const sourceSessionDir = sourceFile.replace(/\.jsonl$/, '');
  if (fs.existsSync(sourceSessionDir)) {
    fs.cpSync(
      sourceSessionDir,
      path.join(targetProjectDir, params.sessionId),
      {recursive: true, force: true},
    );
  }
}

function getClaudeSessionTitle(session: SDKSessionInfo): string {
  return (
    session.customTitle?.trim() ||
    session.summary?.trim() ||
    session.firstPrompt?.trim() ||
    '未命名会话'
  );
}

function toLocalClaudeSessionInfo(
  session: SDKSessionInfo,
  currentSessionId?: string | null,
): LocalClaudeSessionInfo {
  return {
    sessionId: session.sessionId,
    title: getClaudeSessionTitle(session),
    summary: session.summary || '',
    customTitle: session.customTitle || null,
    firstPrompt: session.firstPrompt || null,
    cwd: session.cwd || null,
    gitBranch: session.gitBranch || null,
    tag: session.tag || null,
    createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : null,
    lastModified: new Date(session.lastModified).toISOString(),
    fileSize: session.fileSize ?? null,
    isCurrent: session.sessionId === currentSessionId,
  };
}

function extractTextFromClaudeContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((block: any) => {
      if (block?.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function hasClaudeContentBlock(content: unknown, types: string[]): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((block: any) => types.includes(block?.type));
}

// 本地斜杠命令（/model、/effort 等）及其输出在 transcript 中会以特殊标签或 caveat 形式保存，导入时不展示
function isLocalCommandText(text: string): boolean {
  if (/<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/.test(text)) {
    return true;
  }
  return text.startsWith('Caveat: The messages below were generated by the user while running local commands');
}

function extractImportedClaudeMessages(messages: SessionMessage[]): ImportedClaudeSessionMessage[] {
  const imported: ImportedClaudeSessionMessage[] = [];
  // 当轮 assistant 可能分多次输出文本（中间穿插工具调用），只保留最后一条
  let pendingAssistant: string | null = null;

  const flushAssistant = () => {
    if (pendingAssistant) {
      imported.push({role: 'assistant', content: pendingAssistant});
      pendingAssistant = null;
    }
  };

  for (const item of messages) {
    const message = item.message as any;
    const content = message?.content;

    if (item.type === 'user') {
      // tool_result 属于中间过程，跳过且不打断当轮 assistant 的输出
      if (hasClaudeContentBlock(content, ['tool_result'])) continue;
      const text = extractTextFromClaudeContent(content);
      if (!text) continue;
      // 本地命令消息直接忽略，且不打断当轮 assistant 的输出
      if (isLocalCommandText(text)) continue;
      // 遇到真正的用户提问，先收尾上一轮 assistant 的最后一条输出
      flushAssistant();
      imported.push({role: 'user', content: text});
      continue;
    }

    if (item.type === 'assistant') {
      if (hasClaudeContentBlock(content, ['tool_use'])) continue;
      const text = extractTextFromClaudeContent(content);
      if (!text || isLocalCommandText(text)) continue;
      // 覆盖式保留：当轮只显示 assistant 最后一条文本消息
      pendingAssistant = text;
    }
  }

  flushAssistant();
  return imported;
}

async function getOrCreateQuickChatSessionRuntime(chatRoomId: string): Promise<QuickChatSessionRuntime | null> {
  const existing = await prisma.quickChatSession.findFirst({
    where: {chatRoomId},
    include: {
      chatRoom: {select: {isQuickChatRoom: true}},
      agent: {select: {type: true, acpTool: true}},
    },
    orderBy: {createdAt: 'desc'},
  });
  if (existing) return existing;

  const chatRoom = await prisma.chatRoom.findUnique({
    where: {id: chatRoomId},
    select: {
      id: true,
      isQuickChatRoom: true,
      quickChatAgentId: true,
      workDir: true,
    },
  });

  if (!chatRoom?.isQuickChatRoom || !chatRoom.quickChatAgentId) return null;

  const created = await prisma.quickChatSession.create({
    data: {
      agentId: chatRoom.quickChatAgentId,
      chatRoomId: chatRoom.id,
      sessionId: randomUUID(),
      workDir: chatRoom.workDir?.trim() || path.join(os.homedir(), '.teamagentx', chatRoom.quickChatAgentId, chatRoom.id),
    },
    include: {
      chatRoom: {select: {isQuickChatRoom: true}},
      agent: {select: {type: true, acpTool: true}},
    },
  });

  if (!fs.existsSync(created.workDir)) {
    fs.mkdirSync(created.workDir, {recursive: true});
  }

  return created;
}

export const quickChatSessionService = {
  /**
   * 创建快速对话会话
   * 自动创建会话工作目录 ~/.teamagentx/{agentId}/{sessionId}
   */
  async create(data: QuickChatSessionCreateData): Promise<{ sessionId: string; workDir: string; session: QuickChatSession }> {
    const sessionId = randomUUID();
    const workDir = path.join(os.homedir(), '.teamagentx', data.agentId, sessionId);

    // 创建工作目录
    fs.mkdirSync(workDir, { recursive: true });

    const session = await prisma.quickChatSession.create({
      data: {
        agentId: data.agentId,
        chatRoomId: data.chatRoomId,
        sessionId,
        workDir,
      },
    });

    return { sessionId, workDir, session };
  },

  /**
   * 根据 chatRoomId 获取快速对话会话
   */
  async getByChatRoomId(chatRoomId: string): Promise<QuickChatSession | null> {
    return prisma.quickChatSession.findFirst({
      where: { chatRoomId },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getClaudeSessionBindingByChatRoom(
    chatRoomId: string,
    agentId?: string | null,
  ): Promise<ClaudeSessionBinding | null> {
    const session = await prisma.quickChatSession.findFirst({
      where: {
        chatRoomId,
        ...(agentId ? {agentId} : {}),
        claudeLocalSessionId: {not: null},
      },
      select: {
        claudeLocalSessionId: true,
        claudeLocalSessionTitle: true,
        claudeLocalSessionModified: true,
      },
      orderBy: {createdAt: 'desc'},
    });

    if (!session?.claudeLocalSessionId) return null;

    return {
      sessionId: session.claudeLocalSessionId,
      title: session.claudeLocalSessionTitle,
      lastModified: session.claudeLocalSessionModified,
    };
  },

  async listLocalClaudeSessions(chatRoomId: string): Promise<{
    workDir: string;
    currentSessionId: string | null;
    sessions: LocalClaudeSessionInfo[];
  }> {
    const quickSession = await getOrCreateQuickChatSessionRuntime(chatRoomId);

    if (!quickSession || !quickSession.chatRoom.isQuickChatRoom) {
      throw new Error('仅快速对话支持切换 Claude 本地会话');
    }
    if (quickSession.agent.type !== 'acp' || quickSession.agent.acpTool !== 'claude') {
      throw new Error('仅 Claude 助手支持本地会话');
    }
    if (!quickSession.workDir?.trim()) {
      throw new Error('当前快速对话没有工作目录');
    }

    const sessions = await listSessions({
      dir: quickSession.workDir,
      limit: 100,
      includeWorktrees: true,
    });

    return {
      workDir: quickSession.workDir,
      currentSessionId: quickSession.claudeLocalSessionId,
      sessions: sessions.map((session) =>
        toLocalClaudeSessionInfo(session, quickSession.claudeLocalSessionId),
      ),
    };
  },

  async switchLocalClaudeSession(chatRoomId: string, claudeSessionId: string): Promise<{
    quickChatSession: QuickChatSession;
    claudeSession: LocalClaudeSessionInfo;
    importedMessages: ImportedClaudeSessionMessage[];
  }> {
    const quickSession = await getOrCreateQuickChatSessionRuntime(chatRoomId);

    if (!quickSession || !quickSession.chatRoom.isQuickChatRoom) {
      throw new Error('仅快速对话支持切换 Claude 本地会话');
    }
    if (quickSession.agent.type !== 'acp' || quickSession.agent.acpTool !== 'claude') {
      throw new Error('仅 Claude 助手支持本地会话');
    }

    const sessions = await listSessions({
      dir: quickSession.workDir,
      limit: 200,
      includeWorktrees: true,
    });
    const target = sessions.find((session) => session.sessionId === claudeSessionId);
    if (!target) {
      throw new Error('未找到该 Claude 本地会话');
    }
    const sourceDir = target.cwd || quickSession.workDir;
    const sessionMessages = await getSessionMessages(target.sessionId, {
      dir: sourceDir,
      limit: 500,
      includeSystemMessages: false,
    });

    copyClaudeTranscriptToTeamAgentConfig({
      agentId: quickSession.agentId,
      workDir: quickSession.workDir,
      sourceCwd: sourceDir,
      sessionId: target.sessionId,
    });

    const updated = await prisma.quickChatSession.update({
      where: {id: quickSession.id},
      data: {
        claudeLocalSessionId: target.sessionId,
        claudeLocalSessionTitle: getClaudeSessionTitle(target),
        claudeLocalSessionModified: new Date(target.lastModified),
      },
    });

    return {
      quickChatSession: updated,
      claudeSession: toLocalClaudeSessionInfo(target, target.sessionId),
      importedMessages: extractImportedClaudeMessages(sessionMessages),
    };
  },

  /**
   * 获取助手的快速对话历史
   */
  async getByAgent(agentId: string, limit: number = 50): Promise<QuickChatSession[]> {
    return prisma.quickChatSession.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  /**
   * 获取用户与某助手的快速对话群聊列表（直接查询 ChatRoom）
   */
  async getUserQuickChatRooms(userId: string, agentId: string): Promise<QuickChatSessionWithRoom[]> {
    // 直接查询该助手关联的快速对话群聊，用户作为成员参与
    const chatRooms = await prisma.chatRoom.findMany({
      where: {
        isQuickChatRoom: true,
        quickChatAgentId: agentId,
        chatRoomAgents: {
          some: { userId },
        },
      },
      include: {
        chatRoomAgents: {
          select: {
            id: true,
            userId: true,
            agentId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 转换为 QuickChatSessionWithRoom 格式（兼容前端类型）
    return chatRooms.map(room => ({
      id: room.id,
      agentId: agentId,
      chatRoomId: room.id,
      sessionId: room.id, // 使用 room.id 作为 sessionId
      workDir: '',
      status: 'active',
      createdAt: room.createdAt.toISOString(),
      archivedAt: null,
      chatRoom: {
        id: room.id,
        name: room.name,
        description: room.description,
        ownerId: room.ownerId,
        isQuickChatRoom: room.isQuickChatRoom,
        quickChatAgentId: room.quickChatAgentId,
        createdAt: room.createdAt.toISOString(),
        updatedAt: room.updatedAt.toISOString(),
        avatar: room.avatar,
        avatarColor: room.avatarColor,
        chatRoomAgents: room.chatRoomAgents,
      },
    })) as unknown as QuickChatSessionWithRoom[];
  },

  /**
   * 获取用户在某个助手上的快速对话群聊数量
   */
  async getUserQuickChatCount(userId: string, agentId: string): Promise<number> {
    const sessions = await prisma.quickChatSession.findMany({
      where: { agentId },
      include: {
        chatRoom: {
          include: {
            chatRoomAgents: {
              where: { userId },
              select: { id: true },
            },
          },
        },
      },
    });

    return sessions.filter(s => s.chatRoom.chatRoomAgents.length > 0).length;
  },

  /**
   * 归档会话
   */
  async archive(sessionId: string): Promise<void> {
    await prisma.quickChatSession.update({
      where: { sessionId },
      data: {
        status: 'archived',
        archivedAt: new Date(),
      },
    });
  },

  /**
   * 删除会话（同时删除工作目录）
   */
  async delete(sessionId: string): Promise<void> {
    const session = await prisma.quickChatSession.findUnique({
      where: { sessionId },
    });

    if (session && fs.existsSync(session.workDir)) {
      fs.rmSync(session.workDir, { recursive: true, force: true });
    }

    await prisma.quickChatSession.delete({
      where: { sessionId },
    });
  },
};
