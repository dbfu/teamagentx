import prisma from '../../lib/prisma.js';
import { bridgeService } from './bridge.service.js';
import { decrypt } from './crypto.js';
import { parseStoredBridgeConfig, resolveStoredBridgeBotToken } from './bridge-platform-config.js';

type Platform = 'telegram' | 'feishu' | 'dingtalk' | 'wecom' | 'qq';
type SenderFn = (externalId: string, text: string, agentName: string) => Promise<void>;

export interface BridgePlatformAdapter {
  platform: Platform;
  sendMessage: SenderFn;
}

// Simple in-memory access token cache: key → { token, expiresAt }
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

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

/**
 * 将 Markdown 文本转为 Telegram HTML (parse_mode=HTML)。
 * 先提取代码块/行内代码占位，再处理其他 markdown，最后还原。
 */
function markdownToTelegramHtml(md: string): string {
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
async function telegramSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'telegram', externalId, enabled: true },
  });
  if (!channel) return;

  const botToken = resolveStoredBridgeBotToken(channel);
  if (!botToken) return;

  // <blockquote> 渲染为带色竖线的引用块，视觉上最突出
  const header = `<blockquote>🤖 <b>${escapeHtml(agentName)}</b></blockquote>`;
  const body = markdownToTelegramHtml(text);
  const full = header + '\n' + body;
  const chunks = splitTelegramHtml(full);

  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: externalId, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      // Telegram HTML 解析失败时降级为纯文本
      if (res.status === 400 && errBody.includes("can't parse entities")) {
        const fallback = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: externalId, text: `[${agentName}] ${text}`.slice(0, 4096) }),
        });
        if (!fallback.ok) {
          console.error(`[Bridge/telegram] 降级发送失败 ${fallback.status}`);
        }
      } else {
        console.error(`[Bridge/telegram] 发送失败 ${res.status}: ${errBody.slice(0, 200)}`);
      }
    }
  }
}

// ─── 飞书 Post 富文本转换 ───
// 将 Markdown 转为飞书 post content 格式的 content 段落数组
type FeishuPostElement =
  | { tag: 'text'; text: string; bold?: boolean; un_escape?: boolean }
  | { tag: 'a'; text: string; href: string }
  | { tag: 'code_block'; language?: string; text: string }

function markdownToFeishuPost(agentName: string, md: string): { title: string; content: FeishuPostElement[][] } {
  const paragraphs: FeishuPostElement[][] = [];

  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || 'plain_text';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      paragraphs.push([{ tag: 'code_block', language: lang, text: codeLines.join('\n') }]);
      i++;
      continue;
    }

    // 空行 / 分割线 → 跳过
    if (line.trim() === '' || /^[-*_]{3,}$/.test(line.trim())) {
      i++;
      continue;
    }

    // 列表行：`- ` / `* ` / `+ ` → 前缀替换为 •
    const listMatch = line.match(/^\s*[-*+]\s+(.*)/);
    const textLine = listMatch ? `• ${listMatch[1]}` : line;

    const els = parseFeishuInline(textLine);
    if (els.length > 0) paragraphs.push(els);
    i++;
  }

  // title 已展示助手名，content 不重复
  return { title: `🤖 ${agentName}`, content: paragraphs };
}

function parseFeishuInline(line: string): FeishuPostElement[] {
  const els: FeishuPostElement[] = [];

  // 标题行去掉 # 前缀，标题文字加粗
  const isHeading = /^#{1,5}\s+/.test(line);
  const text = line.replace(/^#{1,5}\s+/, '');

  // 匹配：**bold** | [link](url) | `code`
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) {
      const plain = text.slice(last, m.index);
      if (plain) els.push({ tag: 'text', text: plain, ...(isHeading ? { bold: true } : {}) });
    }
    if (m[1] !== undefined) {
      // **bold**
      els.push({ tag: 'text', text: m[1], bold: true });
    } else if (m[2] !== undefined) {
      // [link](url)
      els.push({ tag: 'a', text: m[2], href: m[3] });
    } else {
      // `code` → 飞书 post 无行内代码 tag，直接显示文字
      els.push({ tag: 'text', text: m[4] });
    }
    last = m.index + m[0].length;
  }

  if (last < text.length) {
    const tail = text.slice(last);
    if (tail) els.push({ tag: 'text', text: tail, ...(isHeading ? { bold: true } : {}) });
  }

  return els;
}

