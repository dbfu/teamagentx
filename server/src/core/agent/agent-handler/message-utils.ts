import { randomUUID } from 'crypto';
import { messageService } from '../../../modules/message/message.service.js';
import type { Message } from '../../../types/message.js';
import { globalBroadcastMessage, globalEmit } from './status.js';
import { debugLog } from './debug.js';

// 构建 AI 消息对象
export function buildAIMessage(
  content: string,
  replyToId: string | null,
  agentName: string,
  agentId: string,
  chatRoomId: string,
  avatar?: string | null,
  avatarColor?: string | null,
): Message {
  return {
    id: randomUUID(),
    type: 'reply',
    content,
    time: new Date(),
    user: agentName,
    agentId,
    agentName,
    avatar,
    avatarColor,
    chatRoomId,
    replyMessageId: replyToId || undefined,
    isHuman: false,
  };
}

// 广播定时任务触发消息（用于 cron scheduler）
export async function broadcastCronTriggerMessage(
  chatRoomId: string,
  taskName: string,
  payload: string,
): Promise<string> {
  const messageId = randomUUID();
  // payload 已由调度器按目标助手拆好，最多包含一个自动添加的 @助手 mention。
  // 这里把它放在最前，taskName 标签放在末尾，
  // 既保证 @mentions 可见、可被 parseKnownMentions 命中，也保留定时任务来源信息。
  const content = `${payload}\n\n— 定时任务「${taskName}」`;
  const time = new Date();

  // 创建消息对象
  const message: Message = {
    id: messageId,
    type: 'message',
    content,
    time,
    user: '系统',
    agentId: undefined,
    agentName: undefined,
    avatar: undefined,
    avatarColor: undefined,
    chatRoomId,
    replyMessageId: undefined,
    isHuman: true, // 作为用户消息显示
  };

  // 保存消息到数据库
  await messageService.create({
    id: messageId,
    type: 'MESSAGE',
    content,
    time,
    userId: null, // 系统消息，无用户 ID
    agentId: null,
    chatRoomId,
    replyMessageId: null,
    isHuman: true,
  });

  // 广播消息到 socket 客户端，globalEmit 内部已触发 receivedMessage，无需再次调用
  if (globalEmit) {
    await globalEmit(message, chatRoomId);
  }

  debugLog('cronTriggerMessage', {
    chatRoomId,
    messageId,
    taskName,
    content,
  });

  return messageId;
}

// 广播助手加入群聊通知消息
export async function broadcastAgentJoinedMessage(
  chatRoomId: string,
  agentName: string,
  agentDescription?: string | null,
): Promise<string> {
  const messageId = randomUUID();
  const descriptionText = agentDescription ? `\n描述: ${agentDescription}` : '';
  const content = `🎉 新助手加入群聊\n\n**${agentName}** 已加入群聊${descriptionText}`;
  const time = new Date();

  // 创建消息对象
  const message: Message = {
    id: messageId,
    type: 'message',
    content,
    time,
    user: '系统',
    agentId: undefined,
    agentName: undefined,
    avatar: undefined,
    avatarColor: undefined,
    chatRoomId,
    replyMessageId: undefined,
    isHuman: true, // 作为用户消息显示，可被注入到助手历史上下文
  };

  // 保存消息到数据库
  await messageService.create({
    id: messageId,
    type: 'MESSAGE',
    content,
    time,
    userId: null, // 系统消息，无用户 ID
    agentId: null,
    chatRoomId,
    replyMessageId: null,
    isHuman: true,
  });

  // Broadcast for UI/unread sync only. Do not emit receivedMessage here,
  // otherwise the join notification itself would trigger the coordinator/default agent.
  if (globalBroadcastMessage) {
    await globalBroadcastMessage(message, chatRoomId);
  }

  debugLog('agentJoinedMessage', {
    chatRoomId,
    messageId,
    agentName,
    content,
  });

  return messageId;
}

