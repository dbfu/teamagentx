import prisma from '../../lib/prisma.js';
import { bridgeService } from './bridge.service.js';
import { parseStoredBridgeConfig, resolveStoredBridgeBotToken } from './bridge-platform-config.js';

type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';
type SenderFn = (botId: string, externalId: string, text: string, agentName: string) => Promise<void>;
type TypingSenderFn = (botId: string, externalId: string, sourceMessageId?: string) => Promise<void>;
type TypingClearerFn = (botId: string, externalId: string, sourceMessageId?: string) => Promise<void>;
const DINGTALK_SESSION_WEBHOOK_PREFIX = 'sessionWebhook:';
const FEISHU_TYPING_EMOJI_TYPE = 'Typing';

// DingTalk session webhook 允许的外发 host（与 dingtalk-stream-client 保持一致）
const ALLOWED_WEBHOOK_HOSTS = ['oapi.dingtalk.com', 'api.dingtalk.com'];

// Telegram per-(botToken+chatId) 发送序列化队列，防止并发 flood
const sendQueues = new Map<string, Promise<void>>();

export interface BridgePlatformAdapter {
  platform: Platform;
  sendMessage: SenderFn;
  sendTyping?: TypingSenderFn;
  clearTyping?: TypingClearerFn;
}

// Simple in-memory access token cache: key → { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const feishuTypingReactions = new Map<string, { messageId: string; reactionId: string | null }>();

function getCachedToken(key: string): string | null {
  const entry = tokenCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    tokenCache.delete(key);
    return null;
  }
  return entry.token;
}

function setCachedToken(key: string, token: string, expiresInSeconds: number): void {
  tokenCache.set(key, { token, expiresAt: Date.now() + expiresInSeconds * 1000 });
}

function splitMessage(text: string, maxLen: number): string[] {
  const chars = Array.from(text); // 按 Unicode code point 分割，避免 emoji surrogate pair 截断
  if (chars.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < chars.length; i += maxLen) {
    chunks.push(chars.slice(i, i + maxLen).join(''));
  }
  return chunks;
}

