import type { Message } from '@prisma/client';
import { randomUUID } from 'crypto';
import { config } from '../../config/index.js';
import { createLlmClient } from '../../lib/llm-client.js';
import prisma from '../../lib/prisma.js';
import { llmProviderService } from '../llm-provider/llm-provider.service.js';
import type { HistoryMessage } from '../task-queue/task-queue.service.js';

type MessageWithSender = Message & {
  user?: { username: string } | null;
  agent?: { name: string } | null;
};

const runningCompactions = new Set<string>();

function memoryKey(chatRoomId: string, agentId: string): string {
  return `${chatRoomId}:${agentId}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function senderName(message: MessageWithSender): string {
  return message.user?.username || message.agent?.name || '未知';
}

function formatMessages(messages: MessageWithSender[]): string {
  return messages
    .map((message) => {
      const time = new Date(message.time).toLocaleString('zh-CN');
      const role = message.isHuman ? '用户' : '助手';
      return `- ${message.id} | ${time} | ${role}(${senderName(message)}): ${message.content}`;
    })
    .join('\n');
}

function getMemoryDelegate() {
  const client = prisma as any;
  return client.agentRoomMemory || client.agentMemory;
}

function toHistoryMessage(message: MessageWithSender): HistoryMessage {
  return {
    kind: 'message',
    content: message.content,
    senderName: senderName(message),
    isHuman: message.isHuman,
  };
}

async function getOrCreateMemory(chatRoomId: string, agentId: string) {
  const memoryDelegate = getMemoryDelegate();
  if (!memoryDelegate) {
    throw new Error('Prisma client missing AgentRoomMemory delegate');
  }

  const existing = await memoryDelegate.findUnique({
    where: { chatRoomId_agentId: { chatRoomId, agentId } },
  });
  if (existing) return existing;

  return memoryDelegate.create({
    data: {
      id: randomUUID(),
      chatRoomId,
      agentId,
      updatedAt: new Date(),
    },
  });
}

async function findMessagesBefore(
  chatRoomId: string,
  currentMessageId: string,
): Promise<MessageWithSender[]> {
  const currentMessage = await prisma.message.findUnique({
    where: { id: currentMessageId },
    select: { time: true },
  });
  if (!currentMessage) return [];

  return prisma.message.findMany({
    where: {
      chatRoomId,
      time: { lt: currentMessage.time },
    },
    include: { user: true, agent: true },
    orderBy: { time: 'asc' },
  }) as Promise<MessageWithSender[]>;
}

async function createSummary(oldSummary: string, messages: MessageWithSender[]): Promise<string> {
  const provider = await llmProviderService.findDefault();
  if (!provider) {
    throw new Error('未找到默认 LLM Provider，无法压缩群历史摘要');
  }

  const model = createLlmClient(provider, {
    temperature: 0.2,
    maxTokens: config.agent.memorySummaryTargetTokens,
  });

  const prompt = `你是群聊长期记忆压缩器。请把旧摘要和新增群聊消息合并为新的长期记忆摘要。

要求：
1. 不要编造未出现的信息。
2. 保留用户明确要求、限制、偏好。
3. 保留尚未完成的任务、负责人、当前状态。
4. 保留关键技术细节：文件名、函数名、接口、数据库表、错误信息、命令、环境变量。
5. 保留已经做出的决策，以及决策原因。
6. 如果存在冲突信息，记录冲突，不要擅自合并。
7. 删除寒暄、重复确认、无实际信息的过程文本。
8. 输出结构化 Markdown，控制在约 ${config.agent.memorySummaryTargetTokens} tokens 内。

输出结构：
## 当前目标
- ...

## 已确认事实
- ...

## 已完成事项
- ...

## 未完成任务
- ...

## 用户偏好和约束
- ...

## 技术上下文
- ...

## Agent 分工
- ...

## 关键决策
- ...

## 风险和阻塞
- ...

旧摘要：
${oldSummary || '暂无'}

新增群聊消息：
${formatMessages(messages)}

请直接输出新的长期记忆摘要。`;

  const content = await model.invoke([
    { role: 'system', content: '你负责把群聊历史压缩成可持续滚动更新的长期记忆。' },
    { role: 'user', content: prompt },
  ]);

  return content.trim();
}

async function runCompaction(chatRoomId: string, agentId: string, currentMessageId: string) {
  const key = memoryKey(chatRoomId, agentId);
  if (runningCompactions.has(key)) return;
  runningCompactions.add(key);

  try {
    const memoryDelegate = getMemoryDelegate();
    if (!memoryDelegate) return;

    let memory = await getOrCreateMemory(chatRoomId, agentId);
    await memoryDelegate.update({
      where: { id: memory.id },
      data: {
        compactStatus: 'running',
        compactStartedAt: new Date(),
        compactError: null,
      },
    });

    const messagesBeforeCurrent = await findMessagesBefore(chatRoomId, currentMessageId);
    const uncovered = memory.coveredMessageTime
      ? messagesBeforeCurrent.filter((message) => message.time > memory.coveredMessageTime!)
      : messagesBeforeCurrent;
    const compactCandidates = uncovered.slice(
      0,
      Math.max(0, uncovered.length - config.agent.memoryRecentMessages),
    );

    if (compactCandidates.length < config.agent.memoryCompactMessages) {
      await memoryDelegate.update({
        where: { id: memory.id },
        data: { compactStatus: 'idle', compactStartedAt: null, compactError: null },
      });
      return;
    }

    const summary = await createSummary(memory.summary, compactCandidates);
    const lastMessage = compactCandidates[compactCandidates.length - 1];
    memory = await memoryDelegate.update({
      where: { id: memory.id },
      data: {
        summary,
        coveredMessageId: lastMessage.id,
        coveredMessageTime: lastMessage.time,
        messageCount: memory.messageCount + compactCandidates.length,
        tokenEstimate: estimateTokens(summary),
        compactStatus: 'idle',
        compactStartedAt: null,
        compactError: null,
        version: memory.version + 1,
      },
    });
    console.log(`[AgentMemory] ${chatRoomId}/${agentId} 压缩完成，覆盖 ${compactCandidates.length} 条消息，摘要版本 ${memory.version}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[AgentMemory] ${chatRoomId}/${agentId} 压缩失败:`, error);
    try {
      const memoryDelegate = getMemoryDelegate();
      if (!memoryDelegate) return;

      await memoryDelegate.update({
        where: { chatRoomId_agentId: { chatRoomId, agentId } },
        data: {
          compactStatus: 'failed',
          compactStartedAt: null,
          compactError: message.slice(0, 1000),
        },
      });
    } catch {
      // Ignore secondary persistence errors.
    }
  } finally {
    runningCompactions.delete(key);
  }
}

function triggerCompaction(chatRoomId: string, agentId: string, currentMessageId: string): void {
  void runCompaction(chatRoomId, agentId, currentMessageId);
}

export const agentMemoryService = {
  async buildHistory(chatRoomId: string, agentId: string, currentMessageId: string): Promise<HistoryMessage[]> {
    const messagesBeforeCurrent = await findMessagesBefore(chatRoomId, currentMessageId);
    const recentMessages = messagesBeforeCurrent.slice(-config.agent.memoryRecentMessages);
    const fallbackHistory = recentMessages.map(toHistoryMessage);

    try {
      const memory = await getOrCreateMemory(chatRoomId, agentId);

      const uncovered = memory.coveredMessageTime
        ? messagesBeforeCurrent.filter((message) => message.time > memory.coveredMessageTime!)
        : messagesBeforeCurrent;
      const compactCandidatesCount = Math.max(
        0,
        uncovered.length - config.agent.memoryRecentMessages,
      );

      if (
        compactCandidatesCount >= config.agent.memoryCompactMessages &&
        memory.compactStatus !== 'running' &&
        memory.compactStatus !== 'pending'
      ) {
        triggerCompaction(chatRoomId, agentId, currentMessageId);
      }

      const history: HistoryMessage[] = [];
      if (memory.summary.trim()) {
        history.push({
          kind: 'memory_summary',
          senderName: '系统',
          isHuman: false,
          content: memory.summary.trim(),
        });
      }

      history.push(...fallbackHistory);

      return history;
    } catch (error) {
      console.error(
        `[AgentMemory] ${chatRoomId}/${agentId} 构建记忆失败，降级为最近消息:`,
        error,
      );
      return fallbackHistory;
    }
  },

  async clear(chatRoomId: string, agentId: string): Promise<void> {
    const memoryDelegate = getMemoryDelegate();
    if (!memoryDelegate) return;

    await memoryDelegate.deleteMany({
      where: { chatRoomId, agentId },
    });
  },
};
