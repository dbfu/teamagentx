import { randomBytes } from 'crypto';
import type { Platform } from './bridge.service.js';

type BridgeBindCodeRecord = {
  platform: Platform;
  chatRoomId: string;
  expiresAt: number;
};

const bindCodes = new Map<string, BridgeBindCodeRecord>();

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

export function consumeBridgeBindCode(
  platform: Platform,
  code: string,
): { platform: Platform; chatRoomId: string } | null {
  cleanExpiredBridgeBindCodes();
  const normalizedCode = code.trim().toUpperCase();
  const record = bindCodes.get(normalizedCode);
  if (!record) return null;
  if (record.platform !== platform) return null;
  bindCodes.delete(normalizedCode);
  return { platform: record.platform, chatRoomId: record.chatRoomId };
}

export function clearBridgeBindCodesForTest(): void {
  bindCodes.clear();
}
