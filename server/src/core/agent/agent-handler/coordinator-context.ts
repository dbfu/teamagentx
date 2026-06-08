import {
  roomMessageIndexService,
  type RoomMessageIndexHistoryMessage,
} from '../../../modules/message/room-message-index.service.js';

// 调度助手裁决时参考的最近群消息条数。
export const COORDINATOR_RECENT_HISTORY_LIMIT = 5;

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
 * 上下文为空时原样返回，不做任何包装。
 */
export function withCoordinatorContext(content: string, contextBlock: string): string {
  if (!contextBlock) return content;
  // 调整顺序：待裁决消息先出现，上下文区块后出现作为参考
  return `[待裁决消息]\n${content}\n\n${contextBlock}`;
}
