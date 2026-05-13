import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import { cronTaskService } from '../../../modules/cron-task/cron-task.service.js';
import { cronSchedulerService } from '../../cron/cron-scheduler.service.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';

// 定时任务助手的专用 ID
export const CRON_TASK_HELPER_AGENT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// 列出所有群聊工具
export const listChatRoomsForCronTool = tool(
  async () => {
    try {
      const chatRooms = await chatRoomService.findAll();

      if (chatRooms.length === 0) {
        return '暂无群聊';
      }

      const formattedList = chatRooms
        .map(
          (cr) =>
            `**${cr.name}** (ID: ${cr.id})\n描述: ${cr.description || '无'}`,
        )
        .join('\n\n');

      return `群聊列表（共 ${chatRooms.length} 个）：\n\n${formattedList}`;
    } catch (error) {
      return `获取群聊列表失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'list_chatrooms',
    description: '列出所有群聊，供用户选择目标群聊',
    schema: z.object({}),
  },
);

// 创建定时任务工具
export const createCronTaskTool = tool(
  async ({
    chatRoomId,
    name,
    description,
    scheduleType,
    cronExpression,
    intervalMinutes,
    scheduledAt,
    payload,
    agentIds,
    enabled,
    maxRetries,
  }: {
    chatRoomId: string;
    name: string;
    description?: string;
    scheduleType: 'cron' | 'interval' | 'once';
    cronExpression?: string;
    intervalMinutes?: number;
    scheduledAt?: string;
    payload: string;
    agentIds?: string[];
    enabled?: boolean;
    maxRetries?: number;
  }) => {
    try {
      // 验证调度参数
      if (scheduleType === 'cron' && !cronExpression) {
        return 'cron 类型需要提供 cronExpression 参数';
      }
      if (scheduleType === 'interval' && !intervalMinutes) {
        return 'interval 类型需要提供 intervalMinutes 参数';
      }
      if (scheduleType === 'once' && !scheduledAt) {
        return 'once 类型需要提供 scheduledAt 参数';
      }

      const task = await cronTaskService.create({
        chatRoomId,
        name,
        description,
        scheduleType: scheduleType as any,
        cronExpression,
        intervalMinutes,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        payload,
        agentIds,
        enabled: enabled ?? true,
        maxRetries: maxRetries ?? 3,
      });

      // 如果任务启用，启动调度
      if (task.enabled) {
        await cronSchedulerService.reloadTask(task.id);
      }

      // 解析 agentIds 显示触发的助手
      let agentInfo = '';
      if (agentIds && agentIds.length > 0) {
        if (agentIds.includes('*')) {
          agentInfo = '\n- 触发助手: 所有助手';
        } else {
          agentInfo = `\n- 触发助手: ${agentIds.length} 个助手（系统会自动添加 @助手名）`;
        }
      }

      return `定时任务创建成功！
- 任务名称: ${task.name}
- 任务 ID: ${task.id}
- 调度类型: ${task.scheduleType}
- 下次执行: ${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString('zh-CN') : '未安排'}
- 执行内容: ${task.payload}${agentInfo}`;
    } catch (error) {
      return `创建定时任务失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'create_cron_task',
    description:
      '创建定时任务。可以选择触发的助手，系统会自动在消息前添加 @助手名。',
    schema: z.object({
      chatRoomId: z.string().describe('群聊 ID'),
      name: z.string().describe('任务名称'),
      description: z.string().optional().describe('任务描述'),
      scheduleType: z.enum(['cron', 'interval', 'once']).describe('调度类型'),
      cronExpression: z
        .string()
        .optional()
        .describe(
          'Cron 表达式（scheduleType=cron 时必填），格式：分钟 小时 日 月 星期',
        ),
      intervalMinutes: z
        .number()
        .optional()
        .describe('间隔分钟数（scheduleType=interval 时必填）'),
      scheduledAt: z
        .string()
        .optional()
        .describe('执行时间（scheduleType=once 时必填），ISO 格式日期字符串'),
      payload: z
        .string()
        .describe('执行内容，发送的消息。系统会根据 agentIds 自动添加 @助手名'),
      agentIds: z
        .array(z.string())
        .optional()
        .describe(
          '要触发的助手 ID 列表。传入 ["*"] 表示所有助手（排除系统内置助手），传入具体助手 ID 表示指定助手',
        ),
      enabled: z.boolean().optional().describe('是否立即启用，默认 true'),
      maxRetries: z.number().optional().describe('最大重试次数，默认 3'),
    }),
  },
);

// 列出群聊的定时任务工具
export const listCronTasksTool = tool(
  async ({ chatRoomId }: { chatRoomId?: string }) => {
    try {
      // 如果指定了 chatRoomId，列出该群聊的任务
      // 如果不传 chatRoomId，列出所有群聊的任务
      let tasks: any[];

      if (chatRoomId) {
        tasks = await cronTaskService.findByChatRoom(chatRoomId);
        if (tasks.length === 0) {
          return '该群聊暂无定时任务。';
        }
      } else {
        // 列出所有群聊的任务
        tasks = await cronTaskService.findAll();
        if (tasks.length === 0) {
          return '暂无定时任务。';
        }
      }

      return tasks
        .map(
          (t) => `任务名称: ${t.name}
- 所属群聊: ${t.chatRoom?.name || '未知'} (ID: ${t.chatRoomId})
- ID: ${t.id}
- 调度: ${t.scheduleType}${t.scheduleType === 'cron' ? ` (${t.cronExpression})` : t.scheduleType === 'interval' ? ` (每${t.intervalMinutes}分钟)` : ''}
- 状态: ${t.enabled ? '已启用' : '已禁用'}
- 下次执行: ${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString('zh-CN') : '未安排'}
- 执行内容: ${t.payload}`,
        )
        .join('\n\n');
    } catch (error) {
      return `获取定时任务列表失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'list_cron_tasks',
    description:
      '列出定时任务。如果指定 chatRoomId 则列出该群聊的任务，如果不指定则列出所有群聊的任务。',
    schema: z.object({
      chatRoomId: z
        .string()
        .optional()
        .describe('群聊 ID（可选）。不传则列出所有群聊的定时任务'),
    }),
  },
);

// 删除定时任务工具
export const deleteCronTaskTool = tool(
  async ({taskId}: {taskId: string}) => {
    try {
      // 先取消调度
      await cronSchedulerService.unscheduleTask(taskId);
      // 再删除任务
      await cronTaskService.delete(taskId);
      return `定时任务 ${taskId} 已删除。`;
    } catch (error) {
      return `删除定时任务失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'delete_cron_task',
    description: '删除指定的定时任务。',
    schema: z.object({
      taskId: z.string().describe('要删除的任务 ID'),
    }),
  },
);

// 启用/禁用定时任务工具
export const toggleCronTaskTool = tool(
  async ({taskId, enabled}: {taskId: string; enabled: boolean}) => {
    try {
      const task = await cronTaskService.findById(taskId);
      if (!task) {
        return `定时任务 ${taskId} 不存在。`;
      }

      await cronTaskService.setEnabled(taskId, enabled);

      if (enabled) {
        // 启用时，重新调度
        await cronSchedulerService.reloadTask(taskId);
        return `定时任务 "${task.name}" 已启用。`;
      } else {
        // 禁用时，取消调度
        await cronSchedulerService.unscheduleTask(taskId);
        return `定时任务 "${task.name}" 已禁用。`;
      }
    } catch (error) {
      return `切换定时任务状态失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'toggle_cron_task',
    description: '启用或禁用指定的定时任务。',
    schema: z.object({
      taskId: z.string().describe('要操作的任务 ID'),
      enabled: z.boolean().describe('true 表示启用任务，false 表示禁用任务'),
    }),
  },
);

// 修改定时任务工具
export const updateCronTaskTool = tool(
  async ({
    taskId,
    name,
    description,
    scheduleType,
    cronExpression,
    intervalMinutes,
    scheduledAt,
    payload,
    agentIds,
  }: {
    taskId: string;
    name?: string;
    description?: string;
    scheduleType?: 'cron' | 'interval' | 'once';
    cronExpression?: string;
    intervalMinutes?: number;
    scheduledAt?: string;
    payload?: string;
    agentIds?: string[];
  }) => {
    try {
      const task = await cronTaskService.findById(taskId);
      if (!task) {
        return `定时任务 ${taskId} 不存在。`;
      }

      const updateData: any = {};
      if (name) updateData.name = name;
      if (description) updateData.description = description;
      if (scheduleType) updateData.scheduleType = scheduleType;
      if (cronExpression) updateData.cronExpression = cronExpression;
      if (intervalMinutes) updateData.intervalMinutes = intervalMinutes;
      if (scheduledAt) updateData.scheduledAt = new Date(scheduledAt);
      if (payload) updateData.payload = payload;
      if (agentIds) updateData.agentIds = agentIds;

      if (Object.keys(updateData).length === 0) {
        return `未提供任何需要修改的内容。`;
      }

      const updatedTask = await cronTaskService.update(taskId, updateData);

      // 重新加载调度
      if (task.enabled) {
        await cronSchedulerService.reloadTask(taskId);
      }

      return `定时任务 "${updatedTask.name}" 已修改。新的调度配置: ${updatedTask.scheduleType}${updatedTask.scheduleType === 'cron' ? ` (${updatedTask.cronExpression})` : updatedTask.scheduleType === 'interval' ? ` (每${updatedTask.intervalMinutes}分钟)` : ''}`;
    } catch (error) {
      return `修改定时任务失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'update_cron_task',
    description:
      '修改指定的定时任务，可以修改名称、描述、调度类型、执行频率、执行内容等。',
    schema: z.object({
      taskId: z.string().describe('要修改的任务 ID'),
      name: z.string().optional().describe('新的任务名称'),
      description: z.string().optional().describe('新的任务描述'),
      scheduleType: z
        .enum(['cron', 'interval', 'once'])
        .optional()
        .describe('新的调度类型'),
      cronExpression: z
        .string()
        .optional()
        .describe('新的 cron 表达式（scheduleType=cron 时使用）'),
      intervalMinutes: z
        .number()
        .optional()
        .describe('新的间隔分钟数（scheduleType=interval 时使用）'),
      scheduledAt: z
        .string()
        .optional()
        .describe('新的执行时间（scheduleType=once 时使用，ISO 格式）'),
      payload: z.string().optional().describe('新的执行内容'),
      agentIds: z.array(z.string()).optional().describe('新的触发助手 ID 列表'),
    }),
  },
);

// 定时任务助手的工具列表
export const cronTaskHelperTools = [
  listChatRoomsForCronTool,
  createCronTaskTool,
  listCronTasksTool,
  toggleCronTaskTool,
  updateCronTaskTool,
  deleteCronTaskTool,
];
