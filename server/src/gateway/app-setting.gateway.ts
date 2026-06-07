import type { FastifyInstance } from 'fastify';
import { appSettingService } from '../modules/app-setting/app-setting.service.js';

/**
 * 通用系统设置 Gateway（键值表 AppSetting）
 *
 * 仅暴露白名单内的 key，避免任意读写系统设置。
 * - GET /settings/:key — 读取设置（缺省返回空串）
 * - PUT /settings/:key — 保存设置
 */

// 允许通过该接口读写的设置项白名单
const ALLOWED_KEYS = new Set<string>(['diaryEnabled']);

export async function appSettingGateway(app: FastifyInstance) {
  app.get<{ Params: { key: string } }>(
    '/settings/:key',
    {
      schema: {
        description: '读取系统设置项（白名单）',
        tags: ['Settings'],
        params: { type: 'object', properties: { key: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      if (!ALLOWED_KEYS.has(key)) {
        return reply.code(400).send({ success: false, error: '不支持的设置项' });
      }
      const value = (await appSettingService.get(key)) ?? '';
      return reply.send({ success: true, data: { key, value } });
    },
  );

  app.put<{ Params: { key: string }; Body: { value: string } }>(
    '/settings/:key',
    {
      schema: {
        description: '保存系统设置项（白名单）',
        tags: ['Settings'],
        params: { type: 'object', properties: { key: { type: 'string' } } },
        body: {
          type: 'object',
          required: ['value'],
          properties: { value: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      if (!ALLOWED_KEYS.has(key)) {
        return reply.code(400).send({ success: false, error: '不支持的设置项' });
      }
      await appSettingService.set(key, request.body.value);
      return reply.send({ success: true, data: { key, value: request.body.value } });
    },
  );
}
