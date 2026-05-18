import type { Agent, LlmProvider } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { SpeechProvider } from '../domain/provider.js';
import type { SpeechArtifact, SpeechTask } from '../domain/types.js';

type RemoteTtsDependencies = {
  resolveLlmProvider?: (task: SpeechTask<{ text: string }>) => Promise<LlmProvider>;
  providerId?: string;
};

const SILICONFLOW_COSYVOICE2_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';
const SILICONFLOW_COSYVOICE2_DEFAULT_VOICE = `${SILICONFLOW_COSYVOICE2_MODEL}:anna`;

const VENDOR_OPTION_WHITELIST = new Set([
  'speed',
  'pitch',
  'volume',
  'style',
  'role',
  'styledegree',
]);

function getSpeechEndpoint(apiUrl?: string | null): string {
  if (!apiUrl?.trim()) throw new Error('语音服务地址未配置');
  const trimmed = apiUrl.replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith('/audio/speech')) return trimmed;
  return `${trimmed}/audio/speech`;
}

function isPrivateOrReservedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === '0.0.0.0' || host === '::' || host === '[::]') return true;

  // IPv4
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    if (a === 127) return true; // 127.0.0.0/8 回环
    if (a === 10) return true; // 10.0.0.0/8 私有
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 链路本地
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 私有
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 私有
    if (a === 0) return true; // 0.0.0.0/8 本网络
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  }

  // IPv6（可能是 [::1] 或 [fc00::1] 格式）
  const ipv6Raw = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (ipv6Raw.includes(':')) {
    // ::1 回环
    if (ipv6Raw === '::1' || ipv6Raw === '0:0:0:0:0:0:0:1') return true;
    // fc00::/7 唯一本地地址（私有）
    if (ipv6Raw.startsWith('fc') || ipv6Raw.startsWith('fd')) return true;
    // fec0::/10 站点本地（已废弃，但仍需阻断）
    if (ipv6Raw.startsWith('fec') || ipv6Raw.startsWith('fed') || ipv6Raw.startsWith('fee') || ipv6Raw.startsWith('fef')) return true;
    // fe80::/10 链路本地（fe80 ~ febf）
    if (ipv6Raw.startsWith('fe8') || ipv6Raw.startsWith('fe9') || ipv6Raw.startsWith('fea') || ipv6Raw.startsWith('feb')) return true;
    // ::ffff:0:0/96 IPv4 映射地址，提取后检查 IPv4 部分
    if (ipv6Raw.startsWith('::ffff:')) {
      const v4Part = ipv6Raw.slice(7);
      if (isPrivateOrReservedHost(v4Part)) return true;
    }
  }

  return false;
}

function validateRemoteUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('远程语音服务地址无效');
  }
  const protocol = parsed.protocol;
  const hostname = parsed.hostname.toLowerCase();

  if (protocol === 'https:') {
    // #1: 禁止直连 IP 地址（含私有和公有 IP），防止 DNS rebinding
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
    // #5: 仅在非生产环境允许 localhost http
    if (hostname === 'localhost' && process.env.NODE_ENV !== 'production') return;
    throw new Error('远程语音服务地址必须使用 https');
  }
  throw new Error('远程语音服务地址协议不被支持');
}

function buildInstructions(task: SpeechTask<{ text: string }>): string | null {
  const chunks = [
    task.profile?.prompt?.trim(),
    task.profile?.style ? `style: ${task.profile.style.trim()}` : null,
    task.profile?.emotion ? `emotion: ${task.profile.emotion.trim()}` : null,
  ].filter((value): value is string => !!value);

  return chunks.length > 0 ? chunks.join('\n') : null;
}

function normalizeVoiceValue(apiUrl: string | null | undefined, model: string, voice: string | null | undefined): string {
  const trimmedVoice = voice?.trim();
  const isSiliconFlowCosyVoice = (apiUrl ?? '').toLowerCase().includes('siliconflow')
    && model === SILICONFLOW_COSYVOICE2_MODEL;

  if (!isSiliconFlowCosyVoice) {
    return trimmedVoice || 'alloy';
  }

  if (!trimmedVoice) {
    return SILICONFLOW_COSYVOICE2_DEFAULT_VOICE;
  }

  if (trimmedVoice.startsWith('speech:') || trimmedVoice.includes(':')) {
    return trimmedVoice;
  }

  return `${model}:${trimmedVoice}`;
}

async function resolveLlmProviderFromTask(task: SpeechTask<{ text: string }>): Promise<LlmProvider> {
  // #6: 不信任客户端传入的 llmProviderId（@internal 协议，仅内部使用）
  // 优先从 agentId 对应的 agent 配置中读取，再从客户端提供的 vendorOptions 读取
  if (task.context?.agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: task.context.agentId },
      include: {
        llmProvider: true,
      },
    }) as (Agent & { llmProvider: LlmProvider | null }) | null;

    if (agent?.llmProvider?.isActive && agent.llmProvider.apiProtocol === 'openai') {
      return agent.llmProvider;
    }
  }

  // vendorOptions.llmProviderId 是 @internal 协议，仅用于前端明确绑定的 provider ID
  const explicitProviderId = typeof task.profile?.vendorOptions?.llmProviderId === 'string'
    ? task.profile.vendorOptions.llmProviderId
    : null;

  if (explicitProviderId) {
    const provider = await prisma.llmProvider.findUnique({ where: { id: explicitProviderId } });
    if (provider?.isActive) {
      return provider;
    }
  }

  const audioProvider = await prisma.llmProvider.findFirst({
    where: { isActive: true, isDefault: true, modelType: 'audio', audioUsage: { in: ['tts', 'both'] } },
  });
  if (audioProvider) return audioProvider;

  throw new Error('未找到可用的语音（TTS）供应商，请在模型管理中添加语音类型模型并设为默认');
}

