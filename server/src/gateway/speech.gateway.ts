import type { FastifyInstance } from 'fastify';
import { serverSpeechService } from '../modules/speech/default-service.js';
import type { SpeechArtifact, SpeechSession, SpeechTask } from '../modules/speech/domain/types.js';

type SpeechGatewayDependencies = {
  execute: (task: SpeechTask) => Promise<SpeechArtifact | SpeechSession>;
};

function decodeDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('语音结果不是可下载的 data url');
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export function createSpeechGateway(dependencies: SpeechGatewayDependencies = {
  execute: (task) => serverSpeechService.execute(task),
}) {
  return async function speechGateway(app: FastifyInstance) {
    app.post<{ Body: SpeechTask<{ text: string }> }>(
      '/speech/tts',
      {
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
                  text: { type: 'string' },
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

        const result = await dependencies.execute(task);
        if (!isAudioArtifact(result) || !result.audioUrl) {
          return reply.code(502).send({
            success: false,
            error: '远程语音服务未返回可播放音频',
          });
        }

        const { mimeType, buffer } = decodeDataUrl(result.audioUrl);
        reply.header('Content-Type', result.mimeType || mimeType);
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Speech-Provider', result.provider);
        if (result.model) reply.header('X-Speech-Model', result.model);
        if (result.voice) reply.header('X-Speech-Voice', result.voice);
        return reply.send(buffer);
      },
    );
  };
}

export const speechGateway = createSpeechGateway();

function isAudioArtifact(result: SpeechArtifact | SpeechSession): result is SpeechArtifact {
  return 'kind' in result && result.kind === 'audio';
}
