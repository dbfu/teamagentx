import { randomBytes } from 'crypto';
import type { Platform } from './bridge.service.js';

type BridgeBindCodeRecord = {
  platform: Platform;
  botId?: string;
  chatRoomId: string;
  expiresAt: number;
};

const bindCodes = new Map<string, BridgeBindCodeRecord>();

// Rate limit: max 5 code generation attempts per minute per botId
type RateLimitEntry = { count: number; resetAt: number };
const botBindRateLimits = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

function cleanExpiredBridgeBindCodes() {
  const now = Date.now();
  for (const [code, record] of bindCodes) {
    if (now > record.expiresAt) {
      bindCodes.delete(code);
    }
  }
}

function generateBindCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

export function createBridgeBindCode(
  platform: Platform,
  chatRoomId: string,
  expiresInSeconds = 15 * 60,
): { code: string; expiresIn: number } {
  cleanExpiredBridgeBindCodes();

  let code = generateBindCode();
  while (bindCodes.has(code)) {
    code = generateBindCode();
  }

  bindCodes.set(code, {
    platform,
    chatRoomId,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });

  return { code, expiresIn: expiresInSeconds };
}

export function createBridgeBotBindCode(
  platform: Platform,
  botId: string,
  chatRoomId: string,
  expiresInSeconds = 15 * 60,
): { code: string; expiresIn: number } {
  cleanExpiredBridgeBindCodes();

  // Per-botId rate limiting: max 5 attempts per minute
  const now = Date.now();
  const rateEntry = botBindRateLimits.get(botId);
  if (rateEntry && now < rateEntry.resetAt) {
    if (rateEntry.count >= RATE_LIMIT_MAX) {
      throw new Error(`生成绑定码过于频繁，请 ${Math.ceil((rateEntry.resetAt - now) / 1000)} 秒后再试`);
    }
    rateEntry.count += 1;
  } else {
    botBindRateLimits.set(botId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }

  let code = generateBindCode();
  while (bindCodes.has(code)) {
    code = generateBindCode();
  }

  bindCodes.set(code, {
    platform,
    botId,
    chatRoomId,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });

  return { code, expiresIn: expiresInSeconds };
}

export function consumeBridgeBindCode(
  platform: Platform,
  code: string,
): { platform: Platform; botId?: string; chatRoomId: string } | null {
  cleanExpiredBridgeBindCodes();
  const normalizedCode = code.trim().toUpperCase();
  const record = bindCodes.get(normalizedCode);
  if (!record) return null;
  if (record.platform !== platform) return null;
  bindCodes.delete(normalizedCode);
  return { platform: record.platform, botId: record.botId, chatRoomId: record.chatRoomId };
}

export function peekBridgeBindCode(
  platform: Platform,
  code: string,
): { platform: Platform; botId?: string; chatRoomId: string } | null {
  cleanExpiredBridgeBindCodes();
  const normalizedCode = code.trim().toUpperCase();
  const record = bindCodes.get(normalizedCode);
  if (!record) return null;
  if (record.platform !== platform) return null;
  return { platform: record.platform, botId: record.botId, chatRoomId: record.chatRoomId };
}

export function clearBridgeBindCodesForTest(): void {
  bindCodes.clear();
}
