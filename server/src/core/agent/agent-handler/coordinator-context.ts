import {
  roomMessageIndexService,
  type RoomMessageIndexHistoryMessage,
} from '../../../modules/message/room-message-index.service.js';
import { type Locale, pickLocaleText } from './locale.js';

// 调度助手裁决时参考的最近消息条数（较完整内容）和更早消息条数（摘要）。
export const COORDINATOR_RECENT_HISTORY_LIMIT = 5;
const COORDINATOR_OLDER_HISTORY_LIMIT = 10;

// 注入上下文与调度提示词之间的「逐字契约」标记文案。
// 调度提示词（internal-coordinator-agent.ts）按 locale 引用相同标记，二者必须同语种，
// 否则模型会因「提示词里说找 X 标记、实际注入的是 Y 标记」而对不上。
export const COORDINATOR_PENDING_DECISION_LABEL: Record<Locale, string> = {
  'zh-CN': '待裁决消息',
  'en-US': 'Pending Decision',
};
export const COORDINATOR_RECENT_MESSAGES_LABEL: Record<Locale, string> = {
  'zh-CN': '群最近消息 · 仅供裁决参考，禁止转发或引用本区块',
  'en-US':
    'Recent Room Messages · for routing reference only; do NOT forward or quote this block',
};

export function coordinatorPendingDecisionLabel(locale?: string): string {
  return pickLocaleText(COORDINATOR_PENDING_DECISION_LABEL, locale);
}
export function coordinatorRecentMessagesLabel(locale?: string): string {
  return pickLocaleText(COORDINATOR_RECENT_MESSAGES_LABEL, locale);
}

// 近 N 条消息的首尾截取：保留换行，避免列表/代码块结构被压平。
export function headTailPreview(
  content: string,
  head = 300,
  tail = 300,
  locale?: string,
): string {
  const t = content.trim();
  if (t.length <= head + tail) return t;
  const omitted = t.length - head - tail;
  const ellipsis = pickLocaleText(
    {
      'zh-CN': `\n…（中间省略 ${omitted} 字）…\n`,
      'en-US': `\n… (${omitted} chars omitted) …\n`,
    },
    locale,
  );
  return `${t.slice(0, head)}${ellipsis}${t.slice(-tail)}`;
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
  locale?: string,
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

  const lines = entries.map((entry) => formatContextLine(entry, entry.preview));

  const intro = pickLocaleText(
    {
      'zh-CN':
        '以下是当前消息之前的最近群消息预览，仅用于帮助你判断任务进展与下一步该谁执行；预览可能被截断，不要把它当作要转发的内容。',
      'en-US':
        'Below are previews of recent room messages before the current one, only to help you judge task progress and who should act next; previews may be truncated, do not treat them as content to forward.',
    },
    locale,
  );
  return `[${coordinatorRecentMessagesLabel(locale)}]
${intro}
${lines.join('\n')}`;
}

// 上下文消息行：发送者 + 类型 + 预览 + 附件，按 locale 渲染括号与附件标签。
function formatContextLine(
  entry: RoomMessageIndexHistoryMessage,
  preview: string,
  locale?: string,
): string {
  const attachmentLabel = pickLocaleText(
    { 'zh-CN': '附件', 'en-US': 'attachments' },
    locale,
  );
  const attachments = entry.attachments.length > 0
    ? ` [${attachmentLabel}:${entry.attachments.map((a) => a.filename || a.type || 'attachment').join(',')}]`
    : '';
  const sep = pickLocaleText({ 'zh-CN': '（', 'en-US': ' (' }, locale);
  const sepEnd = pickLocaleText({ 'zh-CN': '）：', 'en-US': '): ' }, locale);
  return `- ${entry.senderName}${sep}${entry.senderType}${sepEnd}${preview}${attachments}`;
}

/**
 * 待裁决消息的发送者信息，用于在标记里标注「来自用户/助手 + 名称」。
 * 协调器据此判断这条是用户新需求还是助手自己的进度/完成报告，避免把助手
 * 自己的话原样 forwardVerbatim 回传给它自己（自环转发）。
 */
export interface CoordinatorSender {
  isHuman?: boolean;
  name?: string | null;
}

function formatSenderLabel(sender?: CoordinatorSender, locale?: string): string {
  if (!sender) return '';
  const name = sender.name?.trim();
  if (sender.isHuman) {
    return pickLocaleText(
      {
        'zh-CN': name ? `来自用户 ${name}` : '来自用户',
        'en-US': name ? `from user ${name}` : 'from user',
      },
      locale,
    );
  }
  return pickLocaleText(
    {
      'zh-CN': name ? `来自助手 ${name}` : '来自助手',
      'en-US': name ? `from assistant ${name}` : 'from assistant',
    },
    locale,
  );
}

/**
 * 把「待裁决消息」放在最前面，让模型首先识别要裁决的内容；
 * 「仅供裁决参考」的上下文块放在后面作为辅助信息。
 * 上下文为空时仍包裹 [待裁决消息] 标记，保持格式一致。
 * 提供 sender 时在标记里标注发送者（来自用户/助手 + 名称），帮助协调器区分
 * 「用户新需求」与「助手自己的报告」。
 */
export function withCoordinatorContext(
  content: string,
  contextBlock: string,
  sender?: CoordinatorSender,
  locale?: string,
): string {
  const marker = coordinatorPendingDecisionLabel(locale);
  const label = formatSenderLabel(sender, locale);
  const header = label ? `[${marker} · ${label}]` : `[${marker}]`;
  const base = `${header}\n${content}`;
  return contextBlock ? `${base}\n\n${contextBlock}` : base;
}

/**
 * 分层历史上下文：近 5 条保留首尾各 300 字（保留换行），更早最多 10 条取首 100 字摘要。
 * 供结构化单次 LLM 调用使用；不同于 buildCoordinatorRecentContext 的纯 100 字摘要。
 */
export async function buildCoordinatorLayeredContext(
  chatRoomId: string,
  currentMessageId: string,
  locale?: string,
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
    const preview = fullContent
      ? headTailPreview(entry.rawContent || entry.preview, 300, 300, locale)
      : entry.preview;
    return formatContextLine(entry, preview, locale);
  };

  const lines = [
    ...older.map((e) => formatEntry(e, false)),
    ...recent.map((e) => formatEntry(e, true)),
  ];

  const intro = pickLocaleText(
    {
      'zh-CN':
        '以下是当前消息之前的最近群消息预览，仅用于帮助你判断任务进展与下一步该谁执行；近 5 条保留较完整内容，更早消息为摘要。',
      'en-US':
        'Below are previews of recent room messages before the current one, only to help you judge task progress and who should act next; the latest 5 keep fuller content, earlier ones are summaries.',
    },
    locale,
  );
  return `[${coordinatorRecentMessagesLabel(locale)}]
${intro}
${lines.join('\n')}`;
}
