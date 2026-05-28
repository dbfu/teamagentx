import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { FastifyInstance } from 'fastify';
import { agentService } from '../../core/agent/agent.service.js';
import { getDefaultChatRoomWorkDir } from '../../core/agent/work-dir.js';
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '../../core/agent/system-assistant.constants.js';
import { chatRoomGateway } from '../../gateway/chatroom.gateway.js';
import { getGroupAssistantDefinition, getGroupCoordinatorDefinition } from '../../scripts/system-agent-definitions.js';
import { syncSystemAgent, syncSystemAgents } from '../../scripts/system-agent-sync.js';

// Helper to build test app
function buildTestApp(): FastifyInstance {
  const app = Fastify();
  return app;
}

describe('ChatRoom Gateway API', () => {
  let app: FastifyInstance;
  let workDirRoot: string;

  beforeEach(async () => {
    app = buildTestApp();
    workDirRoot = path.join(os.tmpdir(), `teamagentx-chatroom-tests-${Date.now()}`);
    await app.register(chatRoomGateway);
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(workDirRoot, { recursive: true, force: true });
  });

  function createGitRepo(name: string): string {
    const repoDir = path.join(workDirRoot, name);
    fs.mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'TeamAgentX Test'], { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir });
    execFileSync('git', ['switch', '-c', 'feature/chat-branch'], { cwd: repoDir });
    execFileSync('git', ['switch', 'main'], { cwd: repoDir });
    return repoDir;
  }

  describe('GET /chatrooms', () => {
    test('应该返回所有聊天室列表', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/chatrooms',
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));
    });
  });

  describe('POST /chatrooms', () => {
    test('应该创建新的聊天室', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Test Room ' + Date.now(),
          workDir: path.join(workDirRoot, 'create-room'),
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data.id);
      assert.ok(body.data.name.startsWith('Test Room'));
      assert.strictEqual(body.data.defaultAgentId, null);
      assert.strictEqual(body.data.agentTriggerMode, 'coordinator');
    });

    test('应该创建包含所有字段的聊天室', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Full Room ' + Date.now(),
          avatar: '🏠',
          avatarColor: '#1890ff',
          description: 'A test chatroom',
          workDir: path.join(workDirRoot, 'full-room'),
        },
      });

      assert.strictEqual(response.statusCode, 201);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.avatar, '🏠');
      assert.strictEqual(body.data.avatarColor, '#1890ff');
      assert.strictEqual(body.data.description, 'A test chatroom');
      assert.strictEqual(body.data.defaultAgentId, null);
    });
  });

  describe('GET /chatrooms/:id', () => {
    test('应该返回 404 当聊天室不存在时', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/chatrooms/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);

      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, '群聊不存在');
    });

    test('应该根据 ID 返回聊天室', async () => {
      // First create a chatroom
      const createResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Find Test ' + Date.now(),
          workDir: path.join(workDirRoot, 'find-room'),
        },
      });
      const created = createResponse.json();

      // Get the chatroom
      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${created.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.id, created.data.id);
    });

    test('应该返回群聊助手的 speechConfig', async () => {
      const createdAgent = await agentService.create({
        name: 'Room Voice Agent ' + Date.now(),
        description: 'Voice test agent',
        prompt: 'Speak in room',
        speechConfig: {
          behavior: {
            enabled: true,
            outputMode: 'manual',
            autoPlay: false,
          },
          profile: {
            provider: 'browser-local',
            voice: 'voice-zh-female-001',
            speed: 1,
            volume: 1,
          },
        },
      });

      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Voice Room ' + Date.now(),
          workDir: path.join(workDirRoot, 'voice-room'),
        },
      });
      assert.strictEqual(chatRoomResponse.statusCode, 201);
      const createdRoom = chatRoomResponse.json();

      const addAgentResponse = await app.inject({
        method: 'POST',
        url: `/chatrooms/${createdRoom.data.id}/agents`,
        payload: {
          agentId: createdAgent.id,
        },
      });
      assert.strictEqual(addAgentResponse.statusCode, 201);

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${createdRoom.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      const roomAgent = body.data.chatRoomAgents.find((item: any) => item.agent?.id === createdAgent.id);
      assert.ok(roomAgent);
      assert.deepStrictEqual(roomAgent.agent.speechConfig, {
        behavior: {
          enabled: true,
          outputMode: 'manual',
          autoPlay: false,
        },
        profile: {
          provider: 'browser-local',
          model: null,
          voice: 'voice-zh-female-001',
          fallbackProvider: null,
          speed: 1,
          volume: 1,
          pitch: null,
          emotion: null,
          style: null,
          format: null,
          sampleRate: null,
          temperature: null,
          prompt: null,
          vendorOptions: null,
        },
      });
    });

    test('应该返回可见群助手但不返回内置协调助手', async () => {
      const systemAgent = await syncSystemAgent(getGroupAssistantDefinition());
      await syncSystemAgents([
        getGroupCoordinatorDefinition(),
      ]);

      await agentService.update(systemAgent.id, {
        speechConfig: {
          behavior: {
            enabled: true,
            outputMode: 'manual',
            autoPlay: false,
          },
          profile: {
            provider: 'browser-local',
            speed: 1,
            volume: 1,
            style: 'professional',
          },
        },
      });

      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'System Voice Room ' + Date.now(),
          workDir: path.join(workDirRoot, 'system-voice-room'),
        },
      });
      assert.strictEqual(chatRoomResponse.statusCode, 201);
      const createdRoom = chatRoomResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${createdRoom.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      const roomAgent = body.data.chatRoomAgents.find((item: any) => item.agent?.id === GROUP_ASSISTANT_ID);
      assert.ok(roomAgent);
      assert.deepStrictEqual(roomAgent.agent.speechConfig, {
        behavior: {
          enabled: true,
          outputMode: 'manual',
          autoPlay: false,
        },
        profile: {
          provider: 'browser-local',
          model: null,
          voice: null,
          fallbackProvider: null,
          speed: 1,
          volume: 1,
          pitch: null,
          emotion: null,
          style: 'professional',
          format: null,
          sampleRate: null,
          temperature: null,
          prompt: null,
          vendorOptions: null,
        },
      });

      const coordinatorAgent = body.data.chatRoomAgents.find((item: any) => item.agent?.id === GROUP_COORDINATOR_ID);
      assert.strictEqual(coordinatorAgent, undefined);
    });
  });

  describe('PUT /chatrooms/:id', () => {
    test('协调模式会清空默认接收助手', async () => {
      await syncSystemAgent(getGroupAssistantDefinition());
      const createdAgent = await agentService.create({
        name: 'Default Receiver ' + Date.now(),
        description: 'Default receiver',
        prompt: 'Handle messages',
      });

      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Coordinator Room ' + Date.now(),
          workDir: path.join(workDirRoot, 'coordinator-room'),
        },
      });
      assert.strictEqual(chatRoomResponse.statusCode, 201);
      const createdRoom = chatRoomResponse.json();
      const addAgentResponse = await app.inject({
        method: 'POST',
        url: `/chatrooms/${createdRoom.data.id}/agents`,
        payload: {
          agentId: createdAgent.id,
        },
      });
      assert.strictEqual(addAgentResponse.statusCode, 201);

      const defaultResponse = await app.inject({
        method: 'PUT',
        url: `/chatrooms/${createdRoom.data.id}`,
        payload: {
          defaultAgentId: createdAgent.id,
          agentTriggerMode: 'auto',
        },
      });
      assert.strictEqual(defaultResponse.statusCode, 200);

      const response = await app.inject({
        method: 'PUT',
        url: `/chatrooms/${createdRoom.data.id}`,
        payload: {
          agentTriggerMode: 'coordinator',
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.defaultAgentId, null);
      assert.strictEqual(body.data.agentTriggerMode, 'coordinator');
    });

    test('不允许系统助手作为默认接收助手', async () => {
      await syncSystemAgent(getGroupAssistantDefinition());

      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'System Default Room ' + Date.now(),
          workDir: path.join(workDirRoot, 'system-default-room'),
        },
      });
      assert.strictEqual(chatRoomResponse.statusCode, 201);
      const createdRoom = chatRoomResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/chatrooms/${createdRoom.data.id}`,
        payload: {
          defaultAgentId: GROUP_ASSISTANT_ID,
          agentTriggerMode: 'auto',
        },
      });

      assert.strictEqual(response.statusCode, 400);
      const body = response.json();
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error, '系统助手不能设为默认接收助手');
    });
  });

  describe('Git branch status', () => {
    test('应该返回绑定 git 工作目录的当前分支和本地分支列表', async () => {
      const repoDir = createGitRepo('status-repo');
      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Git Status Room ' + Date.now(),
          workDir: repoDir,
        },
      });
      const createdRoom = chatRoomResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${createdRoom.data.id}/git-status`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.isGitRepo, true);
      assert.strictEqual(body.data.currentBranch, 'main');
      assert.deepStrictEqual(
        body.data.branches.map((branch: { name: string }) => branch.name).sort(),
        ['feature/chat-branch', 'main']
      );
    });

    test('应该切换绑定 git 工作目录的当前分支', async () => {
      const repoDir = createGitRepo('switch-repo');
      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Git Switch Room ' + Date.now(),
          workDir: repoDir,
        },
      });
      const createdRoom = chatRoomResponse.json();

      const response = await app.inject({
        method: 'POST',
        url: `/chatrooms/${createdRoom.data.id}/git-branch`,
        payload: {
          branch: 'feature/chat-branch',
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.currentBranch, 'feature/chat-branch');
      assert.strictEqual(
        execFileSync('git', ['branch', '--show-current'], { cwd: repoDir, encoding: 'utf8' }).trim(),
        'feature/chat-branch'
      );
    });
  });

  describe('Package scripts', () => {
    test('群聊未设置工作目录时应使用默认目录扫描 package scripts', async () => {
      const originalHome = process.env.HOME;
      const tempHome = path.join(workDirRoot, 'home');
      process.env.HOME = tempHome;

      try {
        const chatRoomResponse = await app.inject({
          method: 'POST',
          url: '/chatrooms',
          payload: {
            name: 'Default Scripts Room ' + Date.now(),
            workDir: null,
          },
        });
        const createdRoom = chatRoomResponse.json();
        const defaultWorkDir = getDefaultChatRoomWorkDir(createdRoom.data.id);

        fs.mkdirSync(defaultWorkDir, { recursive: true });
        fs.writeFileSync(
          path.join(defaultWorkDir, 'package.json'),
          JSON.stringify({ scripts: { dev: 'vite --host 0.0.0.0' } }),
        );

        const response = await app.inject({
          method: 'GET',
          url: `/chatrooms/${createdRoom.data.id}/package-scripts`,
        });

        assert.strictEqual(response.statusCode, 200);
        const body = response.json();
        assert.strictEqual(body.success, true);
        assert.strictEqual(body.data.workDir, defaultWorkDir);
        assert.strictEqual(body.data.hasPackageJson, true);
        assert.deepStrictEqual(
          body.data.scripts.map((script: { name: string }) => script.name),
          ['dev'],
        );
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });

    test('应该递归扫描子目录中的 package scripts', async () => {
      const roomWorkDir = path.join(workDirRoot, 'nested-package-room');
      const nestedPackageDir = path.join(roomWorkDir, 'apps', 'web');
      fs.mkdirSync(nestedPackageDir, { recursive: true });
      fs.writeFileSync(
        path.join(nestedPackageDir, 'package.json'),
        JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }),
      );

      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Nested Package Scripts Room ' + Date.now(),
          workDir: roomWorkDir,
        },
      });
      const createdRoom = chatRoomResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${createdRoom.data.id}/package-scripts`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.hasPackageJson, true);
      assert.deepStrictEqual(
        body.data.scripts.map((script: { name: string; relativeDir: string }) => ({
          name: script.name,
          relativeDir: script.relativeDir,
        })),
        [
          { name: 'dev', relativeDir: path.join('apps', 'web') },
          { name: 'build', relativeDir: path.join('apps', 'web') },
        ],
      );
    });

    test('根目录 package scripts 应排在子目录之前', async () => {
      const roomWorkDir = path.join(workDirRoot, 'root-first-package-room');
      const nestedPackageDir = path.join(roomWorkDir, 'apps', 'web');
      fs.mkdirSync(nestedPackageDir, { recursive: true });
      fs.writeFileSync(
        path.join(roomWorkDir, 'package.json'),
        JSON.stringify({ scripts: { root: 'vite --host 0.0.0.0' } }),
      );
      fs.writeFileSync(
        path.join(nestedPackageDir, 'package.json'),
        JSON.stringify({ scripts: { web: 'vite' } }),
      );

      const chatRoomResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Root First Package Scripts Room ' + Date.now(),
          workDir: roomWorkDir,
        },
      });
      const createdRoom = chatRoomResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/chatrooms/${createdRoom.data.id}/package-scripts`,
      });

      assert.strictEqual(response.statusCode, 200);
      const body = response.json();
      assert.strictEqual(body.success, true);
      assert.deepStrictEqual(
        body.data.scripts.map((script: { name: string; relativeDir: string }) => ({
          name: script.name,
          relativeDir: script.relativeDir,
        })),
        [
          { name: 'root', relativeDir: '' },
          { name: 'web', relativeDir: path.join('apps', 'web') },
        ],
      );
    });
  });

  describe('DELETE /chatrooms/:id', () => {
    test('应该返回 404 当聊天室不存在时', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/chatrooms/non-existent-id',
      });

      assert.strictEqual(response.statusCode, 404);
    });

    test('应该删除聊天室', async () => {
      // First create a chatroom
      const createResponse = await app.inject({
        method: 'POST',
        url: '/chatrooms',
        payload: {
          name: 'Delete Test ' + Date.now(),
          workDir: path.join(workDirRoot, 'delete-room'),
        },
      });
      const created = createResponse.json();

      // Delete the chatroom
      const response = await app.inject({
        method: 'DELETE',
        url: `/chatrooms/${created.data.id}`,
      });

      assert.strictEqual(response.statusCode, 200);

      const body = response.json();
      assert.strictEqual(body.success, true);
    });
  });
});
