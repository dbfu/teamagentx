import type { LlmProvider } from '@prisma/client';
import prisma from '../../../lib/prisma.js';
import type { SpeechProvider } from '../domain/provider.js';
import type { SpeechArtifact, SpeechTask } from '../domain/types.js';

function getTranscriptionsEndpoint(apiUrl?: string | null): string {
  if (!apiUrl?.trim()) throw new Error('语音服务地址未配置');
  const base = apiUrl.replace(/\/+$/, '');
  if (base.toLowerCase().endsWith('/audio/transcriptions')) return base;
  return `${base}/audio/transcriptions`;
}

function isPrivateOrReservedHost(hostname: string): boolean {
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
    // fec0::/10 站点本地（已废弃，但仍需阻断）
    if (ipv6Raw.startsWith('fec') || ipv6Raw.startsWith('fed') || ipv6Raw.startsWith('fee') || ipv6Raw.startsWith('fef')) return true;
    // fe80::/10 链路本地（fe80 ~ febf）
    if (ipv6Raw.startsWith('fe8') || ipv6Raw.startsWith('fe9') || ipv6Raw.startsWith('fea') || ipv6Raw.startsWith('feb')) return true;
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

async function resolveLlmProviderFromSttTask(task: SpeechTask): Promise<LlmProvider> {
  // #6: 优先从 agentId 对应的 agent 配置中读取，限制客户端对 llmProviderId 的控制
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

  const audioProvider = await prisma.llmProvider.findFirst({
    where: { isActive: true, isDefault: true, modelType: 'audio', audioUsage: { in: ['stt', 'both'] } },
  });
  if (audioProvider) return audioProvider;

  throw new Error('未找到可用的语音识别（STT）供应商，请在模型管理中添加语音类型模型并设为默认');
}

export function createRemoteSttProvider(): SpeechProvider {
  const providerId = 'openai-compatible-stt';

  return {
    id: providerId,
    runtime: 'server',
    capabilities: {
      provider: providerId,
      runtime: 'server',
      taskTypes: ['stt'],
    },
    async transcribe(task) {
      const input = task.input as { audioBuffer?: Buffer; mimeType?: string };
      const audioBuffer = input.audioBuffer;
      const mimeType = input.mimeType || 'audio/webm';

      if (!audioBuffer || audioBuffer.length === 0) {
        throw new Error('音频数据为空');
      }

      // #10: 校验 MIME 类型白名单
      if (!mimeType.startsWith('audio/') && mimeType !== 'application/octet-stream') {
        throw new Error('不支持的音频格式');
      }

      const llmProvider = await resolveLlmProviderFromSttTask(task);
      if (llmProvider.apiProtocol !== 'openai') {
        throw new Error(`${providerId} 仅支持 openai 协议供应商，当前为 ${llmProvider.apiProtocol}`);
      }

      const endpoint = getTranscriptionsEndpoint(llmProvider.apiUrl);
      validateRemoteUrl(endpoint);

      // #21: 使用正确类型而非 as any
      const model = task.profile?.model?.trim() || llmProvider.sttModel || llmProvider.model || 'whisper-1';
      const language = typeof task.profile?.vendorOptions?.language === 'string'
        ? task.profile.vendorOptions.language
        : undefined;

      // #14: 使用更安全的 Buffer -> Blob 写法
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), 'audio.webm');
      form.append('model', model);
      if (language) form.append('language', language);
      form.append('response_format', 'json'); // #26: 明确请求 JSON 格式响应

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${llmProvider.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(30_000),
          redirect: 'error', // #7: 禁止重定向
        });
      } catch (err) {
        // #13: 区分 AbortError 和其他错误
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('STT 请求超时，请重试');
        }
        console.error('[remote-stt] STT 请求失败', { host: (() => { try { return new URL(endpoint).hostname; } catch { return 'unknown'; } })(), err });
        throw new Error('STT 服务请求失败，请稍后重试');
      }

      if (!response.ok) {
        let errorText = '';
        try {
          const j = await response.json() as { error?: { message?: string } };
          errorText = j?.error?.message || JSON.stringify(j);
        } catch {
          errorText = await response.text().catch(() => '');
        }
        // #8: 只打印 hostname
        console.error('[remote-stt] 语音识别失败', { status: response.status, host: new URL(endpoint).hostname, errorText });
        throw new Error('STT 服务请求失败，请稍后重试');
      }

      const json = await response.json() as { text?: string };
      const text = (json.text ?? '').trim();

      return {
        kind: 'transcript',
        text,
        provider: providerId,
        model,
      } satisfies SpeechArtifact;
    },
  };
}