export function buildChatRoomRulesUpdatedMessageContent(rules?: string | null): string {
  const trimmedRules = rules?.trim();
  if (!trimmedRules) {
    return '群规则已清空。\n\n请所有助手从现在开始不再沿用旧群规则。';
  }

  return `群规则已更新。\n\n请所有助手从现在开始使用新的群规则。\n\n新的群规则：\n${trimmedRules}`;
}

export async function broadcastChatRoomRulesUpdatedMessage(
  chatRoomId: string,
  rules?: string | null,
): Promise<string> {
  const messageId = randomUUID();
  const content = buildChatRoomRulesUpdatedMessageContent(rules);
  const time = new Date();
  const message: Message = {
    id: messageId,
    type: 'message',
    content,
    time,
    user: '系统',
    agentId: undefined,
    agentName: undefined,
    avatar: undefined,
    avatarColor: undefined,
    chatRoomId,
    replyMessageId: undefined,
    isHuman: true,
  };

  await messageService.create({
    id: messageId,
    type: 'MESSAGE',
    content,
    time,
    userId: null,
    agentId: null,
    chatRoomId,
    replyMessageId: null,
    isHuman: true,
  });

  // Broadcast for UI/unread sync only. Do not emit receivedMessage here,
  // otherwise the notification itself would trigger the coordinator/default agent.
  if (globalBroadcastMessage) {
    await globalBroadcastMessage(message, chatRoomId);
  }

  debugLog('chatRoomRulesUpdatedMessage', {
    chatRoomId,
    messageId,
    content,
  });

  return messageId;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

export function parseKnownMentions(
  content: string,
  agentNames: string[],
  options?: { allowInline?: boolean },
): string[] {
  const mentions: string[] = [];
  const escapedNames = agentNames
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (escapedNames.length === 0) return mentions;

  const endBoundaryChars = '*_>#`!?.,:;！？。，；：';
  const regex = new RegExp(
    `@(${escapedNames.join('|')})(?=\\s|$|[${endBoundaryChars}]|-(?![\\u4e00-\\u9fa5a-zA-Z0-9_]))`,
    'g',
  );

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const atIndex = match.index;
    const prevChar = atIndex > 0 ? content[atIndex - 1] : '';
    const isLineStart = atIndex === 0 || prevChar === '\n' || prevChar === '\r';
    const hasStandardBoundary = isLineStart || prevChar === ' ';
    if (!options?.allowInline && !hasStandardBoundary) {
      continue;
    }
    // Collaboration messages can use Feishu/Lark-style inline mentions like "请@助手".
    // Avoid treating email-like ASCII text before @ as an assistant mention.
    if (options?.allowInline && prevChar && /[A-Za-z0-9._%+-]/.test(prevChar)) {
      continue;
    }

    const name = match[1];
    if (name && !mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}

// Parse @mentions from message content
export function parseMentions(content: string): string[] {
  const mentions: string[] = [];
  // Match @名称 pattern (Chinese characters, letters, numbers, underscores, hyphens)
  // @ 必须是当前行的第一个字符，或前一个字符是空格；其他行内 @ 只作为普通文本展示。
  // 名称可以包含连字符，但不能以连字符开头或结尾
  // 边界检测：空格、字符串结尾、或 markdown 特殊字符
  // 特殊处理连字符：只有当连字符后面没有名称字符时，才作为边界
  // 使用非贪婪匹配 +? 确保不会过度匹配
  // 使用 lookbehind (?<=) 确保名称不以 - 结尾
  const regex = /(?:^|\r?\n| )@([\u4e00-\u9fa5a-zA-Z0-9_][\u4e00-\u9fa5a-zA-Z0-9_-]*?)(?<=[\u4e00-\u9fa5a-zA-Z0-9_])(?=\s|$|[*_>#`!?.,:;！？。，；：]|-(?![\u4e00-\u9fa5a-zA-Z0-9_]))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (name && !mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}
