import { createHmac, createHash } from 'crypto';
import { decrypt } from './crypto.js';

// Returns true if verification passes or if webhookSecret is not set (dev mode)
// TODO: 当 BRIDGE_BASE_URL 配置后，应通过 x-telegram-bot-api-secret-token header 校验
export async function verifyTelegram(headers: Record<string, string | string[] | undefined>, secret?: string | null): Promise<boolean> {
  if (!secret) return true; // no secret configured → allow all (dev)
  const headerSecret = headers['x-telegram-bot-api-secret-token'];
  return headerSecret === decrypt(secret);
}

export function verifyDingtalk(query: Record<string, string>, webhookSecret?: string | null): boolean {
  if (!webhookSecret) return true;
  // 钉钉签名: Base64(HMAC-SHA256(timestamp + '\n' + secret, secret))
  const { timestamp, sign } = query;
  if (!timestamp || !sign) return false;
  const secret = decrypt(webhookSecret);
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}\n${secret}`)
    .digest('base64');
  return expected === decodeURIComponent(sign);
}

// 企业微信签名验证
// 签名校验依赖 webhookSecret（来自 channel 级配置），全局 token 在 gateway 中通过 parseStoredBridgeConfig 提供
export function verifyWecom(query: Record<string, string>, webhookSecret?: string | null): boolean {
  if (!webhookSecret) return true;
  // 企微: sort([token, timestamp, nonce]) → SHA1
  const { msg_signature, timestamp, nonce } = query;
  if (!msg_signature || !timestamp || !nonce) return false;
  const token = decrypt(webhookSecret);
  const str = [token, timestamp, nonce].sort().join('');
  const expected = createHash('sha1').update(str).digest('hex');
  return expected === msg_signature;
}
