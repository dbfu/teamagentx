import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { serverSpeechService } from '../modules/speech/default-service.js';
import type { SpeechArtifact, SpeechSession, SpeechTask } from '../modules/speech/domain/types.js';
import { authService } from '../modules/auth/auth.service.js';

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
          if (!ok) return reply;
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
  };
}

export const speechGateway = createSpeechGateway();

function isAudioArtifact(result: SpeechArtifact | SpeechSession): result is SpeechArtifact {
  return 'kind' in result && result.kind === 'audio';
}