// ─── Telegram：Markdown → MarkdownV2 转换 ───

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeTelegramMarkdownV2Text(s: string): string {
  return s.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function escapeTelegramCodeContent(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
}

function escapeTelegramUrl(url: string): string {
  return url.replace(/\\/g, '\\\\');
}

export function markdownToTelegramMarkdownV2(md: string): string {
  md = md.replace(/[\x01\x02]/g, '');
  const saved: string[] = [];
  const PLACEHOLDER = '\x01';

  // 1. 提取围栏代码块（```lang\ncode\n```）
  let out = md.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    const language = lang.trim();
    const fenceHeader = language ? `\`\`\`${language}\n` : '```\n';
    saved.push(`${fenceHeader}${escapeTelegramCodeContent(trimmed)}\n\`\`\``);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 1.5 提取 LaTeX 公式（防止 _ ^ 被识别为 MarkdownV2 符号）
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula: string) => {
    saved.push(`\`${escapeTelegramCodeContent(`$$${formula.trim()}$$`)}\``);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/\$([^\n$]+?)\$/g, (_, formula: string) => {
    saved.push(`\`${escapeTelegramCodeContent(`$${formula.trim()}$`)}\``);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 2. 提取行内代码
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    saved.push(`\`${escapeTelegramCodeContent(code)}\``);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 3. 提取链接，避免普通文本转义影响 URL 结构
  out = out.replace(/!?\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => {
    saved.push(`[${escapeTelegramMarkdownV2Text(label)}](${escapeTelegramUrl(url)})`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 4. 提取标题 / 强调 / 删除线 / 引用，生成合法 MarkdownV2 片段
  out = out.replace(/^#{1,6}\s+(.+)$/gm, (_, title: string) => {
    saved.push(`*${escapeTelegramMarkdownV2Text(title.trim())}*`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/^\s*>\s?(.+)$/gm, (_, quoted: string) => {
    saved.push(`> ${escapeTelegramMarkdownV2Text(quoted.trim())}`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/\*\*\*([\s\S]+?)\*\*\*/g, (_, text: string) => {
    saved.push(`*_${escapeTelegramMarkdownV2Text(text)}_*`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/___([\s\S]+?)___/g, (_, text: string) => {
    saved.push(`*_${escapeTelegramMarkdownV2Text(text)}_*`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, (_, text: string) => {
    saved.push(`*${escapeTelegramMarkdownV2Text(text)}*`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/__([\s\S]+?)__/g, (_, text: string) => {
    saved.push(`*${escapeTelegramMarkdownV2Text(text)}*`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g, (_, text: string) => {
    saved.push(`_${escapeTelegramMarkdownV2Text(text)}_`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/(?<!_)_(?!_)([\s\S]+?)(?<!_)_(?!_)/g, (_, text: string) => {
    saved.push(`_${escapeTelegramMarkdownV2Text(text)}_`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });
  out = out.replace(/~~([\s\S]+?)~~/g, (_, text: string) => {
    saved.push(`~${escapeTelegramMarkdownV2Text(text)}~`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 5. 表格降级 + 列表转换
  out = convertMarkdownTable(out);
  out = out.replace(/^[ \t]*[-*+] (.+)$/gm, '• $1');
  out = out.replace(/^[-*_]{3,}$/gm, '──────────');

  // 6. 对剩余普通文本做 MarkdownV2 转义（按占位符切分）
  out = out
    .split(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`))
    .map((seg, i) => (i % 2 === 0 ? escapeTelegramMarkdownV2Text(seg) : `${PLACEHOLDER}${seg}${PLACEHOLDER}`))
    .join('');

  // 7. 还原占位符
  out = out.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, idx) => saved[parseInt(idx)]);

  return out;
}

// Telegram MarkdownV2 分段时避免超长，取保守 3800 字符
function splitTelegramMarkdownV2(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = maxLen;
    if (remaining[cut - 1] === '\\') cut -= 1;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ─── Telegram sender ───
async function telegramSend(botId: string, externalId: string, text: string, agentName: string): Promise<void> {
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const botToken = bridgeBot ? resolveStoredBridgeBotToken(bridgeBot) : undefined;
  if (!botToken) return;

  const { body: bodyText, isRoomUserMessage } = parseGroupPrefix(text, agentName);
  const safeAgentName = escapeTelegramMarkdownV2Text(agentName.replace(/[\r\n]/g, ' '));
  const header = isRoomUserMessage ? `> 👤 *${safeAgentName}*` : `> 🤖 *${safeAgentName}*`;
  const body = markdownToTelegramMarkdownV2(bodyText);
  const full = header + '\n' + body;
  const chunks = splitTelegramMarkdownV2(full);
  const chatId = externalId;

  for (const chunk of chunks) {
    const chatKey = `${botToken}:${chatId}`;
    const prev = sendQueues.get(chatKey) ?? Promise.resolve();
    const next = prev.then(async () => {
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'MarkdownV2', disable_web_page_preview: true }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        if (res.status === 400 && errBody.includes("can't parse entities")) {
          const fallback = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `[${agentName}] ${text}`.slice(0, 4096) }),
          });
          if (!fallback.ok) {
            const fallbackBody = await fallback.text().catch(() => '');
            throw new Error(`[Telegram] send failed: ${fallback.status} ${fallbackBody.slice(0, 200)}`);
          }
          throw new TelegramFallbackSent();
        } else {
          throw new Error(`[Telegram] send failed: ${res.status} ${errBody.slice(0, 200)}`);
        }
      }
      // 清理已完成队列项（队列超过 500 条时触发）
      if (sendQueues.size > 500) {
        sendQueues.delete(chatKey);
      }
    });
    sendQueues.set(chatKey, next.catch(() => {}));
    try {
      await next;
    } catch (err) {
      if (err instanceof TelegramFallbackSent) break;
      throw err;
    }
  }
}

/** 内部信号类：表示 Telegram HTML 降级已发送，应跳出 chunk 循环 */
class TelegramFallbackSent extends Error {
  constructor() { super('fallback sent'); }
}

async function telegramTyping(botId: string, externalId: string): Promise<void> {
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const botToken = bridgeBot ? resolveStoredBridgeBotToken(bridgeBot) : undefined;
  if (!botToken) return;

  await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: externalId, action: 'typing' }),
  }).catch((error) => {
    console.error('[Bridge/telegram] typing 发送失败:', error);
  });
}

function parseGroupPrefix(text: string, agentName: string): { body: string; isRoomUserMessage: boolean } {
  const isRoomUserMessage = text.startsWith(`[群聊·${agentName}]`);
  const body = isRoomUserMessage
    ? text.replace(new RegExp(`^\\[群聊·${escapeRegExp(agentName)}\\]\\s*`), '')
    : text;
  return { body, isRoomUserMessage };
}

function escapeFeishuMdInline(text: string): string {
  return escapeHtml(text).replace(/([\\*_`~[\]()])/g, '\\$1');
}

export function resolveFeishuReceiveIdType(_externalId: string): 'chat_id' {
  return 'chat_id';
}

function logFeishuFlow(stage: string, details: Record<string, unknown>): void {
  console.log(`[Bridge/feishu][${stage}] ${JSON.stringify(details)}`);
}

// ─── 共用工具：MD 表格 → 逐行 "字段: 值" 纯文本 ───
function convertMarkdownTable(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 识别表头行（以 | 开头并以 | 结尾）
    if (/^\|.+\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s|:-]+\|$/.test(lines[i + 1].trim())) {
      const headers = line.split('|').slice(1, -1).map((s) => s.trim());
      i += 2; // 跳过表头和分隔行
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        const cells = lines[i].split('|').slice(1, -1).map((s) => s.trim());
        out.push(headers.map((h, idx) => `${h}: ${cells[idx] ?? ''}`).join(' | '));
        i++;
      }
      continue;
    }
    out.push(line);
    i++;
  }
  return out.join('\n');
}

// ─── 飞书 Markdown 规范化：仅降级已知兼容性较差的语法 ───
function normalizeForFeishu(md: string): string {
  md = md.replace(/[\x01\x02]/g, '');
  const saved: string[] = [];
  const PH = '\x02';

  let out = md.replace(/```[\s\S]*?```/g, (block) => {
    saved.push(block);
    return `${PH}${saved.length - 1}${PH}`;
  });

  out = convertMarkdownTable(out);
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt: string, url: string) => {
    const label = alt.trim() ? alt.trim() : '图片';
    return `[${label}](${url})`;
  });
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '**$1**');

  // 引用块飞书 JSON 1.0 不支持，去掉 > 前缀保留内容
  out = out.replace(/^>\s?/gm, '');

  out = out.replace(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.+)$/gm, (_, indent: string, checked: string, text: string) => {
    const normalizedIndent = indent.replace(/\t/g, '  ');
    const level = Math.floor(normalizedIndent.length / 2);
    const icon = /[xX]/.test(checked) ? '☑' : '☐';
    return `${'  '.repeat(level)}${icon} ${text}`;
  });

  out = out.replace(/^(\s*)[-*+]\s+(.+)$/gm, (_, _indent: string, text: string) => {
    return `- ${text}`;
  });

  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => `公式：\n${expr.trim()}`);
  out = out.replace(/\$([^\n$]+?)\$/g, (_, expr: string) => expr.trim());

  out = out.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, idx) => saved[parseInt(idx)]);

  return out;
}

// ─── 企微 Markdown 方言转换 ───
/**
 * 企微 msgtype:markdown 仅支持：**bold** [text](url) \n <font color>
 * 不支持：标题 代码块 斜体 删除线 表格 引用 列表（部分支持 • 换行）
 */
export function markdownToWecomMarkdown(md: string): string {
  md = md.replace(/[\x01\x02]/g, '');
  const saved: string[] = [];
  const PH = '\x02';

  // 1. 提取围栏代码块
  let out = md.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, _lang, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    saved.push(`【代码】\n${trimmed}\n【/代码】`);
    return `${PH}${saved.length - 1}${PH}`;
  });

  // 1.5 提取 LaTeX 公式（防止 _ 被斜体正则误处理）
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (block) => {
    saved.push(block);
    return `${PH}${saved.length - 1}${PH}`;
  });
  out = out.replace(/\$([^\n$]+?)\$/g, (block) => {
    saved.push(block);
    return `${PH}${saved.length - 1}${PH}`;
  });

  // 2. 提取行内代码（保留内容，去除反引号）
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    saved.push(code);
    return `${PH}${saved.length - 1}${PH}`;
  });

  // 3. 表格降级
  out = convertMarkdownTable(out);

  // 4. 标题 → 加粗
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '**$1**');

  // 5. 引用 > → 去前缀
  out = out.replace(/^>\s?/gm, '');

  // 6. 任务列表 → ☑ / ☐（先于普通列表处理，避免 • 插入后正则失配）
  out = out.replace(/^([ \t]*)[-*+] \[([ xX])\]\s+(.+)$/gm, (_, indent: string, checked: string, text: string) => {
    const icon = /[xX]/.test(checked) ? '☑' : '☐';
    return `${indent}${icon} ${text}`;
  });

  // 6.5 无序列表 - / * / + → •
  out = out.replace(/^[ \t]*[-*+] /gm, '• ');

  // 6.5 图片 ![alt](url) → [alt](url)（企微 MD 不支持内联图片，降级为链接）
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1]($2)');

  // 7. 删除线 → 保留内容
  out = out.replace(/~~([\s\S]+?)~~/g, '$1');

  // 7.5 粗斜体 ***text*** / ___text___ → **text**（企微不支持斜体，降级为粗体）
  out = out.replace(/\*\*\*([\s\S]+?)\*\*\*/g, '**$1**');
  out = out.replace(/___([\s\S]+?)___/g, '**$1**');

  // 8. 斜体 *text*（避免影响 **bold**）
  out = out.replace(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g, '$1');
  out = out.replace(/(?<!_)_(?!_)([\s\S]+?)(?<!_)_(?!_)/g, '$1');

  // 9. 还原占位
  out = out.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, idx) => saved[parseInt(idx)]);

  // 9.5 公式降级为纯文本
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => `公式：\n${expr.trim()}`);
  out = out.replace(/\$([^\n$]+?)\$/g, '$1');

  // 10. 截断（企微 markdown content 上限 2048 字符）
  if (out.length > 2048) {
    out = out.slice(0, 2000) + '\n…(内容已截断)';
  }

  return out;
}

