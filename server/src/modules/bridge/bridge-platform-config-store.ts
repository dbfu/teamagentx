import prisma from '../../lib/prisma.js';
import { encrypt } from './crypto.js';
import type { Platform } from './bridge.service.js';

export interface BridgePlatformConfigPayload {
  botToken?: string;
  defaultAgentId?: string | null;
  config?: Record<string, unknown>;
}

export async function getBridgePlatformConfig(platform: Platform) {
  return prisma.platformConfig.findUnique({
    where: { platform },
    include: { defaultAgent: { select: { id: true, name: true } } },
  });
}

/**
 * 只检查记录是否存在且有 botToken 或 config 字段。
 * 注意：此函数不验证解密是否成功，在 key 轮换后可能返回 true 但实际解密失败。
 */
export async function hasBridgePlatformCredentials(platform: Platform): Promise<boolean> {
  const cfg = await prisma.platformConfig.findUnique({
    where: { platform },
    select: { botToken: true, config: true },
  });
  return Boolean(cfg?.botToken || cfg?.config);
}

export async function saveBridgePlatformConfig(
  platform: Platform,
  body: BridgePlatformConfigPayload,
) {
  const now = new Date();
  const data: Record<string, unknown> = { updatedAt: now };
  const configPayload = body.config ? { ...body.config } : undefined;
  const tokenFromConfig = typeof configPayload?.botToken === 'string' ? configPayload.botToken : undefined;

  if (body.botToken !== undefined) {
    data.botToken = body.botToken ? encrypt(body.botToken) : null;
  } else if (tokenFromConfig !== undefined) {
    data.botToken = tokenFromConfig ? encrypt(tokenFromConfig) : null;
  }

  // 只有明确传入 body.config 时才更新 config 字段，避免 botToken 更新时覆盖已有的 config
  if (body.config !== undefined) {
    data.config = body.config ? encrypt(JSON.stringify(body.config)) : null;
  }

  if ('defaultAgentId' in body) {
    data.defaultAgentId = body.defaultAgentId || null;
  }

  return prisma.platformConfig.upsert({
    where: { platform },
    create: { platform, ...data, createdAt: now },
    update: data,
    include: { defaultAgent: { select: { id: true, name: true } } },
  });
}

export function maskBridgePlatformConfig<T extends { botToken?: string | null; config?: string | null }>(cfg: T) {
  return {
    ...cfg,
    botToken: cfg.botToken ? '••••••••' : '',
    config: null,
    hasConfig: !!cfg.config,
  };
}
