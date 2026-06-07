import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isValidInternalAgentToolToken } from '../core/agent/agent-handler/internal-agent-tool-auth.js';
import {
  chatCompletionToResponse,
  chatErrorToResponseError,
  ChatToResponsesSseConverter,
  inferCodexChatReasoningConfig,
  responsesToChatCompletions,
  type JsonValue,
} from '../core/agent/codex-router/index.js';
import prisma from '../lib/prisma.js';

interface RouterParams {
  token: string;
  providerId: string;
}

/**
 * 根据 provider.apiUrl 推出 Chat Completions 端点。
 * 兼容：纯 origin（补 /v1/chat/completions）、已含 /v1（补 /chat/completions）、
 * 自定义前缀（补 /chat/completions）、已是完整 /chat/completions（原样）。
 */
function buildChatCompletionsUrl(apiUrl: string): string {
  const base = apiUrl.trim().replace(/\/+$/, '');
  const lower = base.toLowerCase();
  if (lower.endsWith('/chat/completions')) return base;
  if (lower.endsWith('/v1')) return `${base}/chat/completions`;

  // 纯 origin（scheme://host，无路径段）→ 补 /v1。
  const afterScheme = base.split('://')[1] ?? base;
  const originOnly = !afterScheme.includes('/');
  return originOnly ? `${base}/v1/chat/completions` : `${base}/chat/completions`;
}

function forwardedAuthHeader(request: FastifyRequest): string | undefined {
  const auth = request.headers['authorization'];
  return typeof auth === 'string' ? auth : undefined;
}

function isStreamRequest(body: Record<string, JsonValue>): boolean {
  return body['stream'] === true;
}

async function handleRouterRequest(
  request: FastifyRequest<{ Params: RouterParams }>,
  reply: FastifyReply,
): Promise<void> {
  try {
    await routeCodexRequest(request, reply);
  } catch (error) {
    console.error('[CodexRouter] 处理请求时发生未捕获异常:', error);
    if (!reply.sent && !reply.raw.headersSent) {
      const message = error instanceof Error ? error.message : 'router internal error';
      await reply.code(502).send(chatErrorToResponseError(`Codex router error: ${message}`));
    }
  }
}

async function routeCodexRequest(
  request: FastifyRequest<{ Params: RouterParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { token, providerId } = request.params;
  if (!isValidInternalAgentToolToken(token)) {
    await reply.code(401).send({ error: { message: 'Invalid router token', type: 'auth_error' } });
    return;
  }

  const provider = await prisma.llmProvider.findUnique({ where: { id: providerId } });
  if (!provider || !provider.apiUrl) {
    await reply
      .code(404)
      .send({ error: { message: 'Codex router provider not found', type: 'config_error' } });
    return;
  }

  const requestBody = (request.body ?? {}) as Record<string, JsonValue>;
  const stream = isStreamRequest(requestBody);

  // 用 provider 配置的 model 覆盖客户端 model，并按 provider 标识推断 reasoning 适配。
  if (provider.model) requestBody['model'] = provider.model;
  const reasoningConfig = inferCodexChatReasoningConfig({
    name: provider.name,
    baseUrl: provider.apiUrl,
    model: provider.model,
  });

  const chatBody = responsesToChatCompletions(requestBody, reasoningConfig);
  const upstreamUrl = buildChatCompletionsUrl(provider.apiUrl);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const auth = forwardedAuthHeader(request);
  if (auth) headers['authorization'] = auth;

  console.log(
    `[CodexRouter] → ${upstreamUrl} (provider=${provider.name}, model=${String(chatBody.model)}, stream=${stream})`,
  );

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(chatBody),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upstream request failed';
    console.error(`[CodexRouter] 上游请求失败 ${upstreamUrl}:`, error);
    await reply
      .code(502)
      .send(chatErrorToResponseError(`Codex router upstream error: ${message}`));
    return;
  }

  if (!upstream.ok) {
    console.error(
      `[CodexRouter] 上游返回非 2xx：${upstream.status} ${upstream.statusText} (${upstreamUrl})`,
    );
    await sendUpstreamError(reply, upstream);
    return;
  }

  if (stream || isEventStream(upstream)) {
    await streamResponses(reply, upstream);
    return;
  }

  await sendNonStreamResponse(reply, upstream);
}

function isEventStream(upstream: Response): boolean {
  return (upstream.headers.get('content-type') ?? '').includes('text/event-stream');
}

async function sendUpstreamError(reply: FastifyReply, upstream: Response): Promise<void> {
  const text = await upstream.text().catch(() => '');
  let parsed: JsonValue | undefined;
  try {
    parsed = text ? (JSON.parse(text) as JsonValue) : undefined;
  } catch {
    parsed = text || undefined;
  }
  await reply
    .code(upstream.status)
    .header('content-type', 'application/json')
    .send(chatErrorToResponseError(parsed));
}

async function sendNonStreamResponse(reply: FastifyReply, upstream: Response): Promise<void> {
  const text = await upstream.text();
  let chatResponse: JsonValue;
  try {
    chatResponse = JSON.parse(text) as JsonValue;
  } catch {
    await reply
      .code(502)
      .send(chatErrorToResponseError(`Failed to parse upstream chat response: ${text.slice(0, 500)}`));
    return;
  }

  try {
    const responsesBody = chatCompletionToResponse(chatResponse);
    await reply.code(200).header('content-type', 'application/json').send(responsesBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'transform failed';
    await reply.code(502).send(chatErrorToResponseError(`Chat → Responses 转换失败: ${message}`));
  }
}

async function streamResponses(reply: FastifyReply, upstream: Response): Promise<void> {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const converter = new ChatToResponsesSseConverter();
  const body = upstream.body;
  if (!body) {
    reply.raw.write(converter.end());
    reply.raw.end();
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) {
        const out = converter.push(chunk);
        if (out) reply.raw.write(out);
      }
    }
    const tail = converter.end();
    if (tail) reply.raw.write(tail);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'stream error';
    const failed = converter.fail(message);
    if (failed) reply.raw.write(failed);
  } finally {
    reply.raw.end();
  }
}

export async function codexRouterGateway(app: FastifyInstance): Promise<void> {
  app.post<{ Params: RouterParams }>('/codex-router/:token/:providerId/v1/responses', handleRouterRequest);
  app.post<{ Params: RouterParams }>(
    '/codex-router/:token/:providerId/v1/responses/compact',
    handleRouterRequest,
  );
}
