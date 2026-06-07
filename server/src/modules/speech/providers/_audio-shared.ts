/**
 * 音频 Provider 共享工具函数
 * 
 * #45/#46: 减少 TTS 和 STT provider 之间的代码重复。
 * validateRemoteUrl、provider 解析逻辑、endpoint 构建都集中于此。
 *
 * 注意：vendorOptions.llmProviderId 是 @internal 协议，
 * 仅用于前端明确绑定的 provider ID，不对外文档化。
 */

import type { LlmProvider } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { SpeechTask } from '../domain/types.js';

/**
 * 历史 provider ID 映射（归一化）
 * #46: 集中维护，TTS/STT provider 均从此处 import
 */
export const PROVIDER_ID_MAP: Record<string, string> = {
  'remote-tts': 'openai-compatible-tts',
  'edge-tts': 'browser-local',
};

/**
 * 判断 hostname 是否为私有/保留地址
 */
export function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return true;

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  const ipv6Raw = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (ipv6Raw.includes(':')) {
    if (ipv6Raw === '::1' || ipv6Raw === '0:0:0:0:0:0:0:1') return true;
    if (ipv6Raw.startsWith('fc') || ipv6Raw.startsWith('fd')) return true;
    if (ipv6Raw.startsWith('fec') || ipv6Raw.startsWith('fed') || ipv6Raw.startsWith('fee') || ipv6Raw.startsWith('fef')) return true;
    if (ipv6Raw.startsWith('fe8') || ipv6Raw.startsWith('fe9') || ipv6Raw.startsWith('fea') || ipv6Raw.startsWith('feb')) return true;
    if (ipv6Raw.startsWith('::ffff:')) {
      const v4Part = ipv6Raw.slice(7);
      if (isPrivateOrReservedHost(v4Part)) return true;
    }
  }

  return false;
}

/**
 * 校验远程语音服务 URL 合法性（防 SSRF）
 * - https 协议：禁止直连 IP（防 DNS rebinding），禁止内网地址
 * - http 协议：仅非生产环境允许 localhost
 */
export function validateRemoteUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('远程语音服务地址无效');
  }
  const protocol = parsed.protocol;
  const hostname = parsed.hostname.toLowerCase();

  if (protocol === 'https:') {
    const isRawIpv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
    const isRawIpv6 = hostname.includes(':') || (hostname.startsWith('[') && hostname.endsWith(']'));
    if (isRawIpv4 || isRawIpv6) {
      throw new Error('远程语音服务地址不允许直连 IP，请使用域名');
    }
    if (isPrivateOrReservedHost(hostname)) {
      throw new Error('远程语音服务地址不允许指向内网');
    }
    return;
  }
  if (protocol === 'http:') {
    if (hostname === 'localhost' && process.env.NODE_ENV !== 'production') return;
    throw new Error('远程语音服务地址必须使用 https');
  }
  throw new Error('远程语音服务地址协议不被支持');
}

/**
 * 构建语音 API endpoint URL
 * #49: apiUrl 为空时抛错，不 fallback 到 OpenAI
 */
export function buildSpeechEndpoint(apiUrl: string | null | undefined, suffix: string): string {
  if (!apiUrl?.trim()) throw new Error('语音服务地址未配置');
  const base = apiUrl.replace(/\/+$/, '');
  if (base.toLowerCase().endsWith(suffix.toLowerCase())) return base;
  return `${base}${suffix}`;
}

/**
 * 从 SpeechTask 解析可用的 LlmProvider（TTS 用途）
 * #6: 优先从 agentId 对应 agent 读取，再查 vendorOptions.llmProviderId，最后用系统默认
 */
export async function resolveAudioProvider(
  task: SpeechTask,
  kind: 'tts' | 'stt',
): Promise<LlmProvider> {
  // 优先从 agentId 对应 agent 配置读取
  if (task.context?.agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: task.context.agentId },
      include: { llmProvider: true },
    });
    const llmProvider = (agent as { llmProvider?: LlmProvider | null } | null)?.llmProvider;
    if (llmProvider?.isActive && llmProvider.apiProtocol === 'openai') return llmProvider;
  }

  // vendorOptions.llmProviderId 是 @internal 协议，仅用于前端明确绑定的 provider ID
  const explicitProviderId = typeof task.profile?.vendorOptions?.llmProviderId === 'string'
    ? task.profile.vendorOptions.llmProviderId
    : null;

  if (explicitProviderId) {
    const provider = await prisma.llmProvider.findUnique({ where: { id: explicitProviderId } });
    if (provider?.isActive) return provider;
  }

  const audioUsageFilter = kind === 'tts' ? ['tts', 'both'] : ['stt', 'both'];
  const audioProvider = await prisma.llmProvider.findFirst({
    where: { isActive: true, isDefault: true, modelType: 'audio', audioUsage: { in: audioUsageFilter } },
  });
  if (audioProvider) return audioProvider;

  const kindLabel = kind === 'tts' ? 'TTS' : 'STT';
  throw new Error(`未找到可用的语音（${kindLabel}）供应商，请在模型管理中添加语音类型模型并设为默认`);
}
