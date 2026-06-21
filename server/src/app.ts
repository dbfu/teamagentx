import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { config } from './config/index.js';
import { initAgents, clearAllExecutionState } from './core/agent/agent-handler/index.js';
import { ensureGroupAssistantExists } from './scripts/init-group-assistant.js';
import { migrateAgentAvatars } from './scripts/migrate-agent-avatars.js';
import { migrateChatRoomAvatars } from './scripts/migrate-chatroom-avatars.js';
import { migrateSiliconflowVoiceIds } from './scripts/migrate-siliconflow-voice-ids.js';
import { agentGateway } from './gateway/agent.gateway.js';
import { authGateway } from './gateway/auth.gateway.js';
import { categoryGateway } from './gateway/category.gateway.js';
import { chatRoomGateway } from './gateway/chatroom.gateway.js';
import { llmProviderGateway } from './gateway/llm-provider.gateway.js';
import { connectorGateway } from './gateway/connector.gateway.js';
import { speechGateway } from './gateway/speech.gateway.js';
import { skillGateway } from './gateway/skill.gateway.js';
import { cronTaskGateway } from './gateway/cron-task.gateway.js';
import { chatRoomCommandGateway } from './gateway/chatroom-command.gateway.js';
import { tokenUsageGateway } from './gateway/token-usage.gateway.js';
import { internalAgentToolsGateway } from './gateway/internal-agent-tools.gateway.js';
import { codexRouterGateway } from './gateway/codex-router.gateway.js';
import { registerGateways } from './gateway/index.js';
import { messageGateway } from './gateway/message.gateway.js';
import { uploadGateway } from './modules/upload/upload.gateway.js';
import { bridgeGateway, handleBindCode } from './gateway/bridge.gateway.js';
import { templatePackageGateway } from './gateway/template-package.gateway.js';
import { workbenchGateway } from './gateway/workbench.gateway.js';
import { setFeishuBindCodeHandler } from './modules/bridge/feishu-ws-client.js';
import { setDingtalkBindCodeHandler } from './modules/bridge/dingtalk-stream-client.js';
import { uploadService } from './modules/upload/upload.service.js';
import { setupGateway } from './gateway/setup.gateway.js';
import { appSettingGateway } from './gateway/app-setting.gateway.js';
import { setupSocket } from './socket/index.js';
import { cronSchedulerService } from './core/cron/cron-scheduler.service.js';
import { diaryScheduler } from './core/agent/diary-scheduler.service.js';
import { backgroundTaskManager } from './core/shell/background-task-manager.js';
import { taskQueueService } from './modules/task-queue/task-queue.service.js';
import { checkpointService } from './modules/checkpoint/checkpoint.service.js';
import { registerBridgePlatformAdapters } from './modules/bridge/platform-senders.js';
import { initDb } from './lib/prisma.js';
import { syncAllBridgeBotsRuntime } from './modules/bridge/bridge-runtime-sync.js';
import { startLocalUserWatcher } from './modules/auth/local-user-watcher.js';
import { authHook } from './modules/auth/auth.middleware.js';
import { authService } from './modules/auth/auth.service.js';
import { getWebDistDir } from './lib/web-static.js';

/**
 * 解析 CORS allow-origin 配置：
 * - 未设置或为 '*' → 通配（保持现状；单容器同源访问本不依赖 CORS）。
 * - 逗号分隔的多个源 → 数组（公网部署收紧）。
 */
function resolveCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === '*') return '*';
  const origins = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return origins.length === 1 ? origins[0] : origins;
}

function findLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];

  for (const addresses of Object.values(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family === 'IPv4' && !address.internal) {
        ips.push(address.address);
      }
    }
  }

  return ips;
}

