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
import {
  bindCodexLocalThread,
  getCodexExecutorSessionsDir,
} from '../../core/agent/codex-session-state.js';

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

// ===== Codex 本地会话（rollout）支持 =====

interface CodexRolloutSummary {
  sessionId: string;
  cwd: string | null;
  gitBranch: string | null;
  createdAt: string | null;
  title: string;
}

function getLocalCodexSessionsDir(): string {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}

function collectCodexRolloutFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        out.push(full);
      }
    }
  }
  return out;
}

function collectCodexText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => (typeof block?.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

// Codex 会在每个会话开头注入 AGENTS.md、环境上下文、本地命令等非真实用户输入，导入时跳过
function isCodexInjectedUserText(text: string): boolean {
  if (isLocalCommandText(text)) return true;
  if (/^#\s*AGENTS\.md/i.test(text)) return true;
  return (
    text.startsWith('<INSTRUCTIONS>') ||
    text.includes('<user_instructions>') ||
    text.includes('<environment_context>')
  );
}

function readCodexRolloutLines(filePath: string): string[] {
  try {
    const stat = fs.statSync(filePath);
    // 超大会话文件只读取头部，避免一次性加载数 MB
    if (stat.size > 4 * 1024 * 1024) {
      const fd = fs.openSync(filePath, 'r');
      try {
        const buf = Buffer.alloc(512 * 1024);
        const read = fs.readSync(fd, buf, 0, buf.length, 0);
        return buf.subarray(0, read).toString('utf-8').split('\n');
      } finally {
        fs.closeSync(fd);
      }
    }
    return fs.readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return [];
  }
}

function parseCodexRolloutHead(filePath: string): CodexRolloutSummary | null {
  let meta: any = null;
  let title = '';

  for (const line of readCodexRolloutLines(filePath)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!meta && parsed.type === 'session_meta' && parsed.payload) {
      meta = parsed.payload;
    }
    if (
      !title &&
      parsed.type === 'response_item' &&
      parsed.payload?.type === 'message' &&
      parsed.payload.role === 'user'
    ) {
      const text = collectCodexText(parsed.payload.content);
      if (text && !isCodexInjectedUserText(text)) {
        title = text.split('\n')[0]!.trim().slice(0, 80);
      }
    }
    if (meta && title) break;
  }

  if (!meta?.id) return null;
  return {
    sessionId: meta.id,
    cwd: typeof meta.cwd === 'string' ? meta.cwd : null,
    gitBranch:
      meta.git?.branch ?? meta.git?.current_branch ?? meta.git?.head_branch ?? null,
    createdAt: typeof meta.timestamp === 'string' ? meta.timestamp : null,
    title: title || '未命名会话',
  };
}

function extractImportedCodexMessages(filePath: string): ImportedClaudeSessionMessage[] {
  const imported: ImportedClaudeSessionMessage[] = [];
  let pendingAssistant: string | null = null;

  const flushAssistant = () => {
    if (pendingAssistant) {
      imported.push({role: 'assistant', content: pendingAssistant});
      pendingAssistant = null;
    }
  };

  let lines: string[];
  try {
    lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  } catch {
    return imported;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed.type !== 'response_item' || parsed.payload?.type !== 'message') continue;

    const role = parsed.payload.role;
    const text = collectCodexText(parsed.payload.content);
    if (!text) continue;

    if (role === 'user') {
      if (isCodexInjectedUserText(text)) continue;
      flushAssistant();
      imported.push({role: 'user', content: text});
    } else if (role === 'assistant') {
      // 覆盖式保留：当轮只显示 assistant 最后一条文本消息
      pendingAssistant = text;
    }
  }

  flushAssistant();
  return imported;
}

function toLocalCodexSessionInfo(
  head: CodexRolloutSummary,
  mtimeMs: number,
  currentSessionId?: string | null,
): LocalClaudeSessionInfo {
  const lastModified = mtimeMs
    ? new Date(mtimeMs)
    : head.createdAt
      ? new Date(head.createdAt)
      : new Date();
  return {
    sessionId: head.sessionId,
    title: head.title,
    summary: '',
    customTitle: null,
    firstPrompt: head.title,
    cwd: head.cwd,
    gitBranch: head.gitBranch,
    tag: null,
    createdAt: head.createdAt,
    lastModified: lastModified.toISOString(),
    fileSize: null,
    isCurrent: head.sessionId === currentSessionId,
  };
}

