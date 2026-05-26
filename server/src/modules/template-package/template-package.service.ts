import { randomUUID } from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import prisma from '../../lib/prisma.js';
import { deserializeAgentSpeechConfig } from '../speech/speech-config.js';
import { serializeAgentSpeechConfig } from '../speech/speech-config.js';
import { getSharedSkillsDir } from '../skill/preinstalled-skills.js';
import { skillInstallService } from '../skill/skill-install.service.js';
import { buildTemplatePackagePayload } from './template-export.service.js';
import { buildTemplateImportPlan } from './template-import.service.js';
import { previewTemplatePackage } from './template-preview.service.js';
import {
  collectSkillsForTemplate,
  materializeTemplateSkills,
  type DegradedTemplateSkill,
  type TemplateSkillPackage,
  type TemplateSkillUsage,
} from './template-skill-packager.js';

const agentInclude = {
  category: true,
  capabilities: true,
} as const;

export const templatePackageService = {
  async exportChatRoomTemplate(input: {
    chatRoomId: string;
    templateId?: string;
    version: string;
    title: string;
    summary?: string | null;
    sourceType: 'local' | 'market';
    sourceAuthor?: string | null;
    includeSkills?: boolean;
    includeCronTasks?: boolean;
  }) {
    const room = await prisma.chatRoom.findUnique({
      where: { id: input.chatRoomId },
      include: {
        chatRoomAgents: true,
      },
    });

    if (!room) {
      throw new Error('群组不存在');
    }

    const stableTemplateId = input.templateId ?? await resolveTemplateIdForRoom(room.id);

    const agentIds = Array.from(
      new Set(
        room.chatRoomAgents
          .map((item) => item.agentId)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const agents = agentIds.length > 0
      ? await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        include: agentInclude,
      })
      : [];

    const categories = Array.from(
      new Map(
        agents
          .filter((agent) => agent.category)
          .map((agent) => [
            agent.category!.id,
            {
              id: agent.category!.id,
              name: agent.category!.name,
              description: agent.category!.description,
              sortOrder: agent.category!.sortOrder,
            },
          ]),
      ).values(),
    );

    const cronTasks = input.includeCronTasks === false
      ? []
      : await prisma.cronTask.findMany({
        where: { chatRoomId: input.chatRoomId },
        orderBy: { createdAt: 'asc' },
      });

    const collectedSkills = input.includeSkills === false
      ? { skills: [], usages: [], degraded: [] }
      : collectSkillsForTemplate(
        agents.map((agent) => ({
          agentId: agent.id,
          skillsDir: skillInstallService.getAgentSkillsDir(agent),
        })),
      );

    const payload = buildTemplatePackagePayload({
      templateId: stableTemplateId,
      version: input.version,
      title: input.title,
      summary: input.summary,
      sourceType: input.sourceType,
      sourceAuthor: input.sourceAuthor,
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        rules: room.rules,
        workDir: room.workDir,
        defaultAgentId: room.defaultAgentId,
        agentTriggerMode: (room.agentTriggerMode as 'auto' | 'manual' | 'coordinator') ?? 'auto',
      },
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        prompt: agent.prompt,
        type: agent.type,
        acpTool: agent.acpTool,
        categoryId: agent.categoryId,
        workDir: agent.workDir,
        proxyConfig: agent.proxyConfig,
        codexModel: agent.codexModel,
        codexFastMode: agent.codexFastMode,
        claudeModel: agent.claudeModel,
        thinkingMode: agent.thinkingMode,
        llmProviderId: agent.llmProviderId,
        speechConfig: agent.speechConfig
          ? deserializeAgentSpeechConfig(agent.speechConfig)
          : null,
        capabilities: agent.capabilities.map((capability) => ({
          capabilityType: capability.capabilityType as 'image' | 'audio',
          enabled: capability.enabled,
          llmProviderId: capability.llmProviderId,
        })),
      })),
      categories,
      cronTasks: cronTasks.map((task) => ({
        id: task.id,
        name: task.name,
        payload: task.payload,
      })),
      skills: collectedSkills.skills,
      skillUsages: collectedSkills.usages,
      degradedSkills: collectedSkills.degraded,
      includeSkills: input.includeSkills,
      includeCronTasks: input.includeCronTasks,
    });

    await prisma.templatePackage.create({
      data: {
        templateId: payload.manifest.templateId,
        version: payload.manifest.version,
        title: payload.manifest.title,
        summary: payload.manifest.summary,
        sourceType: payload.manifest.source.type,
        sourceLabel: payload.manifest.source.author ?? null,
        manifestJson: JSON.stringify(payload.manifest),
        compatibilityJson: JSON.stringify(payload.capabilityDescriptors),
        createdBy: input.sourceAuthor ?? null,
      },
    });

    return payload;
  },

  async previewTemplatePayload(input: {
    manifestInput: unknown;
    desiredGroupName: string;
    capabilityDescriptors: Parameters<typeof previewTemplatePackage>[0]['capabilityDescriptors'];
    degradedSkills?: Array<{ slug: string; reason: string }>;
  }) {
    const localProviders = await prisma.llmProvider.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        modelType: true,
        apiProtocol: true,
      },
    });

    const manifest = input.manifestInput as Record<string, unknown>;
    const templateId = typeof manifest.templateId === 'string' ? manifest.templateId : '';
    const version = typeof manifest.version === 'string' ? manifest.version : '';

    const existingImports = templateId && version
      ? await prisma.templateImportRecord.findMany({
        where: { templateId, version },
        select: {
          templateId: true,
          version: true,
        },
      })
      : [];

    const existingGroupNames = await prisma.chatRoom.findMany({
      select: { name: true },
    });

    return previewTemplatePackage({
      manifestInput: input.manifestInput,
      desiredGroupName: input.desiredGroupName,
      existingImports,
      existingGroupNames: existingGroupNames.map((item) => item.name),
      capabilityDescriptors: input.capabilityDescriptors,
      degradedSkills: input.degradedSkills,
      localProviders: localProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        modelType: provider.modelType as 'text' | 'image' | 'audio',
        apiProtocol: provider.apiProtocol as 'anthropic' | 'openai' | 'custom',
      })),
    });
  },

  async importTemplatePayload(input: {
    manifestInput: unknown;
    snapshot: {
      room: {
        name: string;
        description: string | null;
        rules: string | null;
        defaultAgentId: string | null;
        agentTriggerMode: 'auto' | 'manual' | 'coordinator';
      };
      agents: Array<{
        id: string;
        name: string;
        prompt: string;
        type: string;
        acpTool: string | null;
        categoryId?: string | null;
        workDir: string | null;
        proxyConfig: string | null;
        codexModel: string | null;
        codexFastMode?: boolean;
        claudeModel: string | null;
        thinkingMode: string;
        llmProviderId: string | null;
        speechConfig: Record<string, unknown> | null;
        capabilities: Array<{
          capabilityType: 'image' | 'audio';
          enabled: boolean;
          llmProviderId: string | null;
          modelType: 'image' | 'audio';
        }>;
      }>;
      categories: Array<{
        id: string;
        name: string;
        description: string | null;
        sortOrder: number;
      }>;
      cronTasks: Array<{
        id: string;
        name: string;
        payload: string;
      }>;
    };
    skills?: TemplateSkillPackage[];
    skillUsages?: TemplateSkillUsage[];
    degradedSkills?: DegradedTemplateSkill[];
    capabilityDescriptors: Parameters<typeof previewTemplatePackage>[0]['capabilityDescriptors'];
    desiredGroupName: string;
  }) {
    const preview = await this.previewTemplatePayload({
      manifestInput: input.manifestInput,
      desiredGroupName: input.desiredGroupName,
      capabilityDescriptors: input.capabilityDescriptors,
      degradedSkills: input.degradedSkills,
    });

    const plan = buildTemplateImportPlan({
      desiredGroupName: input.desiredGroupName,
      preview,
    });

    const roomId = randomUUID();
    const importedAgentIdsBySource = new Map<string, string>();
    const importedAgentSkillsDirs = new Map<string, string>();
    const createdCategoryIds: string[] = [];
    const importedRoom = await prisma.$transaction(async (tx) => {
      await tx.chatRoom.create({
        data: {
          id: roomId,
          name: plan.finalGroupName,
          description: input.snapshot.room.description,
          rules: input.snapshot.room.rules,
          workDir: null,
          defaultAgentId: null,
          agentTriggerMode: input.snapshot.room.agentTriggerMode,
          updatedAt: new Date(),
        },
      });

      const categoryIdBySource = new Map<string, string | null>();
      for (const category of input.snapshot.categories) {
        const existing = await tx.agentCategory.findUnique({
          where: { name: category.name },
          select: { id: true },
        });

        if (existing) {
          categoryIdBySource.set(category.id, existing.id);
          continue;
        }

        const newCategoryId = randomUUID();
        await tx.agentCategory.create({
          data: {
            id: newCategoryId,
            name: category.name,
            description: category.description,
            sortOrder: category.sortOrder,
          },
        });
        createdCategoryIds.push(newCategoryId);
        categoryIdBySource.set(category.id, newCategoryId);
      }

      for (const agent of input.snapshot.agents) {
        const resolvedTextProvider = preview.compatibility.resolved.find(
          (item) => item.agentRef === agent.id && item.capabilityType === 'text',
        );
        const importedAgentId = randomUUID();
        const finalAgentName = await getAvailableAgentName(tx, agent.name);
        const matchedCategoryId = categoryIdBySource.get(
          agent.categoryId ?? '',
        ) ?? null;
        const importedAgentWorkDir = agent.type === 'builtin'
          ? getImportedBuiltinAgentWorkDir(importedAgentId)
          : null;

        await tx.agent.create({
          data: {
            id: importedAgentId,
            name: finalAgentName,
            prompt: agent.prompt,
            type: agent.type as any,
            acpTool: agent.acpTool,
            workDir: importedAgentWorkDir,
            proxyConfig: null,
            codexModel: agent.codexModel,
            codexFastMode: Boolean(agent.codexFastMode),
            claudeModel: agent.claudeModel,
            thinkingMode: agent.thinkingMode || 'high',
            llmProviderId: resolvedTextProvider?.providerId ?? null,
            speechConfig: serializeAgentSpeechConfig(agent.speechConfig as any),
            categoryId: matchedCategoryId,
            updatedAt: new Date(),
          },
        });

        for (const capability of agent.capabilities) {
          const resolvedCapabilityProvider = preview.compatibility.resolved.find(
            (item) =>
              item.agentRef === agent.id &&
              item.capabilityType === capability.capabilityType,
          );
          await tx.agentCapability.create({
            data: {
              id: randomUUID(),
              agentId: importedAgentId,
              capabilityType: capability.capabilityType as any,
              enabled: capability.enabled,
              llmProviderId: resolvedCapabilityProvider?.providerId ?? null,
            },
          });
        }

        await tx.chatRoomAgent.create({
          data: {
            id: randomUUID(),
            chatRoomId: roomId,
            agentId: importedAgentId,
            role: 'MEMBER',
            injectGroupHistory: true,
          },
        });

        importedAgentIdsBySource.set(agent.id, importedAgentId);
        importedAgentSkillsDirs.set(
          importedAgentId,
          skillInstallService.getAgentSkillsDir({
            id: importedAgentId,
            type: agent.type as any,
            workDir: importedAgentWorkDir,
          }),
        );
      }

      const importedDefaultAgentId = input.snapshot.room.defaultAgentId
        ? importedAgentIdsBySource.get(input.snapshot.room.defaultAgentId) ?? null
        : null;

      if (importedDefaultAgentId) {
        await tx.chatRoom.update({
          where: { id: roomId },
          data: {
            defaultAgentId: importedDefaultAgentId,
            updatedAt: new Date(),
          },
        });
      }

      for (const task of input.snapshot.cronTasks) {
        await tx.cronTask.create({
          data: {
            id: randomUUID(),
            chatRoomId: roomId,
            name: task.name,
            payload: task.payload,
            scheduleType: 'once',
            enabled: false,
            updatedAt: new Date(),
          },
        });
      }

      await tx.templateImportRecord.create({
        data: {
          templateId: preview.manifest.templateId,
          version: preview.manifest.version,
          chatRoomId: roomId,
          importAction: plan.importAction,
          sourceLabel: preview.manifest.source.author ?? null,
          unresolvedCount: plan.unresolvedCount,
          metadataJson: JSON.stringify({
            finalGroupName: plan.finalGroupName,
          }),
        },
      });

      return tx.chatRoom.findUniqueOrThrow({
        where: { id: roomId },
        select: { id: true, name: true },
      });
    });

    // 技能文件写入在事务提交后执行，属于已知设计权衡：若进程在提交后写入前崩溃，
    // 数据库记录存在但技能文件缺失，可通过重新导入恢复。写入失败时会执行数据库回滚。
    if ((input.skills?.length ?? 0) > 0 && (input.skillUsages?.length ?? 0) > 0) {
      try {
        materializeTemplateSkills({
          sharedSkillsDir: getSharedSkillsDir(),
          skills: input.skills ?? [],
          usages: (input.skillUsages ?? [])
            .map((usage) => {
              const importedAgentId = importedAgentIdsBySource.get(usage.agentId);
              if (!importedAgentId) return null;
              return {
                agentId: importedAgentId,
                slug: usage.slug,
              };
            })
            .filter((value): value is { agentId: string; slug: string } => Boolean(value)),
          agentSkillsDirs: importedAgentSkillsDirs,
        });
      } catch (error) {
        await rollbackImportedTemplateArtifacts({
          roomId,
          importedAgentIds: Array.from(importedAgentIdsBySource.values()),
          createdCategoryIds,
          importedAgentSkillsDirs: Array.from(importedAgentSkillsDirs.values()),
        });
        const message = error instanceof Error ? error.message : '技能物化失败';
        throw new Error(`模板包导入失败，已回滚: ${message}`);
      }
    }

    return {
      chatRoomId: importedRoom.id,
      finalGroupName: importedRoom.name,
      importedAgents: importedAgentIdsBySource.size,
      unresolvedCount: plan.unresolvedCount,
      importedSkills: input.skills?.length ?? 0,
    };
  },
};

