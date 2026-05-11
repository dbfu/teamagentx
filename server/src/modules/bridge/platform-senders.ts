import prisma from '../../lib/prisma.js';
import { bridgeService } from './bridge.service.js';
import { decrypt } from './crypto.js';

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
  setCachedToken(cacheKey, data.tenant_access_token, data.expire - 60);
  return data.tenant_access_token;
}

async function feishuSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'feishu', externalId, enabled: true },
  });
  if (!channel?.config) return;

  const cfg = JSON.parse(decrypt(channel.config)) as { appId: string; appSecret: string };
  const token = await getFeishuToken(cfg.appId, cfg.appSecret);

  await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      receive_id: externalId,
      msg_type: 'text',
      content: JSON.stringify({ text: `[${agentName}] ${text}` }),
    }),
  });
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
  setCachedToken(cacheKey, data.accessToken, data.expireIn - 60);
  return data.accessToken;
}

async function dingtalkSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'dingtalk', externalId, enabled: true },
  });
  if (!channel?.config) return;

  const cfg = JSON.parse(decrypt(channel.config)) as { appKey: string; appSecret: string; robotCode?: string };
  const token = await getDingtalkToken(cfg.appKey, cfg.appSecret);

  await fetch('https://api.dingtalk.com/v1.0/robot/groupMessages/send', {
    method: 'POST',
    headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: externalId,
      robotCode: cfg.robotCode ?? '',
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: `[${agentName}] ${text}` }),
    }),
  });
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
  setCachedToken(cacheKey, data.access_token, data.expires_in - 60);
  return data.access_token;
}

async function wecomSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'wecom', externalId, enabled: true },
  });
  if (!channel?.config) return;

  const cfg = JSON.parse(decrypt(channel.config)) as { corpId: string; agentSecret: string };
  const token = await getWecomToken(cfg.corpId, cfg.agentSecret);

  await fetch(`https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatid: externalId,
      msgtype: 'text',
      text: { content: `[${agentName}] ${text}` },
    }),
  });
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
  const expiry = parseInt(data.expires_in, 10) || 7200;
  setCachedToken(cacheKey, data.access_token, expiry - 60);
  return data.access_token;
}

async function qqSend(externalId: string, text: string, agentName: string): Promise<void> {
  const channel = await prisma.externalChannel.findFirst({
    where: { platform: 'qq', externalId, enabled: true },
  });
  if (!channel?.config) return;

  const cfg = JSON.parse(decrypt(channel.config)) as { appId: string; clientSecret: string };
  const token = await getQQToken(cfg.appId, cfg.clientSecret);

  await fetch(`https://api.sgroup.qq.com/v2/groups/${externalId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `QQBot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 0, content: `[${agentName}] ${text}` }),
  });
}

// Register all senders
export function registerAllPlatformSenders(): void {
  bridgeService.registerSender('feishu', feishuSend);
  bridgeService.registerSender('dingtalk', dingtalkSend);
  bridgeService.registerSender('wecom', wecomSend);
  bridgeService.registerSender('qq', qqSend);
}
