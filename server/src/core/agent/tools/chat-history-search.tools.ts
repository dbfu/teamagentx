import { z } from 'zod';
import prisma from '../../../lib/prisma.js';
import { messageService } from '../../../modules/message/message.service.js';
import { createSystemTool as tool } from './system-tool.js';

const MAX_LIMIT = 5;
const MAX_CONTEXT_MESSAGES = 3;
const MAX_CONTEXT_LINES = 5;
const MAX_CANDIDATES = 500;
const MAX_SNIPPETS_PER_MESSAGE = 3;
const MAX_LINE_LENGTH = 320;
const MAX_MESSAGE_PREVIEW_LENGTH = 240;
const MAX_RECENT_MESSAGE_CONTENT_LENGTH = 1200;
const MAX_DETAIL_MATCH_OFFSET = 500;
const DEFAULT_DETAIL_CONTENT_LIMIT = 4000;
const MAX_DETAIL_CONTENT_LIMIT = 12000;

type SearchRoomMessagesInput = {
  query: string;
  limit?: number;
  beforeMessageId?: string;
  afterMessageId?: string;
  senderType?: 'user' | 'agent';
  senderName?: string;
  contextMessages?: number;
  contextLines?: number;
};

type GetRecentRoomMessagesInput = {
  limit?: number;
  beforeMessageId?: string;
  afterMessageId?: string;
  senderType?: 'user' | 'agent';
  senderName?: string;
};

type GetRoomMessageDetailInput = {
  messageId?: string;
  keyword?: string;
  offset?: number;
  contentOffset?: number;
  contentLimit?: number;
  contextMessages?: number;
};

type MessageRecord = {
  id: string;
  chatRoomId?: string | null;
  content: string;
  time: Date;
  isHuman: boolean | null;
  user?: {username?: string | null} | null;
  agent?: {name?: string | null} | null;
  attachments?: Array<{filename?: string | null; type?: string | null}> | null;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value!), min), max);
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function getSenderName(message: MessageRecord): string {
  return message.user?.username || message.agent?.name || 'unknown';
}

function getSenderType(message: MessageRecord): 'user' | 'agent' {
  return message.isHuman ? 'user' : 'agent';
}

function formatCompactMessage(message: MessageRecord) {
  return {
    messageId: message.id,
    time: message.time.toISOString(),
    sender: getSenderName(message),
    senderType: getSenderType(message),
    preview: truncateText(message.content.replace(/\s+/g, ' ').trim(), MAX_MESSAGE_PREVIEW_LENGTH),
  };
}

function formatRecentMessage(message: MessageRecord) {
  return {
    messageId: message.id,
    time: message.time.toISOString(),
    sender: getSenderName(message),
    senderType: getSenderType(message),
    content: truncateText(message.content, MAX_RECENT_MESSAGE_CONTENT_LENGTH),
    attachments: (message.attachments || []).map((attachment) => ({
      filename: attachment.filename,
      type: attachment.type,
    })),
  };
}

function buildContentWindow(content: string, contentOffset: number, contentLimit: number) {
  const start = clampInt(contentOffset, 0, 0, Math.max(0, content.length));
  const limit = clampInt(contentLimit, DEFAULT_DETAIL_CONTENT_LIMIT, 1, MAX_DETAIL_CONTENT_LIMIT);
  const end = Math.min(content.length, start + limit);

  return {
    content: content.slice(start, end),
    contentOffset: start,
    contentLimit: limit,
    contentLength: content.length,
    hasPrevious: start > 0,
    hasNext: end < content.length,
    nextContentOffset: end < content.length ? end : null,
  };
}

function buildSnippets(content: string, query: string, contextLines: number) {
  const normalizedQuery = normalizeText(query);
  const lines = content.split(/\r?\n/);
  const snippets = [];

  for (let index = 0; index < lines.length && snippets.length < MAX_SNIPPETS_PER_MESSAGE; index += 1) {
    const line = lines[index];
    if (!normalizeText(line).includes(normalizedQuery)) continue;

    const beforeStart = Math.max(0, index - contextLines);
    const afterEnd = Math.min(lines.length, index + contextLines + 1);

    snippets.push({
      lineNumber: index + 1,
      before: lines
        .slice(beforeStart, index)
        .map((item) => truncateText(item, MAX_LINE_LENGTH)),
      match: truncateText(line, MAX_LINE_LENGTH),
      after: lines
        .slice(index + 1, afterEnd)
        .map((item) => truncateText(item, MAX_LINE_LENGTH)),
    });
  }

  return snippets;
}