// 将选中的本地 Codex rollout 复制进 executor 专属 sessions 目录，保留相对结构供 resume 查找
function copyCodexRolloutToExecutorHome(params: {
  sourceFile: string;
  sourceRoot: string;
  agentId: string;
}): void {
  const targetRoot = getCodexExecutorSessionsDir(params.agentId);
  const relative = path.relative(params.sourceRoot, params.sourceFile);
  const dest = relative.startsWith('..')
    ? path.join(targetRoot, path.basename(params.sourceFile))
    : path.join(targetRoot, relative);
  fs.mkdirSync(path.dirname(dest), {recursive: true});
  fs.copyFileSync(params.sourceFile, dest);
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

  async listLocalCodexSessions(chatRoomId: string): Promise<{
    workDir: string;
    currentSessionId: string | null;
    sessions: LocalClaudeSessionInfo[];
  }> {
    const quickSession = await getOrCreateQuickChatSessionRuntime(chatRoomId);

    if (!quickSession || !quickSession.chatRoom.isQuickChatRoom) {
      throw new Error('仅快速对话支持切换 Codex 本地会话');
    }
    if (quickSession.agent.type !== 'acp' || quickSession.agent.acpTool !== 'codex') {
      throw new Error('仅 Codex 助手支持本地会话');
    }
    if (!quickSession.workDir?.trim()) {
      throw new Error('当前快速对话没有工作目录');
    }

    const targetCwd = path.resolve(quickSession.workDir);
    const files = collectCodexRolloutFiles(getLocalCodexSessionsDir())
      .map((file) => {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(file).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return {file, mtimeMs};
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 200);

    const sessions: LocalClaudeSessionInfo[] = [];
    for (const {file, mtimeMs} of files) {
      const head = parseCodexRolloutHead(file);
      if (!head?.cwd) continue;
      if (path.resolve(head.cwd) !== targetCwd) continue;
      sessions.push(toLocalCodexSessionInfo(head, mtimeMs, quickSession.codexLocalSessionId));
    }
    sessions.sort(
      (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
    );

    return {
      workDir: quickSession.workDir,
      currentSessionId: quickSession.codexLocalSessionId,
      sessions,
    };
  },

  async switchLocalCodexSession(chatRoomId: string, codexSessionId: string): Promise<{
    quickChatSession: QuickChatSession;
    codexSession: LocalClaudeSessionInfo;
    importedMessages: ImportedClaudeSessionMessage[];
  }> {
    const quickSession = await getOrCreateQuickChatSessionRuntime(chatRoomId);

    if (!quickSession || !quickSession.chatRoom.isQuickChatRoom) {
      throw new Error('仅快速对话支持切换 Codex 本地会话');
    }
    if (quickSession.agent.type !== 'acp' || quickSession.agent.acpTool !== 'codex') {
      throw new Error('仅 Codex 助手支持本地会话');
    }

    const sessionsRoot = getLocalCodexSessionsDir();
    const files = collectCodexRolloutFiles(sessionsRoot);
    const targetFile =
      files.find((file) => path.basename(file).includes(codexSessionId)) ??
      files.find((file) => parseCodexRolloutHead(file)?.sessionId === codexSessionId);
    if (!targetFile) {
      throw new Error('未找到该 Codex 本地会话');
    }
    const head = parseCodexRolloutHead(targetFile);
    if (!head) {
      throw new Error('解析 Codex 本地会话失败');
    }

    // 复制 rollout 供 executor resume，并写入 threadId 状态文件
    copyCodexRolloutToExecutorHome({
      sourceFile: targetFile,
      sourceRoot: sessionsRoot,
      agentId: quickSession.agentId,
    });
    bindCodexLocalThread({
      agentId: quickSession.agentId,
      chatRoomId,
      workDir: quickSession.workDir,
      threadId: head.sessionId,
    });

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(targetFile).mtimeMs;
    } catch {
      mtimeMs = 0;
    }

    const updated = await prisma.quickChatSession.update({
      where: {id: quickSession.id},
      data: {
        codexLocalSessionId: head.sessionId,
        codexLocalSessionTitle: head.title,
        codexLocalSessionModified: mtimeMs ? new Date(mtimeMs) : new Date(),
      },
    });

    return {
      quickChatSession: updated,
      codexSession: toLocalCodexSessionInfo(head, mtimeMs, head.sessionId),
      importedMessages: extractImportedCodexMessages(targetFile),
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