// ─── QQ 纯文本：去除所有 MD 符号，保留内容语义 ───
/**
 * QQ 当前使用 msg_type=0 纯文本，MD 符号需全部清理
 */
export function markdownToQQPlainText(md: string): string {
  md = md.replace(/[\x01\x02]/g, '');
  const saved: string[] = [];
  const PH = '\x02';

  // 1. 提取围栏代码块
  let out = md.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, _lang, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    saved.push(`[代码]\n${trimmed}\n[/代码]`);
    return `${PH}${saved.length - 1}${PH}`;
  });

  // 1.5 提取 LaTeX 公式（防止 _ 被斜体正则误处理）
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (block) => {
    saved.push(block);
    return `${PH}${saved.length - 1}${PH}`;
  });
  out = out.replace(/\$([^\n$]+?)\$/g, (block) => {
    saved.push(block);
    return `${PH}${saved.length - 1}${PH}`;
  });

  // 2. 行内代码 → 裸内容
  out = out.replace(/`([^`\n]+)`/g, '$1');

  // 3. 表格降级
  out = convertMarkdownTable(out);

  // 4. 标题 → 内容（加空行）
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // 5. 引用 > → 去前缀
  out = out.replace(/^>\s?/gm, '');

  // 6. 无序列表 → •
  out = out.replace(/^[ \t]*[-*+] /gm, '• ');

  // 6.25 任务列表 → ☑ / ☐
  out = out.replace(/^• \[([ xX])\]\s+(.+)$/gm, (_, checked: string, text: string) => {
    const icon = /[xX]/.test(checked) ? '☑' : '☐';
    return `${icon} ${text}`;
  });

  // 7. 粗体 **text** / __text__
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
  out = out.replace(/__([\s\S]+?)__/g, '$1');

  // 8. 斜体 *text* / _text_
  out = out.replace(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g, '$1');
  out = out.replace(/(?<!_)_(?!_)([\s\S]+?)(?<!_)_(?!_)/g, '$1');

  // 9. 删除线
  out = out.replace(/~~([\s\S]+?)~~/g, '$1');

  // 10. 链接/图片 [text](url) 或 ![alt](url) → text (url)
  out = out.replace(/!?\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)');

  // 11. 还原代码块
  out = out.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, idx) => saved[parseInt(idx)]);

  // 12. 公式降级为纯文本
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => `公式：\n${expr.trim()}`);
  out = out.replace(/\$([^\n$]+?)\$/g, '$1');

  return out;
}

export function markdownToDingTalkMarkdown(md: string): string {
  md = md.replace(/[\x01\x02]/g, '');
  const saved: string[] = [];
  const PH = '\x02';

  let out = md.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    const title = lang.trim() ? `代码块（${lang.trim()}）` : '代码块';
    saved.push(`${title}\n\`\`\`\n${trimmed}\n\`\`\``);
    return `${PH}${saved.length - 1}${PH}`;
  });

  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    saved.push(`\`${code}\``);
    return `${PH}${saved.length - 1}${PH}`;
  });

  out = convertMarkdownTable(out);
  out = out.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_, alt: string, url: string) => {
    const label = alt.trim() ? alt.trim() : '图片';
    return `[${label}](${url})`;
  });
  out = out.replace(/^#{3,6}\s+(.+)$/gm, '**$1**');
  out = out.replace(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.+)$/gm, (_, indent: string, checked: string, text: string) => {
    const level = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    const icon = /[xX]/.test(checked) ? '☑' : '☐';
    return `${'  '.repeat(level)}${icon} ${text}`;
  });
  out = out.replace(/^(\s*)[-*+]\s+(.+)$/gm, (_, indent: string, text: string) => {
    const level = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return `${'  '.repeat(level)}- ${text}`;
  });
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) => `公式：\n${expr.trim()}`);
  out = out.replace(/\$([^\n$]+?)\$/g, '$1');
  out = out.replace(new RegExp(`${PH}(\\d+)${PH}`, 'g'), (_, idx) => saved[parseInt(idx)]);

  return out;
}

