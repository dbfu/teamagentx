import { FastifyInstance } from 'fastify';
import { templatePackageService } from '../modules/template-package/template-package.service.js';
import { buildTemplateArchive, parseTemplateArchive } from '../modules/template-package/template-archive.js';
import { authService } from '../modules/auth/auth.service.js';

async function resolveRequestUserId(request: any): Promise<string | null> {
  const authHeader = request.headers?.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (!token) return null;
  const user = await authService.getUserFromToken(token);
  return user?.id ?? null;
}

interface ExportTemplateBody {
  chatRoomId: string;
  packageTitle?: string;
  packageSummary?: string;
}

function buildArchiveFilename(title: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
  const date = new Date().toISOString().slice(0, 10);
  return `${safeTitle || 'group-template'}-${date}.zip`;
}

function buildAttachmentHeader(filename: string): string {
  return `attachment; filename="group-template.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function readTemplateArchiveUpload(request: any) {
  const parts = request.parts();
  let archiveBuffer: Buffer | null = null;
  let desiredGroupName = '';

  for await (const part of parts) {
    if (part.type === 'file' && part.fieldname === 'template') {
      archiveBuffer = await part.toBuffer();
      continue;
    }

    if (part.type === 'field' && part.fieldname === 'desiredGroupName') {
      desiredGroupName = String(part.value ?? '').trim();
    }
  }

  if (!archiveBuffer) {
    throw new Error('请上传群组模板文件');
  }

  const archive = parseTemplateArchive(archiveBuffer);
  return {
    archive,
    desiredGroupName: desiredGroupName || archive.manifest.title,
  };
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
          },
        },
      },
    },
    async (request, reply) => {
      const { chatRoomId, packageTitle, packageSummary } = request.body;

      try {
        const payload = await templatePackageService.exportChatRoomTemplate({
          chatRoomId,
          version: '1.0.0',
          title: packageTitle?.trim() || '未命名模板',
          summary: packageSummary?.trim() || null,
          sourceType: 'local',
          sourceAuthor: null,
        });
        const archive = buildTemplateArchive(payload);

        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', buildAttachmentHeader(buildArchiveFilename(payload.manifest.title)));
        return reply.send(archive);
      } catch (error) {
        const message = error instanceof Error ? error.message : '导出失败';
        const status = message === '群组不存在' ? 404 : 500;
        return reply.code(status).send({ success: false, error: message });
      }
    },
  );

  app.post(
    '/template-packages/preview',
    {
      schema: {
        description: '预检群组模板（接收 ZIP 文件）',
        tags: ['TemplatePackages'],
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      try {
        const { archive, desiredGroupName } = await readTemplateArchiveUpload(request);
        const preview = await templatePackageService.previewTemplatePayload({
          manifestInput: archive.manifest,
          desiredGroupName,
          capabilityDescriptors: archive.capabilityDescriptors,
          degradedSkills: archive.degradedSkills,
        });
        return reply.send({ success: true, data: preview });
      } catch (error) {
        const message = error instanceof Error ? error.message : '预检失败';
        return reply.code(400).send({ success: false, error: message });
      }
    },
  );

  app.post(
    '/template-packages/import',
    {
      schema: {
        description: '导入群组模板（接收 ZIP 文件）',
        tags: ['TemplatePackages'],
        consumes: ['multipart/form-data'],
      },
    },
    async (request, reply) => {
      try {
        const { archive, desiredGroupName } = await readTemplateArchiveUpload(request);
        const { manifest, snapshot, skills, skillUsages, capabilityDescriptors } = archive;

        if (
          !snapshot ||
          typeof snapshot !== 'object' ||
          !('room' in snapshot) ||
          !('agents' in snapshot) ||
          !Array.isArray((snapshot as any).agents)
        ) {
          return reply.code(400).send({ success: false, error: 'snapshot 格式无效：缺少 room 或 agents 字段' });
        }

        const ownerId = await resolveRequestUserId(request);
        const result = await templatePackageService.importTemplatePayload({
          manifestInput: manifest,
          snapshot: snapshot as any,
          skills,
          skillUsages,
          degradedSkills: archive.degradedSkills,
          capabilityDescriptors,
          desiredGroupName,
          ownerId,
        });
        return reply.send({ success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : '导入失败';
        return reply.code(400).send({ success: false, error: message });
      }
    },
  );
}