// ─── 飞书 sender ───
async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = `feishu:${appId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { tenant_access_token: string; expire: number };
  const safeExpiry = (typeof data.expire === 'number' && isFinite(data.expire) && data.expire > 0) ? data.expire - 60 : 60;
  setCachedToken(cacheKey, data.tenant_access_token, safeExpiry);
  return data.tenant_access_token;
}

async function feishuSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'feishu', externalId, enabled: true },
  });

  let configJson: string | null = channel?.config ?? null;
  if (!configJson) {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'feishu' } });
    configJson = platformCfg?.config ?? null;
  }
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; appSecret: string } | null;
  if (!cfg?.appId || !cfg.appSecret) return;
  const token = await getFeishuToken(cfg.appId, cfg.appSecret);

  const feishuRes = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: externalId,
      msg_type: 'post',
      content: JSON.stringify({ zh_cn: markdownToFeishuPost(agentName, text) }),
    }),
  });
  if (!feishuRes.ok) {
    const body = await feishuRes.text().catch(() => '');
    console.error(`[Bridge/feishu] 发送失败 ${feishuRes.status}: ${body.slice(0, 200)}`);
  }
}

// ─── 钉钉 sender ───
async function getDingtalkToken(appKey: string, appSecret: string): Promise<string> {
  const cacheKey = `dingtalk:${appKey}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = await res.json() as { accessToken: string; expireIn: number };
  const safeExpiryDd = (typeof data.expireIn === 'number' && isFinite(data.expireIn) && data.expireIn > 0) ? data.expireIn - 60 : 60;
  setCachedToken(cacheKey, data.accessToken, safeExpiryDd);
  return data.accessToken;
}

async function dingtalkSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'dingtalk', externalId, enabled: true },
  });

  let configJson: string | null = channel?.config ?? null;
  if (!configJson) {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'dingtalk' } });
    configJson = platformCfg?.config ?? null;
  }
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appKey: string; appSecret: string } | null;
  if (!cfg?.appKey || !cfg.appSecret) return;
  const token = await getDingtalkToken(cfg.appKey, cfg.appSecret);

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
  }
}

// ─── 企业微信 sender ───
async function getWecomToken(corpId: string, agentSecret: string): Promise<string> {
  const cacheKey = `wecom:${corpId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${agentSecret}`,
  );
  const data = await res.json() as { access_token: string; expires_in: number };
  const safeExpiryWc = (typeof data.expires_in === 'number' && isFinite(data.expires_in) && data.expires_in > 0) ? data.expires_in - 60 : 60;
  setCachedToken(cacheKey, data.access_token, safeExpiryWc);
  return data.access_token;
}

async function wecomSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'wecom', externalId, enabled: true },
  });

  let configJson: string | null = channel?.config ?? null;
  if (!configJson) {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'wecom' } });
    configJson = platformCfg?.config ?? null;
  }
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { corpId: string; agentSecret: string } | null;
  if (!cfg?.corpId || !cfg.agentSecret) return;
  const token = await getWecomToken(cfg.corpId, cfg.agentSecret);

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
  }
}

// ─── QQ sender ───
async function getQQToken(appId: string, clientSecret: string): Promise<string> {
  const cacheKey = `qq:${appId}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return cached;

  const res = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret }),
  });
  const data = await res.json() as { access_token: string; expires_in: string };
  const parsedExpiry = parseInt(data.expires_in, 10);
  const safeExpiryQq = (isFinite(parsedExpiry) && parsedExpiry > 0) ? parsedExpiry - 60 : 60;
  setCachedToken(cacheKey, data.access_token, safeExpiryQq);
  return data.access_token;
}

async function qqSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'qq', externalId, enabled: true },
  });

  let configJson: string | null = channel?.config ?? null;
  if (!configJson) {
    const platformCfg = await prisma.platformConfig.findUnique({ where: { platform: 'qq' } });
    configJson = platformCfg?.config ?? null;
  }
  if (!configJson) return;

  const cfg = parseStoredBridgeConfig({ config: configJson }) as { appId: string; clientSecret: string } | null;
  if (!cfg?.appId || !cfg.clientSecret) return;
  const token = await getQQToken(cfg.appId, cfg.clientSecret);

  const qqRes = await fetch(`https://api.sgroup.qq.com/v2/groups/${externalId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `QQBot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 0, content: `[${agentName}] ${text}` }),
  });
  if (!qqRes.ok) {
    const body = await qqRes.text().catch(() => '');
    console.error(`[Bridge/qq] 发送失败 ${qqRes.status}: ${body.slice(0, 200)}`);
  }
}

export const BRIDGE_PLATFORM_ADAPTERS: BridgePlatformAdapter[] = [
  { platform: 'telegram', sendMessage: telegramSend },
  { platform: 'feishu', sendMessage: feishuSend },
  { platform: 'dingtalk', sendMessage: dingtalkSend },
  { platform: 'wecom', sendMessage: wecomSend },
  { platform: 'qq', sendMessage: qqSend },
];

export function registerBridgePlatformAdapters(
  service: Pick<typeof bridgeService, 'registerSender'> = bridgeService,
): void {
  for (const adapter of BRIDGE_PLATFORM_ADAPTERS) {
    service.registerSender(adapter.platform, adapter.sendMessage);
  }
}

// Backward-compatible export during transition
export const registerAllPlatformSenders = registerBridgePlatformAdapters;
