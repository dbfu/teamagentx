import { randomUUID } from 'crypto';
import path from 'path';
import { messageService } from '../../../modules/message/message.service.js';
import { uploadService } from '../../../modules/upload/upload.service.js';
import type { Message } from '../../../types/message.js';
import { getDefaultChatRoomWorkDir } from '../work-dir.js';
import { globalBroadcastMessage, globalEmit } from './status.js';
import { debugLog } from './debug.js';

const INLINE_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// 匹配 markdown 图片语法 ![alt](path "title")
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)]+?)\s*\)/g;

function isServedOrRemoteUrl(url: string): boolean {
  return /^(https?:|data:|blob:)/i.test(url) || url.startsWith('/uploads/');
}

/**
 * 助手 markdown 里常写出指向「房间工作目录」的相对/本地路径图片（如
 * `![](auth_qrcode.png)`）。浏览器无法加载本地文件，这里在消息落库/广播前
 * 把这些图片转存到 uploads 目录，并把路径替换为 `/uploads/...`，从而前端可直接渲染。
 */
export async function uploadInlineWorkspaceImages(
  content: string,
  chatRoomId: string,
): Promise<string> {
  if (!content || !content.includes('![')) return content;

  const workDir = getDefaultChatRoomWorkDir(chatRoomId);
  const uploadedByPath = new Map<string, string>(); // 原始路径 -> 新 url
  const fullToReplacement = new Map<string, string>(); // 整段 markdown -> 替换后

  for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
    const full = match[0];
    const alt = match[1];
    const inside = match[2].trim();
    // inside 可能形如 `path "title"`，仅取第一段作为路径，保留标题
    const firstSpace = inside.search(/\s/);
    const rawPath = (firstSpace === -1 ? inside : inside.slice(0, firstSpace)).replace(/^<|>$/g, '');
    const titlePart = firstSpace === -1 ? '' : inside.slice(firstSpace);

    if (!rawPath || isServedOrRemoteUrl(rawPath)) continue;
    if (!INLINE_IMAGE_EXT.has(path.extname(rawPath).toLowerCase())) continue;

    let url = uploadedByPath.get(rawPath);
    if (!url) {
      const absPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(workDir, rawPath);
      try {
        url = await uploadService.saveImageFromFile(absPath);
        uploadedByPath.set(rawPath, url);
      } catch (err) {
        debugLog('inlineImageUploadFailed', { chatRoomId, rawPath, error: String(err) });
        continue;
      }
    }
    fullToReplacement.set(full, `![${alt}](${url}${titlePart})`);
  }

  let result = content;
  for (const [from, to] of fullToReplacement) {
    result = result.split(from).join(to);
  }
  return result;
}

// 构建 AI 消息对象（落库/广播前内联工作目录图片）
export async function buildAIMessage(
  content: string,
  replyToId: string | null,
  agentName: string,
  agentId: string,
  chatRoomId: string,
  avatar?: string | null,
  avatarColor?: string | null,
): Promise<Message> {
  const finalContent = await uploadInlineWorkspaceImages(content, chatRoomId);
  return {
    id: randomUUID(),
    type: 'reply',
    content: finalContent,
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
  agentName: string | string[],
  agentDescription?: string | null,
): Promise<string> {
  const messageId = randomUUID();
  const agentNames = Array.isArray(agentName) ? agentName : [agentName];
  const joinedAgentNames = agentNames.join('，');
  const descriptionText = agentNames.length === 1 && agentDescription ? `\n描述: ${agentDescription}` : '';
  const content = `🎉 新助手加入群聊\n\n**${joinedAgentNames}** 已加入群聊${descriptionText}`;
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
    agentName: joinedAgentNames,
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

  try {
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
  } catch (error) {
    console.warn('[broadcastChatRoomRulesUpdatedMessage] failed to save or broadcast notice:', error);
    debugLog('chatRoomRulesUpdatedMessageFailed', {
      chatRoomId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return messageId;
}

export function buildChatRoomDispatchRulesUpdatedMessageContent(rules?: string | null): string {
  const trimmed = rules?.trim();
  if (!trimmed) {
    return '群调度规则已清空。';
  }
  return '群调度规则（工作流）已更新，群调度助手将按新规则进行任务调度。';
}

export async function broadcastChatRoomDispatchRulesUpdatedMessage(
  chatRoomId: string,
  dispatchRules?: string | null,
): Promise<string> {
  const messageId = randomUUID();
  const content = buildChatRoomDispatchRulesUpdatedMessageContent(dispatchRules);
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

  try {
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

    // 仅用于 UI / 未读同步，不发 receivedMessage，避免触发协调器。
    if (globalBroadcastMessage) {
      await globalBroadcastMessage(message, chatRoomId);
    }
  } catch (error) {
    console.warn('[broadcastChatRoomDispatchRulesUpdatedMessage] failed to save or broadcast notice:', error);
    debugLog('chatRoomDispatchRulesUpdatedMessageFailed', {
      chatRoomId,
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return messageId;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

// 把 Markdown 代码块（``` 围栏 / ` 行内）中的内容替换为等长空白，使 @mention 解析忽略
// 代码/配置示例里的字面 "@xxx"。典型场景：群助手生成的调度规则 YAML 里有 "必须 @admin 确认"，
// 这种代码块内的 @ 不应被当成真实提及（否则会误触发「直达回复」把消息派回群助手）。
// 用等长空白替换并保留换行，确保其它位置的下标与行首/空格边界判定不受影响。
function maskCodeSpans(content: string): string {
  const blank = (segment: string): string => segment.replace(/[^\n\r]/g, ' ');
  return content
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank);
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

  // 在掩码后的副本上匹配：代码块里的 @ 已被空白替换，不会被识别为提及。
  content = maskCodeSpans(content);

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
