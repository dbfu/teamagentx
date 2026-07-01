export const MAX_REPLY_CONTEXT_CONTENT_CHARS = 2000;

export type ReplyContextMessage = {
  id: string;
  chatRoomId: string;
  content: string;
  time: Date | string;
  isHuman: boolean | null;
  archiveId?: string | null;
  user?: { username?: string | null } | null;
  agent?: { name?: string | null } | null;
  attachments?: Array<{ filename?: string | null; type?: string | null }> | null;
};

function getSenderName(message: ReplyContextMessage): string {
  return message.user?.username || message.agent?.name || 'unknown';
}

function getSenderType(message: ReplyContextMessage): 'user' | 'agent' {
  return message.isHuman ? 'user' : 'agent';
}

function formatReplyContextTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function truncateReplyContextContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const normalized = content.trim();
  if (normalized.length <= MAX_REPLY_CONTEXT_CONTENT_CHARS) {
    return { content: normalized, truncated: false };
  }
  return {
    content: `${normalized.slice(0, MAX_REPLY_CONTEXT_CONTENT_CHARS)}...`,
    truncated: true,
  };
}

export function buildReplyContextSection(message: ReplyContextMessage): string {
  const content = truncateReplyContextContent(message.content);
  const attachments = (message.attachments || []).map((attachment) => ({
    filename: attachment.filename,
    type: attachment.type,
  }));
  const attachmentLine = attachments.length > 0
    ? `\nattachments=${JSON.stringify(attachments)}`
    : '';
  const truncatedLine = content.truncated
    ? '\ncontentTruncated=true'
    : '';

  return `[当前消息引用]
当前消息带有 replyMessageId，表示它是在回复下面这条聊天消息。回答时请优先把这条被回复消息作为当前请求的直接上下文。
replyMessageId=${message.id}
time=${formatReplyContextTime(message.time)}
sender=${JSON.stringify(getSenderName(message))}
senderType=${getSenderType(message)}
content=${JSON.stringify(content.content)}${truncatedLine}${attachmentLine}`;
}

export function prependReplyContextSection(
  content: string,
  replyTargetMessage: ReplyContextMessage,
): string {
  return `${buildReplyContextSection(replyTargetMessage)}\n\n[当前消息正文]\n${content}`;
}
