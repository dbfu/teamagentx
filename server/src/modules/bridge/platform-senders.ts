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

// ─── Telegram：Markdown → HTML 转换 ───

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 将 Markdown 文本转为 Telegram HTML (parse_mode=HTML)。
 * 先提取代码块/行内代码占位，再处理其他 markdown，最后还原。
 */
export function markdownToTelegramHtml(md: string): string {
  const saved: string[] = [];
  const PLACEHOLDER = '\x01';

  // 1. 提取围栏代码块（```lang\ncode\n```）
  let out = md.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_, lang, code: string) => {
    const trimmed = code.replace(/\n$/, '');
    const langAttr = lang.trim() ? ` class="language-${escapeHtml(lang.trim())}"` : '';
    saved.push(`<pre><code${langAttr}>${escapeHtml(trimmed)}</code></pre>`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 2. 提取行内代码
  out = out.replace(/`([^`\n]+)`/g, (_, code: string) => {
    saved.push(`<code>${escapeHtml(code)}</code>`);
    return `${PLACEHOLDER}${saved.length - 1}${PLACEHOLDER}`;
  });

  // 3. 对剩余文本做 HTML 转义（按占位符切分）
  out = out
    .split(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`))
    .map((seg, i) => (i % 2 === 0 ? escapeHtml(seg) : `${PLACEHOLDER}${seg}${PLACEHOLDER}`))
    .join('');

  // 4. Markdown 语法 → HTML 标签
  // 粗体 **text** 或 __text__
  out = out.replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/__([\s\S]+?)__/g, '<b>$1</b>');
  // 斜体 *text* 或 _text_（排除已处理的 ** / __）
  out = out.replace(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
  out = out.replace(/(?<!_)_(?!_)([\s\S]+?)(?<!_)_(?!_)/g, '<i>$1</i>');
  // 删除线 ~~text~~
  out = out.replace(/~~([\s\S]+?)~~/g, '<s>$1</s>');
  // 链接 [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  // 标题 # ~ ##### → 加粗
  out = out.replace(/^#{1,5}\s+(.+)$/gm, '<b>$1</b>');
  // 列表行 `- item` / `* item` / `+ item` → `• item`
  out = out.replace(/^[ \t]*[-*+] (.+)$/gm, '• $1');
  // 有序列表 `1. item` → `1. item`（保持编号，Telegram 不支持 <ol>）
  // 分割线（独立一行的 --- / *** 等）→ 横线字符
  out = out.replace(/^[-*_]{3,}$/gm, '──────────');

  // 5. 还原占位符
  out = out.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_, idx) => saved[parseInt(idx)]);

  return out;
}

// Telegram HTML 分段时不能从 HTML 标签中间截断，取保守 3800 字符
function splitTelegramHtml(html: string, maxLen = 3800): string[] {
  if (html.length <= maxLen) return [html];
  const chunks: string[] = [];
  let remaining = html;
  while (remaining.length > maxLen) {
    // 在 maxLen 前找最后一个换行符切分
    let cut = remaining.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = maxLen;
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

  // <blockquote> 渲染为带色竖线的引用块，视觉上最突出
  const header = `<blockquote>🤖 <b>${escapeHtml(agentName)}</b></blockquote>`;
  const body = markdownToTelegramHtml(text);
  const full = header + '\n' + body;
  const chunks = splitTelegramHtml(full);
  const chatId = externalId;

  for (const chunk of chunks) {
    const chatKey = `${botToken}:${chatId}`;
    const prev = sendQueues.get(chatKey) ?? Promise.resolve();
    const next = prev.then(async () => {
      const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        // Telegram HTML 解析失败时降级为纯文本
        if (res.status === 400 && errBody.includes("can't parse entities")) {
          const fallback = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: `[${agentName}] ${text}`.slice(0, 4096) }),
          });
          if (!fallback.ok) {
            const fallbackBody = await fallback.text().catch(() => '');
            console.error(`[Bridge/telegram] 降级发送失败 ${fallback.status}`);
            throw new Error(`[Telegram] send failed: ${fallback.status} ${fallbackBody.slice(0, 200)}`);
          }
          // 降级成功后跳出循环（通过 signal 机制：抛一个特殊标记）
          throw new TelegramFallbackSent();
        } else {
          console.error(`[Bridge/telegram] 发送失败 ${res.status}: ${errBody.slice(0, 200)}`);
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

  await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: externalId, action: 'typing' }),
  }).catch((error) => {
    console.error('[Bridge/telegram] typing 发送失败:', error);
  });
}

