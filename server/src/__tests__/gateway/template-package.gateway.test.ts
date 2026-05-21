import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { agentService } from '../../core/agent/agent.service.js';
import { chatRoomGateway } from '../../gateway/chatroom.gateway.js';
import { templatePackageGateway } from '../../gateway/template-package.gateway.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import prisma from '../../lib/prisma.js';

function buildTestApp(): FastifyInstance {
  return Fastify();
}

describe('Template Package Gateway API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = buildTestApp();
    await app.register(chatRoomGateway);
    await app.register(templatePackageGateway);
  });

  afterEach(async () => {
    await app.close();
  });

  test('POST /template-packages/export 应返回模板载荷', async () => {
    const agent = await agentService.create({
      name: `Template Export Agent ${Date.now()}`,
      prompt: 'assist template export',
      type: 'acp',
      acpTool: 'claude',
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Export Room ${Date.now()}`,
        workDir: path.join(os.tmpdir(), `teamagentx-template-export-${Date.now()}`),
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: agent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '客服模板',
        packageSummary: '导出测试',
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.manifest.title, '客服模板');
    assert.equal(body.data.snapshot.room.workDir, null);
    assert.ok(Array.isArray(body.data.capabilityDescriptors));
  });

  test('POST /template-packages/export 可按选项排除技能与定时任务', async () => {
    const agent = await agentService.create({
      name: `Template Export Lean Agent ${Date.now()}`,
      prompt: 'assist lean export',
      type: 'builtin',
      workDir: path.join(os.tmpdir(), `teamagentx-template-lean-agent-${Date.now()}`),
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Export Lean Room ${Date.now()}`,
        workDir: path.join(os.tmpdir(), `teamagentx-template-lean-export-${Date.now()}`),
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: agent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);

    const agentSkillDir = path.join(skillInstallService.getAgentSkillsDir(agent), 'browser-use');
    fs.mkdirSync(agentSkillDir, { recursive: true });
    fs.writeFileSync(path.join(agentSkillDir, 'SKILL.md'), '---\nname: Browser Use\n---\nbody', 'utf8');

    await prisma.cronTask.create({
      data: {
        id: `cron-${Date.now()}`,
        chatRoomId: room.id,
        name: '日报任务',
        payload: 'send summary',
        scheduleType: 'once',
        enabled: false,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '精简模板',
        includeSkills: false,
        includeCronTasks: false,
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.manifest.contents.skills, 0);
    assert.equal(body.data.manifest.contents.cronTasks, 0);
    assert.equal(body.data.skills.length, 0);
    assert.equal(body.data.skillUsages.length, 0);
    assert.equal(body.data.snapshot.cronTasks.length, 0);
  });

  test('POST /template-packages/export 对同一群组应生成稳定 templateId', async () => {
    const agent = await agentService.create({
      name: `Template Stable Agent ${Date.now()}`,
      prompt: 'assist stable export',
      type: 'acp',
      acpTool: 'claude',
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Stable Room ${Date.now()}`,
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: agent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);

    const firstExport = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '稳定模板',
      },
    });
    const secondExport = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '稳定模板',
      },
    });

    assert.equal(firstExport.statusCode, 200);
    assert.equal(secondExport.statusCode, 200);
    assert.equal(firstExport.json().data.manifest.templateId, secondExport.json().data.manifest.templateId);
    assert.equal(firstExport.json().data.manifest.templateId, `tpl-room-${room.id}`);
  });

  test('POST /template-packages/preview 应返回冲突与兼容性摘要', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/preview',
      payload: {
        desiredGroupName: '客服模板',
        manifest: {
          schemaVersion: '1.0',
          templateId: 'tpl-preview',
          version: '1.0.0',
          title: '客服模板',
          source: { type: 'local' },
          contents: {
            group: true,
            agents: 1,
            categories: 0,
            skills: 0,
            cronTasks: 0,
          },
        },
        capabilityDescriptors: [
          {
            agentRef: 'agent-1',
            capabilityType: 'text',
            required: true,
            tool: 'claude',
            providerProtocol: 'anthropic',
            modelType: 'text',
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.summary.groupName, '客服模板');
    assert.equal(body.data.summary.agents, 1);
    assert.ok(Array.isArray(body.data.compatibility.resolved));
  });

  test('POST /template-packages/preview 应识别重复模板和未映射能力', async () => {
    const previewManifest = {
      schemaVersion: '1.0',
      templateId: `tpl-preview-duplicate-${Date.now()}`,
      version: '1.0.0',
      title: '客服模板',
      source: { type: 'local' },
      contents: {
        group: true,
        agents: 1,
        categories: 0,
        skills: 0,
        cronTasks: 0,
      },
    };

    await (prisma as any).templateImportRecord.create({
      data: {
        templateId: previewManifest.templateId,
        version: previewManifest.version,
        chatRoomId: `preview-room-${Date.now()}`,
        importAction: 'create_copy',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/preview',
      payload: {
        desiredGroupName: '客服模板',
        manifest: previewManifest,
        capabilityDescriptors: [
          {
            agentRef: 'agent-1',
            capabilityType: 'image',
            required: true,
            tool: null,
            providerProtocol: 'openai',
            modelType: 'image',
          },
        ],
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.conflicts.duplicateTemplate, true);
    assert.equal(body.data.compatibility.unresolved.length, 1);
    assert.equal(body.data.compatibility.unresolved[0]?.capabilityType, 'image');
  });

  test('POST /template-packages/import 应创建新的群组副本', async () => {
    const primaryAgent = await agentService.create({
      name: `Template Import Agent Primary ${Date.now()}`,
      prompt: 'assist template import primary',
      type: 'builtin',
      workDir: path.join(os.tmpdir(), `teamagentx-template-agent-primary-${Date.now()}`),
    });
    const secondaryAgent = await agentService.create({
      name: `Template Import Agent Secondary ${Date.now()}`,
      prompt: 'assist template import secondary',
      type: 'builtin',
      workDir: path.join(os.tmpdir(), `teamagentx-template-agent-secondary-${Date.now()}`),
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Import Room ${Date.now()}`,
        workDir: path.join(os.tmpdir(), `teamagentx-template-import-${Date.now()}`),
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: primaryAgent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);
    const addSecondAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: secondaryAgent.id },
    });
    assert.equal(addSecondAgentResponse.statusCode, 201);

    await prisma.chatRoom.update({
      where: { id: room.id },
      data: {
        defaultAgentId: secondaryAgent.id,
      },
    });

    const agentSkillDir = path.join(skillInstallService.getAgentSkillsDir(primaryAgent), 'browser-use');
    fs.mkdirSync(agentSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentSkillDir, 'SKILL.md'),
      '---\nname: Browser Use\ndescription: Test skill\n---\nbody',
      'utf8',
    );

    const exportResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '客服导入模板',
      },
    });
    assert.equal(exportResponse.statusCode, 200);
    const exported = exportResponse.json().data;

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      payload: {
        manifest: exported.manifest,
        snapshot: exported.snapshot,
        skills: exported.skills,
        skillUsages: exported.skillUsages,
        capabilityDescriptors: exported.capabilityDescriptors,
        desiredGroupName: '客服导入模板',
        duplicateAction: 'create_copy',
      },
    });

    assert.equal(importResponse.statusCode, 200);
    const imported = importResponse.json();
    assert.equal(imported.success, true);
    assert.equal(imported.data.finalGroupName, '客服导入模板');
    assert.ok(imported.data.chatRoomId);
    assert.equal(imported.data.importedAgents, 2);
    assert.equal(imported.data.importedSkills, 1);

    const importedRoom = await prisma.chatRoom.findUniqueOrThrow({
      where: { id: imported.data.chatRoomId },
      include: {
        chatRoomAgents: {
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                prompt: true,
              },
            },
          },
        },
      },
    });

    assert.ok(importedRoom.defaultAgentId);
    const importedDefaultAgent = importedRoom.chatRoomAgents.find(
      (roomAgent) => roomAgent.agentId === importedRoom.defaultAgentId,
    );
    assert.equal(importedDefaultAgent?.agent?.prompt, secondaryAgent.prompt);
  });

  test('POST /template-packages/export 对导入后的群组应沿用原模板 templateId', async () => {
    const sourceAgent = await agentService.create({
      name: `Template ReExport Agent ${Date.now()}`,
      prompt: 'assist template re-export',
      type: 'builtin',
      workDir: path.join(os.tmpdir(), `teamagentx-template-reexport-agent-${Date.now()}`),
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template ReExport Room ${Date.now()}`,
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: sourceAgent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);

    const exportResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '沿用模板',
      },
    });
    assert.equal(exportResponse.statusCode, 200);
    const exported = exportResponse.json().data;

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      payload: {
        manifest: exported.manifest,
        snapshot: exported.snapshot,
        skills: exported.skills,
        skillUsages: exported.skillUsages,
        capabilityDescriptors: exported.capabilityDescriptors,
        desiredGroupName: `沿用模板副本 ${Date.now()}`,
        duplicateAction: 'create_copy',
      },
    });
    assert.equal(importResponse.statusCode, 200);
    const importedRoomId = importResponse.json().data.chatRoomId;

    const reExportResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: importedRoomId,
        packageTitle: '沿用模板再次导出',
      },
    });
    assert.equal(reExportResponse.statusCode, 200);
    assert.equal(reExportResponse.json().data.manifest.templateId, exported.manifest.templateId);
  });

  test('POST /template-packages/import 在技能物化失败时应回滚已导入数据', async () => {
    const agent = await agentService.create({
      name: `Template Failed Import Agent ${Date.now()}`,
      prompt: 'assist template import rollback',
      type: 'builtin',
      workDir: path.join(os.tmpdir(), `teamagentx-template-agent-fail-${Date.now()}`),
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Failed Import Room ${Date.now()}`,
        workDir: path.join(os.tmpdir(), `teamagentx-template-import-fail-${Date.now()}`),
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: agent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);

    const agentSkillDir = path.join(skillInstallService.getAgentSkillsDir(agent), 'browser-use');
    fs.mkdirSync(agentSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentSkillDir, 'SKILL.md'),
      '---\nname: Browser Use\ndescription: Test skill\n---\nbody',
      'utf8',
    );

    const exportResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: `客服失败导入模板 ${Date.now()}`,
      },
    });
    assert.equal(exportResponse.statusCode, 200);
    const exported = exportResponse.json().data;

    const beforeCounts = {
      chatRooms: await prisma.chatRoom.count(),
      agents: await prisma.agent.count(),
      roomAgents: await prisma.chatRoomAgent.count(),
      cronTasks: await prisma.cronTask.count(),
      imports: await (prisma as any).templateImportRecord.count(),
    };

    const sharedSkillsDir = process.env.TEAMAGENTX_SHARED_SKILLS_DIR!;
    fs.rmSync(sharedSkillsDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(sharedSkillsDir), { recursive: true });
    fs.writeFileSync(sharedSkillsDir, 'blocked', 'utf8');

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      payload: {
        manifest: exported.manifest,
        snapshot: exported.snapshot,
        skills: exported.skills,
        skillUsages: exported.skillUsages,
        capabilityDescriptors: exported.capabilityDescriptors,
        desiredGroupName: `客服失败导入模板副本 ${Date.now()}`,
        duplicateAction: 'create_copy',
      },
    });

    assert.equal(importResponse.statusCode, 400);

    const afterCounts = {
      chatRooms: await prisma.chatRoom.count(),
      agents: await prisma.agent.count(),
      roomAgents: await prisma.chatRoomAgent.count(),
      cronTasks: await prisma.cronTask.count(),
      imports: await (prisma as any).templateImportRecord.count(),
    };

    assert.deepEqual(afterCounts, beforeCounts);
  });
});