export function markdownToFeishuCard(agentName: string, md: string): Record<string, unknown> {
  const { body: rawBody, isRoomUserMessage } = parseGroupPrefix(md, agentName);
  const body = normalizeForFeishu(rawBody);
  const header = isRoomUserMessage
    ? `<font color='green'>**${escapeFeishuMdInline(agentName)}**</font> 消息`
    : `🤖 <font color='blue'>**${escapeFeishuMdInline(agentName)}**</font> 消息`;

  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: header },
      },
      {
        tag: 'markdown',
        content: body,
      },
    ],
  };
}

// ─── 飞书 sender ───
async function getFeishuToken(botId: string, appId: string, appSecret: string): Promise<string> {
  const cacheKey = `feishu:${botId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[Feishu] token fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { tenant_access_token: string; expire: number };
  const safeExpiry = (typeof data.expire === 'number' && isFinite(data.expire) && data.expire > 0) ? data.expire - 60 : 60;
  setCachedToken(cacheKey, data.tenant_access_token, safeExpiry);
  return data.tenant_access_token;
}

async function feishuSend(botId: string, externalId: string, text: string, agentName: string): Promise<void> {
  const receiveIdType = resolveFeishuReceiveIdType(externalId);
  logFeishuFlow('start', {
    botId,
    externalId,
    receiveIdType,
    agentName,
    textPreview: text.slice(0, 120),
  });
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; appSecret: string } | null;
  if (!cfg?.appId || !cfg.appSecret) {
    console.error(`[Bridge/feishu] appId 或 appSecret 缺失，botId=${botId}`);
    return;
  }

  let token: string;
  try {
    token = await getFeishuToken(botId, cfg.appId, cfg.appSecret);
  } catch (e) {
    console.error(`[Bridge/feishu] 获取 token 失败:`, e);
    throw e;
  }

  const sendFeishuRequest = async (msgType: string, content: string) => {
    const body = JSON.stringify({ receive_id: externalId, msg_type: msgType, content });
    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    logFeishuFlow('request', {
      msgType,
      receiveIdType,
      externalId,
      bodyPreview: body.slice(0, 400),
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body,
    });
    const responseText = await res.text().catch(() => '');
    logFeishuFlow('response', {
      msgType,
      status: res.status,
      ok: res.ok,
      bodyPreview: responseText.slice(0, 400),
    });
    return new Response(responseText, {
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
    });
  };

  // 1. 先尝试发送 interactive card（支持 Markdown 渲染）
  const card = markdownToFeishuCard(agentName, text);
  const cardContent = JSON.stringify(card);
  const cardRes = await sendFeishuRequest('interactive', cardContent);

  if (cardRes.ok) {
    logFeishuFlow('interactive_success', { externalId, receiveIdType });
    return;
  }

  const cardErr = await cardRes.text().catch(() => '');
  console.warn(`[Bridge/feishu] 卡片发送失败 status=${cardRes.status}: ${cardErr.slice(0, 400)}，降级为文本消息`);
  logFeishuFlow('interactive_failed_fallback_text', {
    externalId,
    receiveIdType,
    status: cardRes.status,
    errorPreview: cardErr.slice(0, 400),
  });

  // 2. 降级：发送纯文本（兼容无 interactive card 权限的 P2P 私信场景）
  // 用 QQ 纯文本转换器剥离全部 MD 符号，避免飞书 text 消息把 **bold** 原样显示
  const plainText = `[${agentName}] ${markdownToQQPlainText(text).trim()}`;
  const textRes = await sendFeishuRequest('text', JSON.stringify({ text: plainText }));
  if (!textRes.ok) {
    const textErr = await textRes.text().catch(() => '');
    console.error(`[Bridge/feishu] 文本消息发送也失败 status=${textRes.status}: ${textErr.slice(0, 400)}`);
    throw new Error(`[Feishu] send failed: ${textRes.status} ${textErr.slice(0, 400)}`);
  }
  logFeishuFlow('text_fallback_success', { externalId, receiveIdType });
}

function normalizeFeishuMessageId(messageId?: string): string {
  return (messageId ?? '').trim().split(':')[0] ?? '';
}

async function feishuTyping(botId: string, _externalId: string, sourceMessageId?: string): Promise<void> {
  const messageId = normalizeFeishuMessageId(sourceMessageId);
  if (!messageId) return;

  const cacheKey = `${botId}:${messageId}`;
  if (feishuTypingReactions.has(cacheKey)) return;

  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; appSecret: string } | null;
  if (!cfg?.appId || !cfg.appSecret) return;
  const token = await getFeishuToken(botId, cfg.appId, cfg.appSecret);

  try {
    const feishuRes = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reaction_type: { emoji_type: FEISHU_TYPING_EMOJI_TYPE },
      }),
    });
    if (!feishuRes.ok) {
      const body = await feishuRes.text().catch(() => '');
      console.error(`[Bridge/feishu] typing reaction 添加失败 ${feishuRes.status}: ${body.slice(0, 200)}`);
      return;
    }
    const payload = await feishuRes.json().catch(() => null) as { data?: { reaction_id?: string } } | null;
    feishuTypingReactions.set(cacheKey, {
      messageId,
      reactionId: payload?.data?.reaction_id ?? null,
    });
  } catch (error) {
    console.error('[Bridge/feishu] typing reaction 添加失败:', error);
  }
}

async function clearFeishuTyping(botId: string, _externalId: string, sourceMessageId?: string): Promise<void> {
  const messageId = normalizeFeishuMessageId(sourceMessageId);
  if (!messageId) return;

  const cacheKey = `${botId}:${messageId}`;
  const state = feishuTypingReactions.get(cacheKey);
  if (!state) return;
  feishuTypingReactions.delete(cacheKey);
  if (!state.reactionId) return;

  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; appSecret: string } | null;
  if (!cfg?.appId || !cfg.appSecret) return;
  const token = await getFeishuToken(botId, cfg.appId, cfg.appSecret);

  try {
    const feishuRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(state.messageId)}/reactions/${encodeURIComponent(state.reactionId)}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      },
    );
    if (!feishuRes.ok) {
      const body = await feishuRes.text().catch(() => '');
      console.error(`[Bridge/feishu] typing reaction 删除失败 ${feishuRes.status}: ${body.slice(0, 200)}`);
    }
  } catch (error) {
    console.error('[Bridge/feishu] typing reaction 删除失败:', error);
  }
}

// ─── 钉钉 sender ───
async function getDingtalkToken(botId: string, appKey: string, appSecret: string): Promise<string> {
  const cacheKey = `dingtalk:${botId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[DingTalk] token fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { accessToken: string; expireIn: number };
  const safeExpiryDd = (typeof data.expireIn === 'number' && isFinite(data.expireIn) && data.expireIn > 0) ? data.expireIn - 60 : 60;
  setCachedToken(cacheKey, data.accessToken, safeExpiryDd);
  return data.accessToken;
}

async function dingtalkSend(botId: string, externalId: string, text: string, agentName: string): Promise<void> {
  const { body: bodyText, isRoomUserMessage } = parseGroupPrefix(text, agentName);
  const formatted = markdownToDingTalkMarkdown(bodyText);
  const icon = isRoomUserMessage ? '👤' : '🤖';
  if (externalId.startsWith(DINGTALK_SESSION_WEBHOOK_PREFIX)) {
    await sendViaSessionWebhook(externalId.slice(DINGTALK_SESSION_WEBHOOK_PREFIX.length), agentName, formatted, icon);
    return;
  }

  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appKey: string; appSecret: string } | null;
  if (!cfg?.appKey || !cfg.appSecret) return;
  const token = await getDingtalkToken(botId, cfg.appKey, cfg.appSecret);

  // robotCode 与 appKey (clientId) 相同，Stream 模式无需单独配置
  const ddRes = await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
    method: 'POST',
    headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: externalId,
      robotCode: cfg.appKey,
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title: `${icon} ${agentName}`, text: `# ${icon} ${agentName}\n\n${formatted}` }),
    }),
  });
  if (!ddRes.ok) {
    const body = await ddRes.text().catch(() => '');
    console.error(`[Bridge/dingtalk] 发送失败 ${ddRes.status}: ${body.slice(0, 200)}`);
    throw new Error(`[DingTalk] send failed: ${ddRes.status} ${body.slice(0, 200)}`);
  }
}

