import { FastifyInstance } from 'fastify';
import { uploadService } from './upload.service.js';

export async function uploadGateway(app: FastifyInstance) {
  const uploadResponseProperties = {
    type: { type: 'string' },
    filename: { type: 'string' },
    mimeType: { type: 'string' },
    size: { type: 'integer' },
    url: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    durationMs: { type: 'integer' },
  };

  // 单图上传接口
  app.post('/upload/image', {
    schema: {
      description: '上传单张图片',
      tags: ['Upload'],
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: uploadResponseProperties,
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const file = await request.file();
      const result = await uploadService.processImage(file);
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败';
      return reply.code(400).send({ success: false, error: message });
    }
  });

  // 批量上传接口
  app.post('/upload/images', {
    schema: {
      description: '批量上传图片（支持拖拽多张图片）',
      tags: ['Upload'],
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: uploadResponseProperties,
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const files = request.files();
      const results = await uploadService.processImages(files);
      return reply.send({ success: true, data: results });
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败';
      return reply.code(400).send({ success: false, error: message });
    }
  });

  app.post('/upload/audio', {
    schema: {
      description: '上传单段音频',
      tags: ['Upload'],
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: uploadResponseProperties,
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const file = await request.file();
      const result = await uploadService.processAudio(file);
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传失败';
      return reply.code(400).send({ success: false, error: message });
    }
  });
}
