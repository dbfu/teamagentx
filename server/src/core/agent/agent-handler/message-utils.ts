import { randomUUID } from 'crypto';
import { messageService } from '../../../modules/message/message.service.js';
import type { Message } from '../../../types/message.js';
import { globalEmit } from './status.js';
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
  const content = `[定时任务] ${taskName}: ${payload}`;
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

  // 广播消息
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

// Parse @mentions from message content
export function parseMentions(content: string): string[] {
  const mentions: string[] = [];
  // Match @名称 pattern (Chinese characters, letters, numbers, underscores, hyphens)
  // 前面可以是：空格、字符串开头、或 markdown 特殊字符（*、_、>、-、#、`）
  // 名称可以包含连字符，但不能以连字符开头或结尾
  // 边界检测：空格、字符串结尾、或 markdown 特殊字符
  // 特殊处理连字符：只有当连字符后面没有名称字符时，才作为边界
  // 使用非贪婪匹配 +? 确保不会过度匹配
  // 使用 lookbehind (?<=) 确保名称不以 - 结尾
  const regex = /(?:^|\s|[*_>#`\-])@([\u4e00-\u9fa5a-zA-Z0-9_][\u4e00-\u9fa5a-zA-Z0-9_-]*?)(?<=[\u4e00-\u9fa5a-zA-Z0-9_])(?=\s|$|[*_>#`!?.,:;！？。，；：]|-(?![\u4e00-\u9fa5a-zA-Z0-9_]))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    if (name && !mentions.includes(name)) {
      mentions.push(name);
    }
  }
  return mentions;
}