import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import prisma from '../lib/prisma.js';
import { serverSpeechService } from '../modules/speech/default-service.js';
import type { SpeechArtifact, SpeechSession, SpeechTask } from '../modules/speech/domain/types.js';
import { deserializeAgentSpeechConfig } from '../modules/speech/speech-config.js';
import { authService } from '../modules/auth/auth.service.js';
import { fetchTtsApiResponse } from '../modules/speech/providers/remote-tts.provider.js';

type SpeechGatewayDependencies = {
  execute: (task: SpeechTask) => Promise<SpeechArtifact | SpeechSession>;
};

export function createSpeechGateway(dependencies: SpeechGatewayDependencies = {
  execute: (task) => serverSpeechService.execute(task),
}) {
  return async function speechGateway(app: FastifyInstance) {
    async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
      const authHeader = request.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!token) {
        reply.code(401).send({ success: false, error: 'Unauthorized' });
        return false;
      }
      const user = await authService.getUserFromToken(token);
      if (!user) {
        reply.code(401).send({ success: false, error: 'Unauthorized' });
        return false;
      }
      return true;
    }

    app.post<{ Body: SpeechTask<{ text: string }> }>(
      '/speech/tts',
      {
        preHandler: async (request, reply) => {
          const ok = await requireAuth(request, reply);
          if (!ok) return; // #28: Fastify v5 preHandler 不需要 return reply
        },
        schema: {
          body: {
            type: 'object',
            required: ['input'],
            properties: {
              type: { type: 'string', enum: ['tts'] },
              profile: { type: 'object', nullable: true, additionalProperties: true },
              context: { type: 'object', nullable: true, additionalProperties: true },
              preferences: { type: 'object', nullable: true, additionalProperties: true },
              input: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string', maxLength: 5000 },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const task: SpeechTask = {
          ...request.body,
          type: 'tts',
        };

        const inputText = String((task.input as { text?: string })?.text ?? '');
        if (!inputText.trim()) {
          return reply.code(400).send({
            success: false,
            error: '文本不能为空',
          });
        }
        if (inputText.length > 5000) {
          return reply.code(400).send({
            success: false,
            error: '文本长度超出限制（最多 5000 字符）',
          });
        }

        const result = await dependencies.execute(task);
        if (!isAudioArtifact(result) || !result.audioBuffer || !result.mimeType) {
          return reply.code(502).send({
            success: false,
            error: '远程语音服务未返回可播放音频',
          });
        }

        if (!result.mimeType.startsWith('audio/')) {
          return reply.code(502).send({
            success: false,
            error: '远程语音服务返回的内容类型无效',
          });
        }

        reply.header('Content-Type', result.mimeType);
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Speech-Provider', result.provider);
        if (result.model) reply.header('X-Speech-Model', result.model);
        if (result.voice) reply.header('X-Speech-Voice', result.voice);
        return reply.send(result.audioBuffer);
      },
    );

    app.post<{ Body: SpeechTask<{ text: string }> }>(
      '/speech/tts/stream',
      {
        preHandler: async (request, reply) => {
          const ok = await requireAuth(request, reply)
          if (!ok) return
        },
        schema: {
          body: {
            type: 'object',
            required: ['input'],
            properties: {
              type: { type: 'string', enum: ['tts'] },
              profile: { type: 'object', nullable: true, additionalProperties: true },
              context: { type: 'object', nullable: true, additionalProperties: true },
              preferences: { type: 'object', nullable: true, additionalProperties: true },
              input: {
                type: 'object',
                required: ['text'],
                properties: {
                  text: { type: 'string', maxLength: 5000 },
                },
              },
            },
          },
        },
      },
      async (request, reply) => {
        const task: SpeechTask = {
          ...request.body,
          type: 'tts',
        }

        const inputText = String((task.input as { text?: string })?.text ?? '')
        if (!inputText.trim()) {
          return reply.code(400).send({ success: false, error: '文本不能为空' })
        }

        let fetchResult: { response: Response; mimeType: string; model: string; voice: string }
        try {
          fetchResult = await fetchTtsApiResponse(task as SpeechTask<{ text: string }>)
        } catch (err) {
          const msg = err instanceof Error ? err.message : '流式语音服务失败'
          return reply.code(502).send({ success: false, error: msg })
        }

        const { response, mimeType, model, voice } = fetchResult
        if (!response.body) {
          return reply.code(502).send({ success: false, error: 'TTS 服务不支持流式响应' })
        }

        reply.header('Content-Type', mimeType)
        reply.header('Cache-Control', 'no-store')
        reply.header('X-Speech-Provider', 'openai-compatible-tts')
        if (model) reply.header('X-Speech-Model', model)
        if (voice) reply.header('X-Speech-Voice', voice)

        const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
        return reply.send(nodeStream)
      },
    )

    app.post(
      '/speech/stt',
      {
        preHandler: async (request, reply) => {
          const ok = await requireAuth(request, reply);
          if (!ok) return; // #28: Fastify v5 preHandler 不需要 return reply
        },
      },
      async (request, reply) => {
        let audioBuffer: Buffer | null = null;
        let mimeType = 'audio/webm';
        let agentId: string | undefined;
        let language: string | undefined;

        try {
          const parts = request.parts();
          for await (const part of parts) {
            if (part.type === 'file' && part.fieldname === 'file') {
              audioBuffer = await part.toBuffer();
              const uploadedMimeType = part.mimetype || 'audio/webm';
              // #10: 校验上传 MIME 类型白名单
              if (!uploadedMimeType.startsWith('audio/') && uploadedMimeType !== 'application/octet-stream') {
                return reply.code(400).send({ error: '不支持的音频格式' });
              }
              mimeType = uploadedMimeType;
            } else if (part.type === 'field') {
              if (part.fieldname === 'agentId') agentId = String(part.value);
              if (part.fieldname === 'language') language = String(part.value);
            }
          }
        } catch {
          return reply.code(400).send({ error: '请求解析失败' });
        }

        if (!audioBuffer || audioBuffer.length === 0) {
          return reply.code(400).send({ error: '缺少音频文件' });
        }
        if (audioBuffer.length > 25 * 1024 * 1024) {
          return reply.code(400).send({ error: '音频文件不得超过 25MB' });
        }

        // 从 DB 读取 agent 的 sttProfile（若有 agentId）
        // #9: agentId 无法校验归属时忽略（不使用该 agent 配置），而非报错
        let sttProfile = null;
        if (agentId) {
          try {
            const agent = await prisma.agent.findUnique({ where: { id: agentId } });
            if (agent?.speechConfig) {
              const speechConfig = deserializeAgentSpeechConfig(agent.speechConfig);
              sttProfile = speechConfig?.sttProfile ?? null;
            }
          } catch {
            // 解析失败则忽略，回退到系统默认
          }
        }

        const task: SpeechTask = {
          type: 'stt',
          input: { audioBuffer, mimeType },
          profile: {
            ...sttProfile,
            provider: 'openai-compatible-stt',
            vendorOptions: {
              ...sttProfile?.vendorOptions,
              ...(language ? { language } : {}),
            },
          },
          context: { agentId },
        };

        let result: SpeechArtifact | SpeechSession;
        try {
          result = await dependencies.execute(task);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'STT 服务不可用';
          // 供应商未配置类错误返回 400（前端可区分提示"去配置"），其他返回 502
          const statusCode = message.includes('未找到') || message.includes('不可用') ? 400 : 502;
          return reply.code(statusCode).send({ error: message });
        }

        if (!isTranscriptArtifact(result)) {
          return reply.code(502).send({ error: '语音识别服务返回格式无效' });
        }

        reply.header('X-Speech-Provider', result.provider);
        return { text: result.text ?? '', provider: result.provider };
      },
    );
    // #43: 返回支持的语音供应商元数据（前端 voice-provider-metadata.ts 的服务端 source of truth）
    app.get(
      '/speech/providers',
      {
        preHandler: async (request, reply) => {
          const ok = await requireAuth(request, reply);
          if (!ok) return;
        },
        schema: {
          description: '获取已知语音供应商的模型和音色元数据列表',
          tags: ['Speech'],
          response: {
            200: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                data: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {
                      urlPattern: { type: 'string' },
                      label: { type: 'string' },
                      ttsModels: { type: 'array', items: { type: 'string' } },
                      sttModels: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      async (_request, reply) => {
        // 静态元数据，与前端 voice-provider-metadata.ts 保持同步。
        // 新增供应商时只需在此处添加一个条目。
        const providers = [
          {
            urlPattern: 'siliconflow',
            label: 'SiliconFlow',
            ttsModels: ['FunAudioLLM/CosyVoice2-0.5B'],
            sttModels: ['FunAudioLLM/SenseVoiceSmall'],
            voices: {
              'FunAudioLLM/CosyVoice2-0.5B': [
                { id: 'FunAudioLLM/CosyVoice2-0.5B:anna', label: 'Anna（沉稳女声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:bella', label: 'Bella（热情女声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:claire', label: 'Claire（温柔女声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:diana', label: 'Diana（活泼女声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:alex', label: 'Alex（沉稳男声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:benjamin', label: 'Benjamin（低沉男声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:charles', label: 'Charles（磁性男声）' },
                { id: 'FunAudioLLM/CosyVoice2-0.5B:david', label: 'David（明快男声）' },
              ],
            },
          },
          {
            urlPattern: 'api.openai.com',
            label: 'OpenAI',
            ttsModels: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
            sttModels: ['whisper-1'],
            voices: {
              'tts-1': [
                { id: 'alloy', label: 'Alloy（中性）' },
                { id: 'echo', label: 'Echo（男声）' },
                { id: 'fable', label: 'Fable（英式男声）' },
                { id: 'onyx', label: 'Onyx（低沉男声）' },
                { id: 'nova', label: 'Nova（女声）' },
                { id: 'shimmer', label: 'Shimmer（轻柔女声）' },
              ],
              'tts-1-hd': [
                { id: 'alloy', label: 'Alloy（中性）' },
                { id: 'echo', label: 'Echo（男声）' },
                { id: 'fable', label: 'Fable（英式男声）' },
                { id: 'onyx', label: 'Onyx（低沉男声）' },
                { id: 'nova', label: 'Nova（女声）' },
                { id: 'shimmer', label: 'Shimmer（轻柔女声）' },
              ],
              'gpt-4o-mini-tts': [
                { id: 'alloy', label: 'Alloy' },
                { id: 'echo', label: 'Echo' },
                { id: 'fable', label: 'Fable' },
                { id: 'onyx', label: 'Onyx' },
                { id: 'nova', label: 'Nova' },
                { id: 'shimmer', label: 'Shimmer' },
                { id: 'ash', label: 'Ash' },
                { id: 'ballad', label: 'Ballad' },
                { id: 'coral', label: 'Coral' },
                { id: 'sage', label: 'Sage' },
                { id: 'verse', label: 'Verse' },
              ],
            },
          },
        ];
        return reply.send({ success: true, data: providers });
      },
    );
  };
}

export const speechGateway = createSpeechGateway();

function isAudioArtifact(result: SpeechArtifact | SpeechSession): result is SpeechArtifact {
  return 'kind' in result && result.kind === 'audio';
}

function isTranscriptArtifact(result: SpeechArtifact | SpeechSession): result is SpeechArtifact {
  return 'kind' in result && (result as SpeechArtifact).kind === 'transcript';
}