async function sendViaSessionWebhook(sessionWebhook: string, agentName: string, markdown: string, icon = '🤖'): Promise<void> {
  // SSRF 防护：仅允许 https 且 host 在白名单内
  let webhookUrl: URL;
  try {
    webhookUrl = new URL(sessionWebhook);
  } catch {
    throw new Error(`[DingTalk] invalid session webhook URL: ${sessionWebhook.slice(0, 100)}`);
  }
  if (webhookUrl.protocol !== 'https:') {
    throw new Error(`[DingTalk] session webhook must use HTTPS`);
  }
  if (!ALLOWED_WEBHOOK_HOSTS.includes(webhookUrl.hostname)) {
    throw new Error(`[DingTalk] session webhook host not allowed: ${webhookUrl.hostname}`);
  }

  const res = await fetch(sessionWebhook, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        title: `${icon} ${agentName}`,
        text: `# ${icon} ${agentName}\n\n${markdown}`,
      },
    }),
  });
  if (res.ok) return;

  const errBody = await res.text().catch(() => '');
  // 部分 session webhook 不支持 markdown msgtype，降级为纯文本
  if (errBody.includes('not support msgtype') || errBody.includes('400008')) {
    const fallback = await fetch(sessionWebhook, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: `[${agentName}] ${markdown}` } }),
    });
    if (!fallback.ok) {
      const fallbackBody = await fallback.text().catch(() => '');
      throw new Error(`[DingTalk] session webhook send failed: ${fallback.status} ${fallbackBody.slice(0, 200)}`);
    }
    return;
  }
  throw new Error(`[DingTalk] session webhook send failed: ${res.status} ${errBody.slice(0, 200)}`);
}

