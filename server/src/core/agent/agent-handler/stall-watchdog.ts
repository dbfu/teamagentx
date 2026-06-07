import { config } from '../../../config/index.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { agentService } from '../agent.service.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import { createInternalCoordinatorAgent } from '../internal-coordinator-agent.js';
import { enqueueAgentTask } from './agent-dispatch.service.js';
import {
  buildCoordinatorRecentContext,
  withCoordinatorContext,
} from './coordinator-context.js';
import { debugLog } from './debug.js';
import type { Message } from '../../../types/message.js';

/**
 * 自由协作（auto）模式下的「卡住检测」兜底。
 *
 * 背景：auto 模式靠助手自己在回复里 @下一个助手 来推进任务，助手一旦忘记 @，
 * 协作链会静默断开、任务卡住。本模块在助手发完消息后启动一个房间级防抖定时器，
 * 若超过 stallWatchdogDelayMs 仍无新活动、且房间内没有正在跑/排队的任务，
 * 就唤醒内置群调度助手裁决：任务真结束则输出「无需调度」（静默），否则 @对应助手继续。
 *
 * 关键时序说明见下方注释；连续救援次数有上限，遇到人类发言清零，防止死循环。
 */

// 每个房间一个防抖定时器；助手每发一条消息就重置，链在推进时永不触发。
const watchdogTimers = new Map<string, NodeJS.Timeout>();
// 两次人类发言之间，watchdog 连续自动唤醒调度助手的次数，超过上限即停止。
const consecutiveDispatches = new Map<string, number>();

/**
 * 人类发言时清零连续救援计数：用户重新介入即视为一个新的协作回合。
 */
export function resetStallWatchdog(chatRoomId: string): void {
  consecutiveDispatches.delete(chatRoomId);
}

/**
 * 助手发完消息后调用：重置房间防抖定时器。
 * 只应在 auto 模式、非快速对话群里调用（由调用方判断）。
 */
export function scheduleStallWatchdog(chatRoomId: string): void {
  const delay = config.agent.stallWatchdogDelayMs;
  if (!Number.isFinite(delay) || delay <= 0) return;

  const existing = watchdogTimers.get(chatRoomId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    watchdogTimers.delete(chatRoomId);
    runStallWatchdog(chatRoomId).catch((error) => {
      console.error(`[stall-watchdog] ${chatRoomId} 执行失败:`, error);
    });
  }, delay);
  // 不阻塞进程退出
  if (typeof timer.unref === 'function') timer.unref();

  watchdogTimers.set(chatRoomId, timer);
}

async function runStallWatchdog(chatRoomId: string): Promise<void> {
  const chatRoom = await chatRoomService.findById(chatRoomId);
  // 仅在 auto 模式、非快速对话群兜底；其他模式有各自的调度链路。
  if (!chatRoom || chatRoom.agentTriggerMode !== 'auto' || chatRoom.isQuickChatRoom) {
    return;
  }

  // 房间必须真正空闲：没有任何 pending/executing 任务。
  // 防抖延迟已给「正常 @交接的异步入队」留出了完成时间，这里再确认一次。
  const activeTasks = await taskQueueService.getActiveTasks(chatRoomId);
  if (activeTasks.length > 0) {
    debugLog('stallWatchdogSkipped', { chatRoomId, reason: 'roomBusy', activeTasks: activeTasks.length });
    return;
  }

  // 最近一条消息必须来自业务助手（不是人类、也不是调度助手自己的派发回声）。
  const latest = await messageService.findByChatRoomId(chatRoomId, { take: 1, order: 'desc' });
  const last = latest[0];
  if (!last || last.isHuman) {
    debugLog('stallWatchdogSkipped', { chatRoomId, reason: 'lastNotAgentMessage' });
    return;
  }
  if (last.agentId === GROUP_COORDINATOR_ID) {
    debugLog('stallWatchdogSkipped', { chatRoomId, reason: 'lastIsCoordinator' });
    return;
  }

  // 连续救援上限：防止「调度助手反复唤醒同一助手却始终无法推进」的死循环。
  const count = consecutiveDispatches.get(chatRoomId) ?? 0;
  if (count >= config.agent.stallWatchdogMaxConsecutive) {
    console.warn(`[stall-watchdog] ${chatRoomId} 已达连续救援上限(${count})，停止自动唤醒，等待人工介入`);
    debugLog('stallWatchdogSkipped', { chatRoomId, reason: 'maxConsecutive', count });
    return;
  }

  const coordinatorAgent = await agentService.findById(GROUP_COORDINATOR_ID);
  if (!coordinatorAgent || !coordinatorAgent.isActive) {
    console.warn(`[stall-watchdog] 内置群调度助手不存在或未启用: ${GROUP_COORDINATOR_ID}`);
    return;
  }

  // 与协调模式共用同一套上下文注入：把最近群消息作为「仅供裁决参考」上下文拼进
  // 触发消息正文，绕开调度助手被门控的消息索引/回查工具，让裁判能基于最近上下文判断
  // 「任务是否真的结束 / 下一步该谁」。
  const contextBlock = await buildCoordinatorRecentContext(chatRoomId, last.id);
  const triggerMessage = mapRowToMessage(last);
  triggerMessage.content = withCoordinatorContext(triggerMessage.content, contextBlock);

  consecutiveDispatches.set(chatRoomId, count + 1);

  debugLog('stallWatchdogTrigger', {
    chatRoomId,
    triggerMessageId: last.id,
    triggerAgentId: last.agentId,
    consecutive: count + 1,
    hasContext: Boolean(contextBlock),
  });

  await enqueueAgentTask(
    chatRoomId,
    triggerMessage,
    createInternalCoordinatorAgent(coordinatorAgent),
  );
}

type ChatRoomMessageRow = Awaited<ReturnType<typeof messageService.findByChatRoomId>>[number];

function mapRowToMessage(row: ChatRoomMessageRow): Message {
  return {
    id: row.id,
    type: row.type === 'REPLY' ? 'reply' : 'message',
    content: row.content,
    time: row.time,
    agentId: row.agentId ?? undefined,
    agentName: row.agent?.name,
    avatar: row.agent?.avatar,
    avatarColor: row.agent?.avatarColor,
    chatRoomId: row.chatRoomId,
    replyMessageId: row.replyMessageId,
    isHuman: row.isHuman,
  };
}
