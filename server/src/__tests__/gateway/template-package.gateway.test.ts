import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { FastifyInstance } from 'fastify';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { agentService } from '../../core/agent/agent.service.js';
import { GROUP_ASSISTANT_ID } from '../../core/agent/system-assistant.constants.js';
import { chatRoomGateway } from '../../gateway/chatroom.gateway.js';
import { templatePackageGateway } from '../../gateway/template-package.gateway.js';
import { SYSTEM_CATEGORY_ID } from '../../scripts/system-agent-sync.js';
import { skillInstallService } from '../../modules/skill/skill-install.service.js';
import prisma from '../../lib/prisma.js';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(import('@fastify/multipart'));
  return app;
}

function buildMultipartPayload(
  fields: Record<string, string>,
  file?: {
    fieldName: string;
    fileName: string;
    contentType: string;
    content: Uint8Array;
  },
) {
  const boundary = `----teamagentx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  if (file) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(
      Buffer.from(
        `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\n`,
      ),
    );
    chunks.push(Buffer.from(`Content-Type: ${file.contentType}\r\n\r\n`));
    chunks.push(Buffer.from(file.content));
    chunks.push(Buffer.from('\r\n'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    payload: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function parseTemplateZip(buffer: Buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const readJson = <T>(filePath: string): T => {
    const file = files[filePath];
    assert.ok(file, `missing ${filePath}`);
    return JSON.parse(strFromU8(file)) as T;
  };

  return {
    manifest: readJson<any>('manifest.json'),
    snapshot: readJson<any>('snapshot.json'),
    capabilityDescriptors: readJson<any[]>('capability-descriptors.json'),
    skillUsages: readJson<any[]>('skill-usages.json'),
    degradedSkills: readJson<any[]>('degraded-skills.json'),
    files,
  };
}

function buildTemplateZip(input: {
  manifest: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  capabilityDescriptors?: unknown[];
  skillUsages?: unknown[];
  degradedSkills?: unknown[];
  skillFiles?: Record<string, string>;
}) {
  const entries: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(input.manifest, null, 2)),
    'snapshot.json': strToU8(JSON.stringify(input.snapshot, null, 2)),
    'capability-descriptors.json': strToU8(JSON.stringify(input.capabilityDescriptors ?? [], null, 2)),
    'skill-usages.json': strToU8(JSON.stringify(input.skillUsages ?? [], null, 2)),
    'degraded-skills.json': strToU8(JSON.stringify(input.degradedSkills ?? [], null, 2)),
  };

  for (const [filePath, content] of Object.entries(input.skillFiles ?? {})) {
    entries[filePath] = strToU8(content);
  }

  return Buffer.from(zipSync(entries));
}

describe('Template Package Gateway API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
    await app.register(chatRoomGateway);
    await app.register(templatePackageGateway);
  });

  afterEach(async () => {
    await app.close();
  });

  test('POST /template-packages/export 应返回群组模板 ZIP', async () => {
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
    assert.match(response.headers['content-type'] ?? '', /application\/zip/);

    const exported = parseTemplateZip(response.rawPayload);
    assert.equal(exported.manifest.title, '客服模板');
    assert.equal(exported.snapshot.room.workDir, null);
    assert.ok(Array.isArray(exported.capabilityDescriptors));
  });

  test('POST /template-packages/export 默认包含全部技能与定时任务', async () => {
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
        description: '每天上午九点执行',
        payload: 'send summary',
        scheduleType: 'cron',
        cronExpression: '0 9 * * *',
        agentIds: JSON.stringify([agent.id]),
        enabled: true,
        maxRetries: 5,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '精简模板',
      },
    });

    assert.equal(response.statusCode, 200);
    const exported = parseTemplateZip(response.rawPayload);
    assert.equal(exported.manifest.contents.skills, 1);
    assert.equal(exported.manifest.contents.cronTasks, 1);
    assert.equal(exported.skillUsages.length, 1);
    assert.equal(exported.snapshot.cronTasks.length, 1);
    assert.equal(exported.snapshot.cronTasks[0]?.scheduleType, 'cron');
    assert.equal(exported.snapshot.cronTasks[0]?.cronExpression, '0 9 * * *');
    assert.deepEqual(exported.snapshot.cronTasks[0]?.agentIds, [agent.id]);
    assert.equal(exported.snapshot.cronTasks[0]?.enabled, true);
    assert.equal(exported.snapshot.cronTasks[0]?.maxRetries, 5);
    assert.ok(exported.files['skills/browser-use/SKILL.md']);
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
        workDir: path.join(os.tmpdir(), `teamagentx-template-stable-${Date.now()}`),
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
    const firstZip = parseTemplateZip(firstExport.rawPayload);
    const secondZip = parseTemplateZip(secondExport.rawPayload);
    assert.equal(firstZip.manifest.templateId, secondZip.manifest.templateId);
    assert.equal(firstZip.manifest.templateId, `tpl-room-${room.id}`);
  });

  test('POST /template-packages/export 不应包含系统群助手', async () => {
    const agent = await agentService.create({
      name: `Template Export Business Agent ${Date.now()}`,
      prompt: 'assist export without system agent',
      type: 'builtin',
      workDir: path.join(os.tmpdir(), `teamagentx-template-business-agent-${Date.now()}`),
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Export No System Room ${Date.now()}`,
        workDir: path.join(os.tmpdir(), `teamagentx-template-no-system-${Date.now()}`),
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
        packageTitle: '排除系统助手模板',
      },
    });

    assert.equal(response.statusCode, 200);
    const exported = parseTemplateZip(response.rawPayload);
    assert.equal(exported.snapshot.agents.some((item: { id: string }) => item.id === GROUP_ASSISTANT_ID), false);
    assert.equal(exported.snapshot.agents.length, 1);
  });

  test('POST /template-packages/export 不应包含历史导入的群助手模板副本', async () => {
    await prisma.agentCategory.upsert({
      where: { id: SYSTEM_CATEGORY_ID },
      update: {},
      create: {
        id: SYSTEM_CATEGORY_ID,
        name: '系统',
        description: '系统内置助手，不可删除',
        sortOrder: -1000,
      },
    });

    const dirtyAgent = await agentService.create({
      name: `群助手（模板副本 ${Date.now()}）`,
      prompt: 'dirty group assistant copy',
      type: 'acp',
      acpTool: 'claude',
      categoryId: SYSTEM_CATEGORY_ID,
    });

    const roomResponse = await app.inject({
      method: 'POST',
      url: '/chatrooms',
      payload: {
        name: `Template Export Dirty System Room ${Date.now()}`,
        workDir: path.join(os.tmpdir(), `teamagentx-template-dirty-system-${Date.now()}`),
      },
    });
    assert.equal(roomResponse.statusCode, 201);
    const room = roomResponse.json().data;

    const addAgentResponse = await app.inject({
      method: 'POST',
      url: `/chatrooms/${room.id}/agents`,
      payload: { agentId: dirtyAgent.id },
    });
    assert.equal(addAgentResponse.statusCode, 201);

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '排除脏系统副本模板',
      },
    });

    assert.equal(response.statusCode, 200);
    const exported = parseTemplateZip(response.rawPayload);
    assert.equal(exported.snapshot.agents.some((item: { id: string }) => item.id === dirtyAgent.id), false);
    assert.equal(exported.snapshot.categories.some((item: { id: string }) => item.id === SYSTEM_CATEGORY_ID), false);
  });

  test('POST /template-packages/preview 应返回冲突与兼容性摘要', async () => {
    const zipBuffer = buildTemplateZip({
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
      snapshot: {
        room: {
          name: '客服模板',
          description: null,
          rules: null,
          defaultAgentId: null,
          agentTriggerMode: 'auto',
        },
        agents: [],
        categories: [],
        cronTasks: [],
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
      degradedSkills: [
        {
          slug: 'broken-skill',
          reason: 'SKILL.md not found',
        },
      ],
    });

    const multipart = buildMultipartPayload(
      { desiredGroupName: '客服模板' },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: zipBuffer,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/preview',
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.summary.groupName, '客服模板');
    assert.equal(body.data.summary.agents, 1);
    assert.ok(Array.isArray(body.data.compatibility.resolved));
    assert.deepEqual(body.data.degradedSkills, [{ slug: 'broken-skill', reason: 'SKILL.md not found' }]);
  });

  test('POST /template-packages/preview 应识别名称冲突和未映射能力', async () => {
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

    await prisma.chatRoom.create({
      data: {
        id: `preview-room-${Date.now()}`,
        name: '客服模板',
        updatedAt: new Date(),
      },
    });

    const zipBuffer = buildTemplateZip({
      manifest: previewManifest,
      snapshot: {
        room: {
          name: '客服模板',
          description: null,
          rules: null,
          defaultAgentId: null,
          agentTriggerMode: 'auto',
        },
        agents: [],
        categories: [],
        cronTasks: [],
      },
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
    });
    const multipart = buildMultipartPayload(
      { desiredGroupName: '客服模板' },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: zipBuffer,
      },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/template-packages/preview',
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.conflicts.nameConflict, true);
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

    await prisma.cronTask.create({
      data: {
        id: `cron-import-${Date.now()}`,
        chatRoomId: room.id,
        name: '客服日报',
        description: '工作日早上推送',
        payload: 'send support summary',
        scheduleType: 'cron',
        cronExpression: '0 10 * * 1-5',
        agentIds: JSON.stringify([primaryAgent.id, secondaryAgent.id]),
        enabled: true,
        maxRetries: 7,
      },
    });

    const exportResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/export',
      payload: {
        chatRoomId: room.id,
        packageTitle: '客服导入模板',
      },
    });
    assert.equal(exportResponse.statusCode, 200);
    const exported = parseTemplateZip(exportResponse.rawPayload);
    const multipart = buildMultipartPayload(
      { desiredGroupName: '客服导入模板' },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: exportResponse.rawPayload,
      },
    );

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
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

    const importedCronTasks = await prisma.cronTask.findMany({
      where: { chatRoomId: importedRoom.id },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(importedCronTasks.length, 1);
    assert.equal(importedCronTasks[0]?.name, '客服日报');
    assert.equal(importedCronTasks[0]?.description, '工作日早上推送');
    assert.equal(importedCronTasks[0]?.scheduleType, 'cron');
    assert.equal(importedCronTasks[0]?.cronExpression, '0 10 * * 1-5');
    assert.equal(importedCronTasks[0]?.enabled, true);
    assert.equal(importedCronTasks[0]?.maxRetries, 7);
    assert.ok(importedCronTasks[0]?.nextRunAt);
    const importedAgentIds = importedRoom.chatRoomAgents.map((roomAgent) => roomAgent.agentId).sort();
    assert.deepEqual(JSON.parse(importedCronTasks[0]?.agentIds ?? '[]').sort(), importedAgentIds);
  });

  test('POST /template-packages/import 应忽略模板中的系统群助手', async () => {
    const zipBuffer = buildTemplateZip({
      manifest: {
        schemaVersion: '1.0',
        templateId: `tpl-ignore-system-${Date.now()}`,
        version: '1.0.0',
        title: '忽略系统群助手模板',
        source: { type: 'local' },
        contents: {
          group: true,
          agents: 2,
          categories: 0,
          skills: 0,
          cronTasks: 0,
        },
      },
      snapshot: {
        room: {
          name: '忽略系统群助手模板',
          description: null,
          rules: null,
          defaultAgentId: GROUP_ASSISTANT_ID,
          agentTriggerMode: 'auto',
        },
        agents: [
          {
            id: GROUP_ASSISTANT_ID,
            name: '群助手',
            prompt: 'system assistant',
            type: 'acp',
            acpTool: 'claude',
            categoryId: null,
            workDir: null,
            proxyConfig: null,
            codexModel: null,
            claudeModel: null,
            thinkingMode: 'high',
            llmProviderId: null,
            speechConfig: null,
            capabilities: [],
          },
          {
            id: 'business-agent-1',
            name: '业务助手',
            prompt: 'business assistant',
            type: 'builtin',
            acpTool: null,
            categoryId: null,
            workDir: null,
            proxyConfig: null,
            codexModel: null,
            claudeModel: null,
            thinkingMode: 'high',
            llmProviderId: null,
            speechConfig: null,
            capabilities: [],
          },
        ],
        categories: [],
        cronTasks: [],
      },
      capabilityDescriptors: [],
    });

    const multipart = buildMultipartPayload(
      { desiredGroupName: '忽略系统群助手模板' },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: zipBuffer,
      },
    );

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
    });

    assert.equal(importResponse.statusCode, 200);
    const imported = importResponse.json();
    assert.equal(imported.data.importedAgents, 1);

    const importedRoom = await prisma.chatRoom.findUniqueOrThrow({
      where: { id: imported.data.chatRoomId },
      include: {
        chatRoomAgents: {
          include: {
            agent: true,
          },
        },
      },
    });

    assert.equal(importedRoom.defaultAgentId, null);
    assert.equal(importedRoom.chatRoomAgents.some((item) => item.agentId === GROUP_ASSISTANT_ID), false);
    assert.equal(importedRoom.chatRoomAgents.filter((item) => item.agent?.agentLevel !== 'system').length, 1);
  });

  test('POST /template-packages/import 应忽略模板中的群助手模板副本', async () => {
    await prisma.agentCategory.upsert({
      where: { id: SYSTEM_CATEGORY_ID },
      update: {},
      create: {
        id: SYSTEM_CATEGORY_ID,
        name: '系统',
        description: '系统内置助手，不可删除',
        sortOrder: -1000,
      },
    });

    const zipBuffer = buildTemplateZip({
      manifest: {
        schemaVersion: '1.0',
        templateId: `tpl-ignore-dirty-system-${Date.now()}`,
        version: '1.0.0',
        title: '忽略脏系统副本模板',
        source: { type: 'local' },
        contents: {
          group: true,
          agents: 2,
          categories: 1,
          skills: 0,
          cronTasks: 0,
        },
      },
      snapshot: {
        room: {
          name: '忽略脏系统副本模板',
          description: null,
          rules: null,
          defaultAgentId: 'dirty-group-assistant-copy',
          agentTriggerMode: 'auto',
        },
        agents: [
          {
            id: 'dirty-group-assistant-copy',
            name: '群助手（模板副本 1）',
            prompt: 'dirty group assistant copy',
            type: 'acp',
            acpTool: 'claude',
            categoryId: SYSTEM_CATEGORY_ID,
            workDir: null,
            proxyConfig: null,
            codexModel: null,
            claudeModel: null,
            thinkingMode: 'high',
            llmProviderId: null,
            speechConfig: null,
            capabilities: [],
          },
          {
            id: 'business-agent-2',
            name: '业务助手二',
            prompt: 'business assistant',
            type: 'builtin',
            acpTool: null,
            categoryId: null,
            workDir: null,
            proxyConfig: null,
            codexModel: null,
            claudeModel: null,
            thinkingMode: 'high',
            llmProviderId: null,
            speechConfig: null,
            capabilities: [],
          },
        ],
        categories: [
          {
            id: SYSTEM_CATEGORY_ID,
            name: '系统',
            description: '系统内置助手，不可删除',
            sortOrder: -1000,
          },
        ],
        cronTasks: [],
      },
      capabilityDescriptors: [],
    });

    const multipart = buildMultipartPayload(
      { desiredGroupName: '忽略脏系统副本模板' },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: zipBuffer,
      },
    );

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
    });

    assert.equal(importResponse.statusCode, 200);
    const imported = importResponse.json();
    assert.equal(imported.data.importedAgents, 1);

    const importedRoom = await prisma.chatRoom.findUniqueOrThrow({
      where: { id: imported.data.chatRoomId },
      include: {
        chatRoomAgents: {
          include: {
            agent: true,
          },
        },
      },
    });
    assert.equal(
      importedRoom.chatRoomAgents.some((item) => item.agent?.name.startsWith('群助手（模板副本')),
      false,
    );
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
        workDir: path.join(os.tmpdir(), `teamagentx-template-reexport-${Date.now()}`),
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
    const exported = parseTemplateZip(exportResponse.rawPayload);
    const multipart = buildMultipartPayload(
      { desiredGroupName: `沿用模板副本 ${Date.now()}` },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: exportResponse.rawPayload,
      },
    );

    const importResponse = await app.inject({
      method: 'POST',
      url: '/template-packages/import',
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
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
    const reExported = parseTemplateZip(reExportResponse.rawPayload);
    assert.equal(reExported.manifest.templateId, exported.manifest.templateId);
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
    const multipart = buildMultipartPayload(
      { desiredGroupName: `客服失败导入模板副本 ${Date.now()}` },
      {
        fieldName: 'template',
        fileName: 'group-template.zip',
        contentType: 'application/zip',
        content: exportResponse.rawPayload,
      },
    );

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
      headers: {
        'content-type': multipart.contentType,
      },
      payload: multipart.payload,
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