// ─── 企业微信 sender ───
async function getWecomToken(botId: string, corpId: string, agentSecret: string): Promise<string> {
  const cacheKey = `wecom:${botId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(agentSecret)}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[WeCom] token fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  const safeExpiryWc = (typeof data.expires_in === 'number' && isFinite(data.expires_in) && data.expires_in > 0) ? data.expires_in - 60 : 60;
  setCachedToken(cacheKey, data.access_token, safeExpiryWc);
  return data.access_token;
}

async function wecomSend(botId: string, externalId: string, text: string, agentName: string): Promise<void> {
  const { body: bodyText, isRoomUserMessage } = parseGroupPrefix(text, agentName);
  const icon = isRoomUserMessage ? '👤' : '🤖';
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { corpId: string; agentSecret: string } | null;
  if (!cfg?.corpId || !cfg.agentSecret) return;
  const token = await getWecomToken(botId, cfg.corpId, cfg.agentSecret);

  const wecomRes = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatid: externalId,
      msgtype: 'markdown',
      markdown: { content: `<font color="info">**${icon} ${agentName}**</font>\n\n${markdownToWecomMarkdown(bodyText)}` },
    }),
  });
  if (!wecomRes.ok) {
    const body = await wecomRes.text().catch(() => '');
    console.error(`[Bridge/wecom] 发送失败 ${wecomRes.status}: ${body.slice(0, 200)}`);
    throw new Error(`[WeCom] send failed: ${wecomRes.status} ${body.slice(0, 200)}`);
  }
}

// ─── QQ sender ───
async function getQQToken(botId: string, appId: string, clientSecret: string): Promise<string> {
  const cacheKey = `qq:${botId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[QQ] token fetch failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { access_token: string; expires_in: string };
  const parsedExpiry = parseInt(data.expires_in, 10);
  const safeExpiryQq = (isFinite(parsedExpiry) && parsedExpiry > 0) ? parsedExpiry - 60 : 60;
  setCachedToken(cacheKey, data.access_token, safeExpiryQq);
  return data.access_token;
}

async function qqSend(botId: string, externalId: string, text: string, agentName: string): Promise<void> {
  const { body: bodyText, isRoomUserMessage } = parseGroupPrefix(text, agentName);
  const icon = isRoomUserMessage ? '👤' : '🤖';
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; clientSecret: string } | null;
  if (!cfg?.appId || !cfg.clientSecret) return;
  const token = await getQQToken(botId, cfg.appId, cfg.clientSecret);

  const qqRes = await fetch(`https://api.sgroup.qq.com/v2/groups/${externalId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `QQBot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 0, content: `[${icon} ${agentName}] ${markdownToQQPlainText(bodyText)}` }),
  });
  if (!qqRes.ok) {
    const body = await qqRes.text().catch(() => '');
    console.error(`[Bridge/qq] 发送失败 ${qqRes.status}: ${body.slice(0, 200)}`);
    throw new Error(`[QQ] send failed: ${qqRes.status} ${body.slice(0, 200)}`);
  }
}

