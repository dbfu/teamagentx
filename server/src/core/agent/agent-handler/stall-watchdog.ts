import { config } from '../../../config/index.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { taskQueueService } from '../../../modules/task-queue/task-queue.service.js';
import { agentService } from '../agent.service.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import { runCoordinatorDispatch } from '../coordinator-dispatch.js';
import { debugLog } from './debug.js';
import { messageMentionsRoomUser } from './user-mention-utils.js';
import { stopAgentExecution } from './cache.js';
import { broadcastAgentStatus } from './status.js';
import { normalizeTriggerMode } from './trigger-mode.js';
import type { Message } from '../../../types/message.js';

/**
 * 智能协作模式下的「卡住检测」兜底。
 *
 * 背景：智能协作模式的快路径靠助手自己在回复里 @下一个助手 来推进任务，助手一旦忘记 @，
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
// 记录刚刚被用户中断的房间，这些房间不应该触发 watchdog（用户主动介入）
const interruptedRooms = new Set<string>();
// 正在进行中的「卡住检测自动调度」中止控制器（按房间）：watchdog 唤醒群调度后持有，
// 用户在调度途中发言即可凭此 abort 掉这次自动调度。
const watchdogDispatchControllers = new Map<string, AbortController>();
// 本轮自动调度实际派发出去的助手 id（按房间）：用户介入时连同其执行/排队任务一并停掉，
// 实现「即使已经派发也要终止」。
const watchdogDispatchedAgents = new Map<string, Set<string>>();

/**
 * 人类发言时清零连续救援计数：用户重新介入即视为一个新的协作回合。
 */
export function resetStallWatchdog(chatRoomId: string): void {
  consecutiveDispatches.delete(chatRoomId);
  // 用户重新介入，清除中断标志，避免残留标志在新一轮对话中误跳 watchdog
  interruptedRooms.delete(chatRoomId);
}

/**
 * 仅清除房间当前的 watchdog 定时器，不标记用户中断、不重置救援计数。
 * 用于协调器已经主动接管裁决时，避免旧定时器在慢请求期间并发启动第二次裁决。
 */
export function clearStallWatchdogTimer(chatRoomId: string): boolean {
  const timer = watchdogTimers.get(chatRoomId);
  if (!timer) return false;
  clearTimeout(timer);
  watchdogTimers.delete(chatRoomId);
  return true;
}

/**
 * 用户手动停止任务时调用：取消房间防抖定时器，防止群调度助手介入。
 * 用户主动停止意味着用户已介入，不需要自动唤醒群调度。
 */
export function cancelStallWatchdog(chatRoomId: string): void {
  if (clearStallWatchdogTimer(chatRoomId)) {
    console.log(`[stall-watchdog] ${chatRoomId} 用户手动停止，取消防抖定时器`);
  }
  // 同时清零连续救援计数
  consecutiveDispatches.delete(chatRoomId);
  // 标记房间被用户中断，防止后续的中断消息重新触发 watchdog
  interruptedRooms.add(chatRoomId);
}

/**
 * 检查房间是否刚刚被用户中断，如果是则清除标记并返回 true。
 * 用于在 handler 中判断是否应该跳过 scheduleStallWatchdog。
 */
export function checkAndClearInterrupted(chatRoomId: string): boolean {
  return interruptedRooms.delete(chatRoomId);
}

/**
 * 用户发言时调用：若该房间正处于卡住检测触发的自动调度中（或刚派发出助手），
 * 立即终止本次自动调度——abort 进行中的群调度决策，并停掉本轮已派发助手的执行/排队任务。
 *
 * 设计意图：auto 模式闲置约 1 分钟后 watchdog 会唤醒群调度自动续跑；一旦用户主动介入发言，
 * 这种「投机式」自动续跑应让位于用户，即便群调度已经把助手派发出去也要停下。
 * 非自动调度状态下为无副作用的空操作（两个表都为空）。
 */
export function abortWatchdogDispatch(chatRoomId: string): void {
  const controller = watchdogDispatchControllers.get(chatRoomId);
  const dispatched = watchdogDispatchedAgents.get(chatRoomId);
  if (!controller && (!dispatched || dispatched.size === 0)) return;

  if (controller && !controller.signal.aborted) {
    controller.abort();
  }
  watchdogDispatchControllers.delete(chatRoomId);

  if (dispatched && dispatched.size > 0) {
    void stopWatchdogDispatchedAgents(chatRoomId, [...dispatched]);
  }
  watchdogDispatchedAgents.delete(chatRoomId);

  console.log(`[stall-watchdog] ${chatRoomId} 用户介入发言，终止进行中的自动调度`);
  debugLog('watchdogDispatchAborted', { chatRoomId });
}

/**
 * 停掉本轮自动调度派发出去的助手：正在执行的走 abort，尚未执行的排队任务标记取消。
 */
async function stopWatchdogDispatchedAgents(chatRoomId: string, agentIds: string[]): Promise<void> {
  try {
    for (const agentId of agentIds) {
      // 正在执行：复用与「手动停止」一致的 abort 路径。
      stopAgentExecution(chatRoomId, agentId);
      // 尚未执行：把 pending 排队任务标记为取消，避免被打断后又接着跑。
      const queued = await taskQueueService.getAgentQueueAll(chatRoomId, agentId);
      for (const task of queued) {
        if (task.status === 'pending') {
          await taskQueueService.updateStatus(task.id, 'cancelled');
        }
      }
    }
    broadcastAgentStatus(chatRoomId);
  } catch (error) {
    console.error('[stall-watchdog] 终止自动调度助手失败:', error);
  }
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
  // 仅在智能协作模式、非快速对话群兜底；手动模式无自动接力，无需救援。
  if (!chatRoom || normalizeTriggerMode(chatRoom.agentTriggerMode) !== 'coordinator' || chatRoom.isQuickChatRoom) {
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
  if (await messageMentionsRoomUser(chatRoomId, last.content)) {
    debugLog('stallWatchdogSkipped', { chatRoomId, reason: 'lastMentionsUser' });
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

  consecutiveDispatches.set(chatRoomId, count + 1);

  const triggerMessage = mapRowToMessage(last);

  debugLog('stallWatchdogTrigger', {
    chatRoomId,
    triggerMessageId: last.id,
    triggerAgentId: last.agentId,
    consecutive: count + 1,
  });

  // 本次自动调度持有一个中止控制器：用户中途发言 → abortWatchdogDispatch 可 abort 它。
  const controller = new AbortController();
  watchdogDispatchControllers.set(chatRoomId, controller);
  watchdogDispatchedAgents.delete(chatRoomId);

  try {
    await runCoordinatorDispatch(chatRoomId, triggerMessage, coordinatorAgent, {
      signal: controller.signal,
      onAgentsDispatched: (ids) => {
        const set = watchdogDispatchedAgents.get(chatRoomId) ?? new Set<string>();
        for (const id of ids) set.add(id);
        watchdogDispatchedAgents.set(chatRoomId, set);
      },
      onFailure: (reason) => {
        debugLog('stallWatchdogCoordinatorFailed', {
          chatRoomId,
          triggerMessageId: last.id,
          reason,
        });
        scheduleStallWatchdog(chatRoomId);
      },
    });
  } finally {
    // 仅清理「中止控制器」；已派发助手集合保留到用户介入或下一轮 watchdog，
    // 以便调度完成后用户再发言时仍能停掉正在跑的助手（即「即使已派发也要终止」）。
    if (watchdogDispatchControllers.get(chatRoomId) === controller) {
      watchdogDispatchControllers.delete(chatRoomId);
    }
  }
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
