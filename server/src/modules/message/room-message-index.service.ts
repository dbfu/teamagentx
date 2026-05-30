import { config } from '../../config/index.js';
import prisma from '../../lib/prisma.js';

const DEFAULT_PREVIEW_CHARS = 100;

type MessageIndexRecord = {
  id: string;
  content: string;
  time: Date;
  isHuman: boolean | null;
  user?: {username?: string | null} | null;
  agent?: {name?: string | null} | null;
  attachments?: Array<{filename?: string | null; type?: string | null}> | null;
};

export type RoomMessageIndexHistoryMessage = {
  content: string;
  senderName: string;
  isHuman: boolean;
  kind: 'message_index';
  messageId: string;
  time: string;
  senderType: 'user' | 'agent';
  preview: string;
  attachments: Array<{filename?: string | null; type?: string | null}>;
};

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizePreview(content: string, maxChars: number): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

function getSenderName(message: MessageIndexRecord): string {
  return message.user?.username || message.agent?.name || 'unknown';
}

function toIndexMessage(message: MessageIndexRecord): RoomMessageIndexHistoryMessage {
  const previewChars = getPositiveIntegerEnv(
    'AGENT_ROOM_MESSAGE_INDEX_PREVIEW_CHARS',
    DEFAULT_PREVIEW_CHARS,
  );
  const senderType = message.isHuman ? 'user' : 'agent';
  const preview = normalizePreview(message.content, previewChars);

  return {
    kind: 'message_index',
    messageId: message.id,
    time: message.time.toISOString(),
    senderName: getSenderName(message),
    senderType,
    isHuman: senderType === 'user',
    preview,
    content: preview,
    attachments: (message.attachments || []).map((attachment) => ({
      filename: attachment.filename,
      type: attachment.type,
    })),
  };
}

async function findMessageAnchor(chatRoomId: string, messageId?: string) {
  if (!messageId) return null;
  const message = await prisma.message.findUnique({
    where: {id: messageId},
    select: {id: true, chatRoomId: true, time: true, archiveId: true},
  });
  if (!message || message.chatRoomId !== chatRoomId || message.archiveId) return null;
  return message;
}

export const roomMessageIndexService = {
  async buildMessageIndex(
    chatRoomId: string,
    currentMessageId: string,
    afterMessageId?: string,
  ): Promise<RoomMessageIndexHistoryMessage[]> {
    const currentMessage = await findMessageAnchor(chatRoomId, currentMessageId);
    if (!currentMessage) return [];

    const afterMessage = await findMessageAnchor(chatRoomId, afterMessageId);
    const limit = getPositiveIntegerEnv(
      'AGENT_ROOM_MESSAGE_INDEX_LIMIT',
      Math.max(1, config.agent.memoryRecentMessages),
    );

    const timeFilters: any[] = [
      {
        OR: [
          {time: {lt: currentMessage.time}},
          {time: currentMessage.time, id: {lt: currentMessage.id}},
        ],
      },
    ];

    if (afterMessage) {
      timeFilters.push({
        OR: [
          {time: {gt: afterMessage.time}},
          {time: afterMessage.time, id: {gt: afterMessage.id}},
        ],
      });
    }

    const messages = await prisma.message.findMany({
      where: {
        chatRoomId,
        archiveId: null,
        AND: timeFilters,
      },
      include: {user: true, agent: true, attachments: true},
      orderBy: [{time: 'desc'}, {id: 'desc'}],
      take: limit,
    }) as MessageIndexRecord[];

    return messages.reverse().map(toIndexMessage);
  },
};

export function buildRoomMessageIndexSection(
  history?: Array<{
    kind?: string;
    messageId?: string;
    time?: string;
    senderName?: string;
    senderType?: string;
    preview?: string;
    attachments?: Array<{filename?: string | null; type?: string | null}>;
  }>,
): string {
  const indexMessages = (history || []).filter(
    (message): message is RoomMessageIndexHistoryMessage =>
      message.kind === 'message_index' && Boolean(message.messageId),
  );

  if (indexMessages.length === 0) return '';

  const lines = indexMessages.map((message) => {
    const attachments = message.attachments.length > 0
      ? ` attachments=${message.attachments.map((attachment) => attachment.filename || attachment.type || 'attachment').join(',')}`
      : '';
    return `- messageId=${message.messageId} time=${message.time} sender=${message.senderName} senderType=${message.senderType}${attachments} preview="${message.preview}"`;
  });

  return `[New Group Message Index]
The following are message indexes for group-chat messages before the current message that were not previously injected, or the initial recent index for this assistant. Previews are only navigation hints. If your answer depends on exact prior content, call get_room_message_detail with the messageId before answering.
${lines.join('\n')}
`;
}

export function buildRoomHistorySection(
  history?: Array<{
    kind?: string;
    content?: string;
    senderName?: string;
    isHuman?: boolean;
    messageId?: string;
    time?: string;
    senderType?: string;
    preview?: string;
    attachments?: Array<{filename?: string | null; type?: string | null}>;
  }>,
): string {
  const messageIndexSection = buildRoomMessageIndexSection(history);
  const recentMessages = (history || []).filter(
    (message) =>
      message.kind !== 'message_index' &&
      typeof message.content === 'string' &&
      message.content.trim().length > 0,
  );

  if (recentMessages.length === 0) return messageIndexSection;

  const lines = recentMessages.map((message) => {
    const senderType = message.senderType || (message.isHuman ? 'user' : 'agent');
    const metadata = [
      message.messageId ? `messageId=${message.messageId}` : null,
      message.time ? `time=${message.time}` : null,
      `sender=${message.senderName || 'unknown'}`,
      `senderType=${senderType}`,
    ].filter(Boolean).join(' ');
    const content = JSON.stringify(message.content!.trim());
    return `- ${metadata} content=${content}`;
  });

  const recentHistorySection = `[Recent Group History]
The following are recent group-chat messages before the current message. Use them as context for routing and follow-up decisions.
${lines.join('\n')}
`;

  return [messageIndexSection, recentHistorySection].filter(Boolean).join('\n');
}