export function createRemoteTtsProvider(dependencies: RemoteTtsDependencies = {}): SpeechProvider {
  const resolveLlmProvider = dependencies.resolveLlmProvider ?? resolveLlmProviderFromTask;
  const providerId = dependencies.providerId ?? 'openai-compatible-tts';

  return {
    id: providerId,
    runtime: 'server',
    capabilities: {
      provider: providerId,
      runtime: 'server',
      taskTypes: ['tts'],
      formats: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'],
    },
    async synthesize(task) {
      const text = String((task.input as { text?: string }).text || '').trim();
      if (!text) {
        return {
          kind: 'audio',
          provider: providerId,
          text: '',
        };
      }

      const llmProvider = await resolveLlmProvider(task as SpeechTask<{ text: string }>);
      if (llmProvider.apiProtocol !== 'openai') {
        throw new Error(`${providerId} 仅支持 openai 协议供应商，当前为 ${llmProvider.apiProtocol}`);
      }

      // #20: 使用 spread 语法计算 Unicode codepoint 长度，避免 UTF-16 surrogate pair 计数错误
      const charCount = [...text].length;
      if (charCount > 5000) {
        throw new Error('文本长度超出限制（最多 5000 个字符）');
      }

      const format = task.profile?.format?.trim() || 'mp3';
      const model = task.profile?.model?.trim() || llmProvider.model;
      const voice = normalizeVoiceValue(llmProvider.apiUrl, model, task.profile?.voice);
      const endpoint = getSpeechEndpoint(llmProvider.apiUrl);
      validateRemoteUrl(endpoint);
      const instructions = buildInstructions(task as SpeechTask<{ text: string }>);
      const rawVendorOptions = task.profile?.vendorOptions && typeof task.profile.vendorOptions === 'object'
        ? task.profile.vendorOptions
        : {};
      const vendorOptions: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawVendorOptions)) {
        if (VENDOR_OPTION_WHITELIST.has(key)) {
          vendorOptions[key] = value;
        }
      }

      const baseBody: Record<string, unknown> = {
        ...vendorOptions,
        model,
        voice,
        input: text,
        response_format: format,
      };

      if (typeof task.profile?.speed === 'number') {
        baseBody.speed = task.profile.speed;
      }
      if (instructions) {
        baseBody.instructions = instructions;
      }

      let response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmProvider.apiKey}`,
        },
        body: JSON.stringify(baseBody),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error', // #7: 禁止重定向，防止 SSRF
      });

      // #15: 仅在 400 且错误体含 "instructions" 关键词时才 fallback
      if (!response.ok && response.status === 400 && instructions) {
        let shouldFallback = false;
        try {
          const errClone = response.clone();
          const errBody = await errClone.text();
          shouldFallback = errBody.toLowerCase().includes('instructions');
        } catch {
          // 读取失败时不 fallback
        }

        if (shouldFallback) {
          const fallbackBody = { ...baseBody };
          delete fallbackBody.instructions;
          response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${llmProvider.apiKey}`,
            },
            body: JSON.stringify(fallbackBody),
            signal: AbortSignal.timeout(30_000),
            redirect: 'error', // #7
          });
        }
      }

      if (!response.ok) {
        let errorText = '';
        try {
          const j = await response.json() as { error?: { message?: string } };
          errorText = j?.error?.message || JSON.stringify(j);
        } catch {
          errorText = await response.text().catch(() => '');
        }
        // #8: 只打印 hostname，不暴露完整 URL（含 auth 信息）
        console.error('[remote-tts] 远程语音合成失败', {
          status: response.status,
          host: new URL(endpoint).hostname,
          providerId,
          errorText,
        });
        throw new Error('TTS 服务请求失败，请稍后重试');
      }

      // #25: 检查响应大小，超过 50MB 拒绝
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > 50 * 1024 * 1024) {
        throw new Error('TTS 服务返回内容超过大小限制');
      }

      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      const mimeType = contentType.split(';')[0].trim() || 'audio/mpeg';
      const ab = await response.arrayBuffer();
      const audioBuffer = Buffer.from(ab);

      return {
        kind: 'audio',
        provider: providerId,
        text,
        audioBuffer,
        mimeType,
        model,
        voice,
        metadata: {
          runtime: 'server',
          llmProviderId: llmProvider.id,
          llmProviderName: llmProvider.name,
        },
      } satisfies SpeechArtifact;
    },
  };
}
