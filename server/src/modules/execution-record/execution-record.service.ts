import prisma from '../../lib/prisma.js';

// 执行事件类型
export type ExecutionEventType = 'thinking' | 'tool_call' | 'output';

// 执行事件接口
export interface ExecutionEvent {
  type: ExecutionEventType;
  timestamp: number;
  data: {
    // thinking
    content?: string;
    // tool_call
    name?: string;
    input?: Record<string, unknown>;
    output?: string | Record<string, unknown>;
    status?: 'in_progress' | 'completed' | 'error';
    toolCallId?: string;
    // output
    type?: string;  // action type
    target?: string;
  };
}

// 工具调用类型（用于前端兼容）
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  toolCallId?: string;
  status?: 'in_progress' | 'completed' | 'error';
  output?: string | Record<string, unknown>;
  timestamp?: number;
}

// 思考过程类型（用于前端兼容）
export interface ThinkingRecord {
  content: string;
  timestamp: number;
}

// Agent 动作类型（用于前端兼容）
export interface AgentAction {
  type: 'message';
  content: string;
  target?: string;
  timestamp?: number;
}

export interface CreateExecutionRecordData {
  chatRoomId: string;
  agentId: string;
  agentName: string;
  triggerMessage: string;
  triggerUser?: string;
  events: ExecutionEvent[];  // 新的统一事件数组
  context?: string;
  systemPrompt: string;
  status?: 'completed' | 'failed' | 'cancelled';
  errorMessage?: string;
  duration?: number;
  // Token 使用字段
  llmProviderId?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface ExecutionRecordWithParsed {
  id: string;
  chatRoomId: string;
  agentId: string;
  agentName: string;
  triggerMessage: string;
  triggerUser: string | null;
  events: ExecutionEvent[];  // 新的统一事件数组
  context: string | null;
  systemPrompt: string;
  status: string;
  errorMessage: string | null;
  duration: number | null;
  createdAt: string;
  // Token 使用字段
  llmProviderId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;

  // 兼容旧接口的字段（从 events 中提取）
  actions: AgentAction[];
  toolCalls: ToolCall[];
  thinking?: ThinkingRecord | string | null;
  invokeResult: Record<string, unknown> | null;
}

type RawRecord = {
  id: string;
  chatRoomId: string;
  agentId: string;
  agentName: string;
  triggerMessage: string;
  triggerUser: string | null;
  events: string;
  context: string | null;
  systemPrompt: string;
  status: string;
  errorMessage: string | null;
  duration: number | null;
  createdAt: Date;
  // Token 使用字段
  llmProviderId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
};

// 解析事件数组
function parseEvents(eventsStr: string): ExecutionEvent[] {
  try {
    const parsed = JSON.parse(eventsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 从 events 中提取工具调用（兼容旧接口）
function extractToolCalls(events: ExecutionEvent[]): ToolCall[] {
  return events
    .filter(e => e.type === 'tool_call')
    .map(e => ({
      name: e.data.name || '',
      input: e.data.input || {},
      toolCallId: e.data.toolCallId,
      status: e.data.status,
      output: e.data.output,
      timestamp: e.timestamp,
    }));
}

// 从 events 中提取动作（兼容旧接口）
function extractActions(events: ExecutionEvent[]): AgentAction[] {
  return events
    .filter(e => e.type === 'output')
    .map(e => ({
      type: 'message' as const,
      content: e.data.content || '',
      target: e.data.target,
      timestamp: e.timestamp,
    }));
}

// 从 events 中提取思考过程（兼容旧接口）
function extractThinking(events: ExecutionEvent[]): ThinkingRecord | string | null {
  const thinkingEvents = events.filter(e => e.type === 'thinking');
  if (thinkingEvents.length === 0) return null;

  // 合并所有思考内容
  const content = thinkingEvents.map(e => e.data.content || '').join('');
  const timestamp = thinkingEvents[0].timestamp;

  return { content, timestamp };
}

// 构建 invokeResult（兼容旧接口）
function buildInvokeResult(events: ExecutionEvent[]): Record<string, unknown> | null {
  const toolCalls = extractToolCalls(events);
  if (toolCalls.length === 0) return null;

  return { toolCalls };
}

function parseRecord(record: RawRecord): ExecutionRecordWithParsed {
  const events = parseEvents(record.events);

  return {
    id: record.id,
    chatRoomId: record.chatRoomId,
    agentId: record.agentId,
    agentName: record.agentName,
    triggerMessage: record.triggerMessage,
    triggerUser: record.triggerUser,
    events,
    context: record.context,
    systemPrompt: record.systemPrompt,
    status: record.status,
    errorMessage: record.errorMessage,
    duration: record.duration,
    createdAt: typeof record.createdAt === 'string'
      ? record.createdAt
      : record.createdAt.toISOString(),
    // Token 使用字段
    llmProviderId: record.llmProviderId,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    cacheReadTokens: record.cacheReadTokens,
    cacheCreationTokens: record.cacheCreationTokens,
    // 兼容旧接口
    actions: extractActions(events),
    toolCalls: extractToolCalls(events),
    thinking: extractThinking(events),
    invokeResult: buildInvokeResult(events),
  };
}

class ExecutionRecordService {
  async create(data: CreateExecutionRecordData): Promise<ExecutionRecordWithParsed> {
    const now = new Date();
    const record = await prisma.executionRecord.create({
      data: {
        id: crypto.randomUUID(),
        chatRoomId: data.chatRoomId,
        agentId: data.agentId,
        agentName: data.agentName,
        triggerMessage: data.triggerMessage,
        triggerUser: data.triggerUser || null,
        events: JSON.stringify(data.events),
        context: data.context || null,
        systemPrompt: data.systemPrompt,
        status: data.status || 'completed',
        errorMessage: data.errorMessage || null,
        duration: data.duration || null,
        createdAt: now,
        // Token 使用字段
        llmProviderId: data.llmProviderId || null,
        inputTokens: data.inputTokens || null,
        outputTokens: data.outputTokens || null,
        totalTokens: data.totalTokens || null,
        cacheReadTokens: data.cacheReadTokens || null,
        cacheCreationTokens: data.cacheCreationTokens || null,
      },
    });

    return parseRecord(record);
  }

  async findByChatRoomAndAgent(
    chatRoomId: string,
    agentId: string,
    options?: { take?: number }
  ): Promise<ExecutionRecordWithParsed[]> {
    const records = await prisma.executionRecord.findMany({
      where: { chatRoomId, agentId },
      orderBy: { createdAt: 'desc' },
      take: options?.take ?? 20,
    });

    return records.map((r) => parseRecord(r));
  }

  async findByChatRoom(
    chatRoomId: string,
    options?: { take?: number; currentOnly?: boolean }
  ): Promise<ExecutionRecordWithParsed[]> {
    const latestArchive = options?.currentOnly
      ? await prisma.chatRoomMessageArchive.findFirst({
          where: { chatRoomId },
          orderBy: { archivedAt: 'desc' },
          select: { archivedAt: true },
        })
      : null;

    const records = await prisma.executionRecord.findMany({
      where: {
        chatRoomId,
        ...(options?.currentOnly
          ? {
              OR: [
                { outputMessages: { some: { archiveId: null } } },
                {
                  outputMessages: { none: {} },
                  ...(latestArchive ? { createdAt: { gt: latestArchive.archivedAt } } : {}),
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.take ?? 50,
    });

    return records.map((r) => parseRecord(r));
  }

  async findById(id: string): Promise<ExecutionRecordWithParsed | null> {
    const record = await prisma.executionRecord.findUnique({
      where: { id },
    });

    if (!record) return null;

    return parseRecord(record as RawRecord);
  }

  async findLatest(
    chatRoomId: string,
    agentId: string
  ): Promise<ExecutionRecordWithParsed | null> {
    const record = await prisma.executionRecord.findFirst({
      where: { chatRoomId, agentId },
      orderBy: { createdAt: 'desc' },
    });

    return record ? parseRecord(record) : null;
  }

  async deleteByChatRoomId(chatRoomId: string): Promise<{ count: number }> {
    return prisma.executionRecord.deleteMany({
      where: { chatRoomId },
    });
  }

  async deleteByChatRoomAndAgent(chatRoomId: string, agentId: string): Promise<{ count: number }> {
    return prisma.executionRecord.deleteMany({
      where: { chatRoomId, agentId },
    });
  }
}

export const executionRecordService = new ExecutionRecordService();
