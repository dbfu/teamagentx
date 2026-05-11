import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import Fastify from 'fastify';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { config } from './config/index.js';
import { initAgents, clearAllExecutionState } from './core/agent/agent-handler/index.js';
import { ensureAgentCreatorExists } from './scripts/init-agent-creator.js';
import { ensureSkillsHelperExists } from './scripts/init-skills-helper.js';
import { ensureCronTaskHelperExists } from './scripts/init-cron-task-helper.js';
import { ensureChatroomHelperExists } from './scripts/init-chatroom-helper.js';
import { migrateAgentAvatars } from './scripts/migrate-agent-avatars.js';
import { migrateChatRoomAvatars } from './scripts/migrate-chatroom-avatars.js';
import { agentGateway } from './gateway/agent.gateway.js';
import { authGateway } from './gateway/auth.gateway.js';
import { categoryGateway } from './gateway/category.gateway.js';
import { chatRoomGateway } from './gateway/chatroom.gateway.js';
import { llmProviderGateway } from './gateway/llm-provider.gateway.js';
import { skillGateway } from './gateway/skill.gateway.js';
import { cronTaskGateway } from './gateway/cron-task.gateway.js';
import { tokenUsageGateway } from './gateway/token-usage.gateway.js';
import { registerGateways } from './gateway/index.js';
import { messageGateway } from './gateway/message.gateway.js';
import { uploadGateway } from './modules/upload/upload.gateway.js';
import { bridgeGateway } from './gateway/bridge.gateway.js';
import { uploadService } from './modules/upload/upload.service.js';
import { setupSocket } from './socket/index.js';
import { cronSchedulerService } from './core/cron/cron-scheduler.service.js';
import { backgroundTaskManager } from './core/shell/background-task-manager.js';
import { taskQueueService } from './modules/task-queue/task-queue.service.js';
import { checkpointService } from './modules/checkpoint/checkpoint.service.js';
import { registerAllPlatformSenders } from './modules/bridge/platform-senders.js';

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

  // 注册 CORS
  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    strictPreflight: false,
  });

  // 注册静态文件服务（用于图片访问）
  await app.register(staticPlugin, {
    root: path.join(process.cwd(), 'uploads'),
    prefix: '/uploads/',
    maxAge: '7d',
  });

  // 初始化上传目录
  await uploadService.init();

  // 创建 Socket.io
  const io = new Server(app.server, {
    cors: {
      origin: '*',
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
  registerAllPlatformSenders();

  // 注册网关
  await registerGateways(app, [
    authGateway,
    categoryGateway,
    llmProviderGateway,
    agentGateway,
    messageGateway,
    chatRoomGateway,
    skillGateway,
    cronTaskGateway,
    tokenUsageGateway,
    uploadGateway,
    bridgeGateway,
  ]);

  // 确保 LangGraph checkpoint 表存在
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
  await initAgents();

  // 清理所有执行状态（服务重启时中断）
  clearAllExecutionState();

  // 确保助手生成器存在
  await ensureAgentCreatorExists();

  // 确保技能安装助手存在
  await ensureSkillsHelperExists();

  // 确保定时任务助手存在
  await ensureCronTaskHelperExists();

  // 确保群聊管理助手存在
  await ensureChatroomHelperExists();

  // 迁移助手头像为数字索引
  await migrateAgentAvatars();

  // 迁移群聊头像为数字索引
  await migrateChatRoomAvatars();

  // 启动定时任务调度器
  await cronSchedulerService.start();

  // 清理所有运行中的后台任务（服务重启时中断）
  await backgroundTaskManager.cleanupRunningTasks();

  // 设置 Socket.io
  setupSocket(io);

  return { app, io };
}