function escapeFeishuMdInline(text: string): string {
  return escapeHtml(text).replace(/([\\*_`~[\]()])/g, '\\$1');
}

export function markdownToFeishuCard(agentName: string, md: string): Record<string, unknown> {
  const isRoomUserMessage = md.startsWith(`[群聊·${agentName}]`);
  const body = isRoomUserMessage
    ? md.replace(new RegExp(`^\\[群聊·${escapeRegExp(agentName)}\\]\\s*`), '')
    : md;
  const header = isRoomUserMessage
    ? `<font color='green'>**${escapeFeishuMdInline(agentName)}**</font> 消息`
    : `🤖 <font color='blue'>**${escapeFeishuMdInline(agentName)}**</font> 消息`;

  return {
    config: { wide_screen_mode: true },
    elements: [
      {
        tag: 'markdown',
        content: `${header}\n\n${body}`,
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
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; appSecret: string } | null;
  if (!cfg?.appId || !cfg.appSecret) return;
  const token = await getFeishuToken(botId, cfg.appId, cfg.appSecret);

  const feishuRes = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: externalId,
      msg_type: 'interactive',
      content: JSON.stringify(markdownToFeishuCard(agentName, text)),
    }),
  });
  if (!feishuRes.ok) {
    const body = await feishuRes.text().catch(() => '');
    console.error(`[Bridge/feishu] 发送失败 ${feishuRes.status}: ${body.slice(0, 200)}`);
    throw new Error(`[Feishu] send failed: ${feishuRes.status} ${body.slice(0, 200)}`);
  }
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
  if (externalId.startsWith(DINGTALK_SESSION_WEBHOOK_PREFIX)) {
    await sendViaSessionWebhook(externalId.slice(DINGTALK_SESSION_WEBHOOK_PREFIX.length), `[${agentName}] ${text}`);
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
      msgParam: JSON.stringify({ title: `🤖 ${agentName}`, text: `> ### 🤖 ${agentName}\n\n${text}` }),
    }),
  });
  if (!ddRes.ok) {
    const body = await ddRes.text().catch(() => '');
    console.error(`[Bridge/dingtalk] 发送失败 ${ddRes.status}: ${body.slice(0, 200)}`);
    throw new Error(`[DingTalk] send failed: ${ddRes.status} ${body.slice(0, 200)}`);
  }
}

async function sendViaSessionWebhook(sessionWebhook: string, text: string): Promise<void> {
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[DingTalk] session webhook send failed: ${res.status} ${body.slice(0, 200)}`);
  }
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
      markdown: { content: `<font color="info">**🤖 ${agentName}**</font>\n\n${text}` },
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
  const bridgeBot = await prisma.bridgeBot.findUnique({ where: { id: botId } });
  const configJson = bridgeBot?.config ?? null;
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; clientSecret: string } | null;
  if (!cfg?.appId || !cfg.clientSecret) return;
  const token = await getQQToken(botId, cfg.appId, cfg.clientSecret);

  const qqRes = await fetch(`https://api.sgroup.qq.com/v2/groups/${externalId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `QQBot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 0, content: `[${agentName}] ${text}` }),
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

// Backward-compatible export during transition
export const registerAllPlatformSenders = registerBridgePlatformAdapters;