async function rollbackImportedTemplateArtifacts(input: {
  roomId: string;
  importedAgentIds: string[];
  createdCategoryIds: string[];
  importedAgentSkillsDirs: string[];
}) {
  await prisma.$transaction(async (tx) => {
    await tx.templateImportRecord.deleteMany({
      where: { chatRoomId: input.roomId },
    });

    if (input.importedAgentIds.length > 0) {
      await tx.chatRoomAgent.deleteMany({
        where: { agentId: { in: input.importedAgentIds } },
      });
      await tx.agentCapability.deleteMany({
        where: { agentId: { in: input.importedAgentIds } },
      });
      await tx.agent.deleteMany({
        where: { id: { in: input.importedAgentIds } },
      });
    }

    await tx.chatRoom.deleteMany({
      where: { id: input.roomId },
    });

    for (const categoryId of input.createdCategoryIds) {
      const remainingAgents = await tx.agent.count({
        where: { categoryId },
      });
      if (remainingAgents === 0) {
        await tx.agentCategory.deleteMany({
          where: { id: categoryId },
        });
      }
    }
  });

  for (const skillsDir of input.importedAgentSkillsDirs) {
    fs.rmSync(skillsDir, { recursive: true, force: true });
  }
}

function getImportedBuiltinAgentWorkDir(agentId: string): string {
  return path.join(path.dirname(getSharedSkillsDir()), 'builtin-agents', agentId);
}

async function getAvailableAgentName(tx: any, desiredName: string): Promise<string> {
  const trimmed = desiredName.trim();
  const existingNames: string[] = (
    await tx.agent.findMany({
      where: {
        OR: [
          { name: trimmed },
          { name: { startsWith: `${trimmed}（模板副本 ` } },
        ],
      },
      select: { name: true },
    })
  ).map((row: { name: string }) => row.name);

  if (!existingNames.includes(trimmed)) {
    return trimmed;
  }

  let suffix = 1;
  while (existingNames.includes(`${trimmed}（模板副本 ${suffix}）`)) {
    suffix += 1;
  }
  return `${trimmed}（模板副本 ${suffix}）`;
}

async function resolveTemplateIdForRoom(chatRoomId: string): Promise<string> {
  const importRecord = await prisma.templateImportRecord.findFirst({
    where: { chatRoomId },
    orderBy: { importedAt: 'desc' },
    select: { templateId: true },
  });

  if (importRecord?.templateId) {
    return importRecord.templateId;
  }

  return `tpl-room-${chatRoomId}`;
}