export async function createApp(options?: { enableSwagger?: boolean }) {
  const app = Fastify({ logger: true });
  const enableSwagger = options?.enableSwagger ?? process.env.ELECTRON !== 'true';

  // 注册 CORS（默认通配，可由 CORS_ORIGIN 收紧）
  await app.register(cors, {
    origin: resolveCorsOrigin(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    strictPreflight: false,
  });

  // 注册静态文件服务（用于图片访问）
  await app.register(staticPlugin, {
    root: uploadService.getStaticRootDir(),
    prefix: '/uploads/',
    maxAge: '7d',
  });

  // 单容器部署：托管前端 SPA 构建产物（apps/web/dist）。
  // 开发模式下产物不存在则跳过，保持 Vite 独立 serve 行为。
  const webDistDir = getWebDistDir();
  if (webDistDir) {
    await app.register(staticPlugin, {
      root: webDistDir,
      prefix: '/',
      wildcard: false,
      decorateReply: false, // 复用 /uploads/ 注册时装饰的 reply.sendFile
      maxAge: '7d',
    });

    // 前端路由回退：未命中静态文件/后端路由的 GET 返回 index.html，其余仍 404。
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET') {
        return reply.sendFile('index.html', webDistDir);
      }
      return reply.code(404).send({ success: false, error: 'Not Found', code: 'NOT_FOUND' });
    });

    console.log(`[Startup] 已启用前端 SPA 托管：${webDistDir}`);
  }

  // 注册 multipart（供上传和语音 STT 接口共用）
  await app.register(import('@fastify/multipart'), {
    limits: {
      fileSize: 25 * 1024 * 1024, // 25MB，覆盖图片上传（10MB）和音频 STT（25MB）
      files: 80,
    },
  });

  // 初始化数据库（WAL 模式 + busy_timeout 避免并发写锁）
  await initDb();

  // 单容器 / 独立部署：用环境变量预置本地账号（AUTH_USERNAME / AUTH_PASSWORD），
  // 启动即建好账号，避免「服务起来后被他人抢先注册占用唯一账号」。改 env 重启后口令即生效。
  await authService.seedLocalUserFromEnv();

  // 初始化上传目录
  await uploadService.init();

  // 添加认证钩子（验证所有非公开接口的 JWT token）
  app.addHook('onRequest', authHook);

  // 创建 Socket.io
  const io = new Server(app.server, {
    cors: {
      origin: resolveCorsOrigin(),
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  // 将 io 实例装饰到 app 上，供 gateway 使用
  app.decorate('io', io);

  // 健康检查
  app.get(
    '/health',
    async () => ({ status: 'ok', timestamp: new Date().toISOString() }),
  );

  app.get(
    '/network-info',
    async () => {
      const localIps = findLocalIps();
      return {
        localIp: localIps[0] ?? null,
        localIps,
      };
    },
  );

  // 注册平台消息发送器
  registerBridgePlatformAdapters();

  // 注册网关
  await registerGateways(app, [
    authGateway,
    setupGateway,
    appSettingGateway,
    categoryGateway,
    llmProviderGateway,
    connectorGateway,
    agentGateway,
    messageGateway,
    chatRoomGateway,
    speechGateway,
    skillGateway,
    cronTaskGateway,
    chatRoomCommandGateway,
    tokenUsageGateway,
    internalAgentToolsGateway,
    codexRouterGateway,
    uploadGateway,
    bridgeGateway,
    templatePackageGateway,
    workbenchGateway,
  ]);

  // 确保历史 checkpoint 表存在
  await checkpointService.ensureTablesExist();

  // 标记所有 executing 状态的 Agent 任务为 interrupted（服务重启时保留）
  const executingInterrupted = await taskQueueService.markAsInterrupted();
  if (executingInterrupted > 0) {
    console.log(`[Startup] 已标记 ${executingInterrupted} 个执行中的 Agent 任务为中断状态`);
  }

  // 标记所有 pending 状态的任务为 interrupted（服务重启时保留）
  const pendingInterrupted = await taskQueueService.markPendingAsInterrupted();
  if (pendingInterrupted > 0) {
    console.log(`[Startup] 已标记 ${pendingInterrupted} 个待处理的 Agent 任务为中断状态`);
  }

  console.log(`[Startup] 任务队列初始化完成，共有 ${executingInterrupted + pendingInterrupted} 个任务需要恢复`);

  // 初始化 Agent（内部会清理执行状态，但不再清空任务队列）
  await migrateSiliconflowVoiceIds();
  await initAgents();

  // 清理所有执行状态（服务重启时中断）
  clearAllExecutionState();

  // 确保唯一系统群助手存在，并删除旧版 5 个系统助手
  await ensureGroupAssistantExists();

  // 迁移助手头像为数字索引
  await migrateAgentAvatars();

  // 迁移群聊头像为数字索引
  await migrateChatRoomAvatars();

  // 启动定时任务调度器
  await cronSchedulerService.start();

  // 启动助手日记调度器（每日 0 点；功能受全局开关控制）
  diaryScheduler.start();

  // 外部平台运行时初始化
  setFeishuBindCodeHandler(handleBindCode);
  setDingtalkBindCodeHandler(handleBindCode);
  await syncAllBridgeBotsRuntime(app.log);

  // 清理所有运行中的后台任务（服务重启时中断）
  await backgroundTaskManager.cleanupRunningTasks();

  // 设置 Socket.io
  setupSocket(io);

  // 启动本地用户配置文件监听（密码变更推送）
  startLocalUserWatcher(io);

  return { app, io };
}