async function findAnchorMessage(chatRoomId: string, messageId?: string) {
  if (!messageId) return null;
  const message = await prisma.message.findUnique({
    where: {id: messageId},
    select: {id: true, chatRoomId: true, time: true},
  });
  if (!message || message.chatRoomId !== chatRoomId) return null;
  return message;
}

async function getNearbyMessages(chatRoomId: string, messageId: string, count: number) {
  if (count <= 0) return undefined;

  const before = await messageService.findByChatRoomId(chatRoomId, {
    beforeMessageId: messageId,
    order: 'desc',
    take: count,
  });
  const after = await messageService.findMessagesAfterId(chatRoomId, messageId, count);

  return {
    before: before.reverse().map(formatCompactMessage),
    after: after.map(formatCompactMessage),
  };
}

export function createChatHistorySearchTools(chatRoomId: string) {
  return [
    tool(
      async (input: GetRoomMessageDetailInput = {}) => {
        const keyword = input.keyword?.trim();
        const contextMessages = clampInt(input.contextMessages, 0, 0, MAX_CONTEXT_MESSAGES);
        let message: MessageRecord | null = null;
        let selectedBy: 'messageId' | 'keyword' = 'messageId';

        if (input.messageId) {
          message = await prisma.message.findUnique({
            where: {id: input.messageId},
            include: {user: true, agent: true, attachments: true},
          }) as MessageRecord | null;

          if (!message || (message as any).chatRoomId !== chatRoomId) {
            throw new Error('messageId 不存在或不属于当前群聊');
          }
        } else {
          if (!keyword) {
            throw new Error('messageId 或 keyword 至少需要提供一个');
          }

          const offset = clampInt(input.offset, 0, 0, MAX_DETAIL_MATCH_OFFSET);
          const messages = await prisma.message.findMany({
            where: {
              chatRoomId,
              archiveId: null,
              content: {contains: keyword},
            },
            include: {user: true, agent: true, attachments: true},
            orderBy: [{time: 'desc'}, {id: 'desc'}],
            skip: offset,
            take: 1,
          }) as MessageRecord[];

          message = messages[0] ?? null;
          selectedBy = 'keyword';
        }

        if (!message) {
          return {
            chatRoomScope: 'current',
            selectedBy,
            found: false,
            keyword: keyword || null,
            offset: clampInt(input.offset, 0, 0, MAX_DETAIL_MATCH_OFFSET),
            message: null,
          };
        }

        const contentWindow = buildContentWindow(
          message.content,
          input.contentOffset ?? 0,
          input.contentLimit ?? DEFAULT_DETAIL_CONTENT_LIMIT,
        );
        const snippets = keyword ? buildSnippets(message.content, keyword, 3) : [];

        return {
          chatRoomScope: 'current',
          selectedBy,
          found: true,
          keyword: keyword || null,
          offset: selectedBy === 'keyword' ? clampInt(input.offset, 0, 0, MAX_DETAIL_MATCH_OFFSET) : null,
          message: {
            messageId: message.id,
            time: message.time.toISOString(),
            sender: getSenderName(message),
            senderType: getSenderType(message),
            ...contentWindow,
            snippets,
            attachments: (message.attachments || []).map((attachment) => ({
              filename: attachment.filename,
              type: attachment.type,
            })),
            nearbyMessages: await getNearbyMessages(chatRoomId, message.id, contextMessages),
          },
        };
      },
      {
        name: 'get_room_message_detail',
        description:
          'Get detailed content for one message in the current chatroom. Provide messageId when known, or provide keyword plus offset to open the Nth recent matching message. Use contentOffset/contentLimit to page through long message content. The chatroom is fixed to the current execution context; do not provide a chatRoomId.',
        schema: z.object({
          messageId: z.string().optional().describe('Message ID to inspect. The ID must belong to the current chatroom.'),
          keyword: z.string().min(1).max(120).optional().describe('Keyword used to find a message when messageId is not provided, and to return matching snippets inside the message. Literal substring search; regex is not supported.'),
          offset: z.number().int().min(0).max(MAX_DETAIL_MATCH_OFFSET).optional().describe('When using keyword without messageId, skip this many recent matching messages. Default 0 returns the most recent matching message.'),
          contentOffset: z.number().int().min(0).optional().describe('Character offset into the selected message content. Default 0.'),
          contentLimit: z.number().int().min(1).max(MAX_DETAIL_CONTENT_LIMIT).optional().describe('Maximum characters of message content to return. Default 4000, maximum 12000.'),
          contextMessages: z.number().int().min(0).max(MAX_CONTEXT_MESSAGES).optional().describe('Number of neighboring chat messages before and after the selected message. Default 0, maximum 3.'),
        }),
      },
    ),
    tool(
      async (input: GetRecentRoomMessagesInput = {}) => {
        const limit = clampInt(input.limit, 5, 1, MAX_LIMIT);
        const senderName = input.senderName?.trim();
        const normalizedSenderName = senderName ? normalizeText(senderName) : '';
        const beforeMessage = await findAnchorMessage(chatRoomId, input.beforeMessageId);
        const afterMessage = await findAnchorMessage(chatRoomId, input.afterMessageId);
        const timeFilters: any[] = [];

        if (input.beforeMessageId && !beforeMessage) {
          throw new Error('beforeMessageId 不存在或不属于当前群聊');
        }
        if (input.afterMessageId && !afterMessage) {
          throw new Error('afterMessageId 不存在或不属于当前群聊');
        }

        if (beforeMessage) {
          timeFilters.push({
            OR: [
              {time: {lt: beforeMessage.time}},
              {time: beforeMessage.time, id: {lt: beforeMessage.id}},
            ],
          });
        }
        if (afterMessage) {
          timeFilters.push({
            OR: [
              {time: {gt: afterMessage.time}},
              {time: afterMessage.time, id: {gt: afterMessage.id}},
            ],
          });
        }

        const candidates = await prisma.message.findMany({
          where: {
            chatRoomId,
            archiveId: null,
            ...(timeFilters.length > 0 ? {AND: timeFilters} : {}),
          },
          include: {user: true, agent: true, attachments: true},
          orderBy: [{time: 'desc'}, {id: 'desc'}],
          take: Math.min(MAX_CANDIDATES, Math.max(limit * 3, 80)),
        }) as MessageRecord[];

        const messages = [];
        for (const message of candidates) {
          if (messages.length >= limit) break;

          const senderType = getSenderType(message);
          if (input.senderType && senderType !== input.senderType) continue;
          if (normalizedSenderName && !normalizeText(getSenderName(message)).includes(normalizedSenderName)) continue;

          messages.push(formatRecentMessage(message));
        }

        return {
          chatRoomScope: 'current',
          totalReturned: messages.length,
          limit,
          messages: messages.reverse(),
        };
      },
      {
        name: 'get_recent_room_messages',
        description:
          'Get the most recent messages in the current chatroom. The chatroom is fixed to the current execution context; do not provide a chatRoomId. Return at most 5 messages per call; page with beforeMessageId/afterMessageId if more context is needed. Prefer search_room_messages when you know a keyword.',
        schema: z.object({
          limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe('Maximum recent messages to return. Default 5, maximum 5.'),
          beforeMessageId: z.string().optional().describe('Only return messages before this message ID. The ID must belong to the current chatroom.'),
          afterMessageId: z.string().optional().describe('Only return messages after this message ID. The ID must belong to the current chatroom.'),
          senderType: z.enum(['user', 'agent']).optional().describe('Optional sender type filter.'),
          senderName: z.string().max(80).optional().describe('Optional partial sender name filter, such as a human username or assistant name.'),
        }),
      },
    ),
    tool(
      async (input: SearchRoomMessagesInput) => {
        const query = input.query.trim();
        if (!query) {
          throw new Error('query is required');
        }

        const limit = clampInt(input.limit, 5, 1, MAX_LIMIT);
        const contextMessages = clampInt(input.contextMessages, 0, 0, MAX_CONTEXT_MESSAGES);
        const contextLines = clampInt(input.contextLines, 2, 0, MAX_CONTEXT_LINES);
        const senderName = input.senderName?.trim();
        const normalizedSenderName = senderName ? normalizeText(senderName) : '';
        const beforeMessage = await findAnchorMessage(chatRoomId, input.beforeMessageId);
        const afterMessage = await findAnchorMessage(chatRoomId, input.afterMessageId);
        const timeFilters: any[] = [];

        if (input.beforeMessageId && !beforeMessage) {
          throw new Error('beforeMessageId 不存在或不属于当前群聊');
        }
        if (input.afterMessageId && !afterMessage) {
          throw new Error('afterMessageId 不存在或不属于当前群聊');
        }

        if (beforeMessage) {
          timeFilters.push({
            OR: [
              {time: {lt: beforeMessage.time}},
              {time: beforeMessage.time, id: {lt: beforeMessage.id}},
            ],
          });
        }
        if (afterMessage) {
          timeFilters.push({
            OR: [
              {time: {gt: afterMessage.time}},
              {time: afterMessage.time, id: {gt: afterMessage.id}},
            ],
          });
        }

        const candidates = await prisma.message.findMany({
          where: {
            chatRoomId,
            archiveId: null,
            content: {contains: query},
            ...(timeFilters.length > 0 ? {AND: timeFilters} : {}),
          },
          include: {user: true, agent: true, attachments: true},
          orderBy: [{time: 'desc'}, {id: 'desc'}],
          take: Math.min(MAX_CANDIDATES, Math.max(limit * 8, 80)),
        }) as MessageRecord[];

        const matches = [];
        for (const message of candidates) {
          if (matches.length >= limit) break;

          const senderType = getSenderType(message);
          if (input.senderType && senderType !== input.senderType) continue;
          if (normalizedSenderName && !normalizeText(getSenderName(message)).includes(normalizedSenderName)) continue;

          const snippets = buildSnippets(message.content, query, contextLines);
          if (snippets.length === 0) continue;

          matches.push({
            messageId: message.id,
            time: message.time.toISOString(),
            sender: getSenderName(message),
            senderType,
            matchCount: normalizeText(message.content).split(normalizeText(query)).length - 1,
            snippets,
            attachments: (message.attachments || []).map((attachment) => ({
              filename: attachment.filename,
              type: attachment.type,
            })),
            nearbyMessages: await getNearbyMessages(chatRoomId, message.id, contextMessages),
          });
        }

        return {
          query,
          chatRoomScope: 'current',
          totalReturned: matches.length,
          limit,
          contextLines,
          contextMessages,
          matches,
        };
      },
      {
        name: 'search_room_messages',
        description:
          'Search messages in the current chatroom by keyword. The chatroom is fixed to the current execution context; do not provide a chatRoomId. Return at most 5 matching messages per call. It behaves like grep -n -C: returns matching message snippets, line numbers, and optional nearby messages instead of dumping full history.',
        schema: z.object({
          query: z.string().min(1).max(120).describe('Keyword to search for in the current chatroom. Literal substring search; regex is not supported.'),
          limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe('Maximum matching messages to return. Default 5, maximum 5.'),
          beforeMessageId: z.string().optional().describe('Only search messages before this message ID. The ID must belong to the current chatroom.'),
          afterMessageId: z.string().optional().describe('Only search messages after this message ID. The ID must belong to the current chatroom.'),
          senderType: z.enum(['user', 'agent']).optional().describe('Optional sender type filter.'),
          senderName: z.string().max(80).optional().describe('Optional partial sender name filter, such as a human username or assistant name.'),
          contextMessages: z.number().int().min(0).max(MAX_CONTEXT_MESSAGES).optional().describe('Number of neighboring chat messages before and after each match. Default 0, maximum 3.'),
          contextLines: z.number().int().min(0).max(MAX_CONTEXT_LINES).optional().describe('Number of lines before and after a matching line inside a long message. Default 2, maximum 5.'),
        }),
      },
    ),
  ];
}
