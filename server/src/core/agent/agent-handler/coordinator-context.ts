import {
  roomMessageIndexService,
  type RoomMessageIndexHistoryMessage,
} from '../../../modules/message/room-message-index.service.js';

// 调度助手裁决时参考的最近消息条数（较完整内容）和更早消息条数（摘要）。
export const COORDINATOR_RECENT_HISTORY_LIMIT = 5;
const COORDINATOR_OLDER_HISTORY_LIMIT = 10;

// 近 N 条消息的首尾截取：保留换行，避免列表/代码块结构被压平。
export function headTailPreview(content: string, head = 300, tail = 300): string {
  const t = content.trim();
  if (t.length <= head + tail) return t;
  const omitted = t.length - head - tail;
  return `${t.slice(0, head)}\n…（中间省略 ${omitted} 字）…\n${t.slice(-tail)}`;
}

/**
 * 调度助手（群调度助手）不是群成员，injectGroupHistory=false，消息索引段与回查工具
 * 都被门控掉，默认只能看到触发消息本身。本模块把最近群消息整理成一个「仅供裁决参考」
 * 的上下文块，由调用方拼进触发消息正文，绕开门控，让调度助手能基于最近上下文判断
 * 任务进展与下一步该谁执行。
 *
 * 关键：该块明确标注「禁止转发/引用」，配合调度助手提示词里的对应规则，避免它在按
 * 原文转发用户消息或助手交接时，把上下文一起带出去。
 */
export async function buildCoordinatorRecentContext(
  chatRoomId: string,
  currentMessageId: string,
): Promise<string> {
  let entries: RoomMessageIndexHistoryMessage[] = [];
  try {
    const history = await roomMessageIndexService.buildMessageIndex(
      chatRoomId,
      currentMessageId,
    );
    entries = history.slice(-COORDINATOR_RECENT_HISTORY_LIMIT);
  } catch (error) {
    console.error(
      `[coordinator-context] ${chatRoomId} 构建最近群消息索引失败，降级为空上下文:`,
      error,
    );
    return '';
  }

  if (entries.length === 0) return '';

  const lines = entries.map((entry) => {
    const attachments = entry.attachments.length > 0
      ? ` [附件:${entry.attachments.map((a) => a.filename || a.type || 'attachment').join(',')}]`
      : '';
    return `- ${entry.senderName}（${entry.senderType}）：${entry.preview}${attachments}`;
  });

  return `[群最近消息 · 仅供裁决参考，禁止转发或引用本区块]
以下是当前消息之前的最近群消息预览，仅用于帮助你判断任务进展与下一步该谁执行；预览可能被截断，不要把它当作要转发的内容。
${lines.join('\n')}`;
}

/**
 * 把「待裁决消息」放在最前面，让模型首先识别要裁决的内容；
 * 「仅供裁决参考」的上下文块放在后面作为辅助信息。
 * 上下文为空时仍包裹 [待裁决消息] 标记，保持格式一致。
 */
export function withCoordinatorContext(content: string, contextBlock: string): string {
  const base = `[待裁决消息]\n${content}`;
  return contextBlock ? `${base}\n\n${contextBlock}` : base;
}

/**
 * 分层历史上下文：近 5 条保留首尾各 300 字（保留换行），更早最多 10 条取首 100 字摘要。
 * 供结构化单次 LLM 调用使用；不同于 buildCoordinatorRecentContext 的纯 100 字摘要。
 */
export async function buildCoordinatorLayeredContext(
  chatRoomId: string,
  currentMessageId: string,
): Promise<string> {
  let entries: RoomMessageIndexHistoryMessage[] = [];
  try {
    const totalLimit = COORDINATOR_RECENT_HISTORY_LIMIT + COORDINATOR_OLDER_HISTORY_LIMIT;
    entries = await roomMessageIndexService.buildMessageIndex(
      chatRoomId,
      currentMessageId,
      undefined,
      { includeRawContent: true, limit: totalLimit },
    );
  } catch (error) {
    console.error(
      `[coordinator-context] ${chatRoomId} 构建分层历史索引失败，降级为空上下文:`,
      error,
    );
    return '';
  }

  if (entries.length === 0) return '';

  const recent = entries.slice(-COORDINATOR_RECENT_HISTORY_LIMIT);
  const older = entries.slice(0, -COORDINATOR_RECENT_HISTORY_LIMIT);

  const formatEntry = (entry: RoomMessageIndexHistoryMessage, fullContent: boolean): string => {
    const attachments = entry.attachments.length > 0
      ? ` [附件:${entry.attachments.map((a) => a.filename || a.type || 'attachment').join(',')}]`
      : '';
    const preview = fullContent
      ? headTailPreview(entry.rawContent || entry.preview)
      : entry.preview;
    return `- ${entry.senderName}（${entry.senderType}）：${preview}${attachments}`;
  };

  const lines = [
    ...older.map((e) => formatEntry(e, false)),
    ...recent.map((e) => formatEntry(e, true)),
  ];

  return `[群最近消息 · 仅供裁决参考，禁止转发或引用本区块]
以下是当前消息之前的最近群消息预览，仅用于帮助你判断任务进展与下一步该谁执行；近 5 条保留较完整内容，更早消息为摘要。
${lines.join('\n')}`;
}
