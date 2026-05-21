import { FastifyInstance } from 'fastify';
import { templatePackageService } from '../modules/template-package/template-package.service.js';

interface ExportTemplateBody {
  chatRoomId: string;
  packageTitle?: string;
  packageSummary?: string;
  includeSkills?: boolean;
  includeCronTasks?: boolean;
}

interface PreviewTemplateBody {
  manifest: unknown;
  desiredGroupName: string;
  capabilityDescriptors?: unknown[];
}

interface ImportTemplateBody {
  manifest: unknown;
  snapshot: unknown;
  skills?: unknown[];
  skillUsages?: unknown[];
  capabilityDescriptors?: unknown[];
  desiredGroupName: string;
  duplicateAction: 'cancel' | 'create_copy' | 'rename_copy';
}

export async function templatePackageGateway(app: FastifyInstance) {
  app.post<{ Body: ExportTemplateBody }>(
    '/template-packages/export',
    {
      schema: {
        description: '导出群组模板包（当前返回结构化载荷骨架）',
        tags: ['TemplatePackages'],
        body: {
          type: 'object',
          required: ['chatRoomId'],
          properties: {
            chatRoomId: { type: 'string' },
            packageTitle: { type: 'string' },
            packageSummary: { type: 'string' },
            includeSkills: { type: 'boolean' },
            includeCronTasks: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const {
        chatRoomId,
        packageTitle,
        packageSummary,
        includeSkills,
        includeCronTasks,
      } = request.body;

      try {
        const payload = await templatePackageService.exportChatRoomTemplate({
          chatRoomId,
          version: '1.0.0',
          title: packageTitle?.trim() || '未命名模板',
          summary: packageSummary?.trim() || null,
          sourceType: 'local',
          sourceAuthor: null,
          includeSkills,
          includeCronTasks,
        });

        return reply.send({ success: true, data: payload });
      } catch (error) {
        const message = error instanceof Error ? error.message : '导出失败';
        const status = message === '群组不存在' ? 404 : 500;
        return reply.code(status).send({ success: false, error: message });
      }
    },
  );

  app.post<{ Body: PreviewTemplateBody }>(
    '/template-packages/preview',
    {
      schema: {
        description: '预检群组模板包（当前接收结构化 manifest + capabilityDescriptors）',
        tags: ['TemplatePackages'],
        body: {
          type: 'object',
          required: ['manifest', 'desiredGroupName'],
          properties: {
            manifest: { type: 'object', additionalProperties: true },
            desiredGroupName: { type: 'string' },
            capabilityDescriptors: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { manifest, desiredGroupName, capabilityDescriptors = [] } = request.body;

      try {
        const preview = await templatePackageService.previewTemplatePayload({
          manifestInput: manifest,
          desiredGroupName,
          capabilityDescriptors: capabilityDescriptors as any,
        });
        return reply.send({ success: true, data: preview });
      } catch (error) {
        const message = error instanceof Error ? error.message : '预检失败';
        return reply.code(400).send({ success: false, error: message });
      }
    },
  );

  app.post<{ Body: ImportTemplateBody }>(
    '/template-packages/import',
    {
      schema: {
        description: '导入群组模板包（当前接收结构化 manifest + snapshot）',
        tags: ['TemplatePackages'],
        body: {
          type: 'object',
          required: ['manifest', 'snapshot', 'desiredGroupName', 'duplicateAction'],
          properties: {
            manifest: { type: 'object', additionalProperties: true },
            snapshot: { type: 'object', additionalProperties: true },
            skills: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            skillUsages: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            capabilityDescriptors: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            desiredGroupName: { type: 'string' },
            duplicateAction: {
              type: 'string',
              enum: ['cancel', 'create_copy', 'rename_copy'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const {
        manifest,
        snapshot,
        skills = [],
        skillUsages = [],
        capabilityDescriptors = [],
        desiredGroupName,
        duplicateAction,
      } = request.body;

      try {
        if (
          !snapshot ||
          typeof snapshot !== 'object' ||
          !('room' in snapshot) ||
          !('agents' in snapshot) ||
          !Array.isArray((snapshot as any).agents)
        ) {
          return reply.code(400).send({ success: false, error: 'snapshot 格式无效：缺少 room 或 agents 字段' });
        }

        const result = await templatePackageService.importTemplatePayload({
          manifestInput: manifest,
          snapshot: snapshot as any,
          skills: skills as any,
          skillUsages: skillUsages as any,
          capabilityDescriptors: capabilityDescriptors as any,
          desiredGroupName,
          duplicateAction,
        });
        return reply.send({ success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : '导入失败';
        return reply.code(400).send({ success: false, error: message });
      }
    },
  );
}