export const BRIDGE_PLATFORM_ADAPTERS: BridgePlatformAdapter[] = [
  { platform: 'telegram', sendMessage: telegramSend, sendTyping: telegramTyping },
  { platform: 'feishu', sendMessage: feishuSend, sendTyping: feishuTyping, clearTyping: clearFeishuTyping },
  { platform: 'dingtalk', sendMessage: dingtalkSend },
  { platform: 'wecom', sendMessage: wecomSend },
  { platform: 'qq', sendMessage: qqSend },
];

export function registerBridgePlatformAdapters(
  service: Pick<typeof bridgeService, 'registerSender' | 'registerTypingSender' | 'registerTypingClearer'> = bridgeService,
): void {
  for (const adapter of BRIDGE_PLATFORM_ADAPTERS) {
    service.registerSender(adapter.platform, adapter.sendMessage);
    if (adapter.sendTyping) {
      service.registerTypingSender(adapter.platform, adapter.sendTyping);
    }
    if (adapter.clearTyping) {
      service.registerTypingClearer(adapter.platform, adapter.clearTyping);
    }
  }
}

// Backward-compatible exports during transition
export const registerAllPlatformSenders = registerBridgePlatformAdapters;
export const markdownToTelegramHtml = markdownToTelegramMarkdownV2;
