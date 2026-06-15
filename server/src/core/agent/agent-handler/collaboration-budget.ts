import { config } from '../../../config/index.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { agentService } from '../agent.service.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';
import { INTERNAL_COORDINATOR_AGENT_NAME } from '../internal-coordinator-agent.js';
import { buildAIMessage } from './message-utils.js';
import { globalEmit, globalBroadcastMessage } from './status.js';
import { pickLocaleText, normalizeLocale } from './locale.js';
import { debugLog } from './debug.js';
import type { Message } from '../../../types/message.js';

/**
 * 协作预算熔断（智能协作模式）。
 *
 * 助手快路径接力（A 回复结尾 @B 直接触发 B）没有协调器每跳裁决，
 * 靠本模块保证收敛：以「两次人类发言之间」为计数窗口，
 * - 跳数预算：接力总跳数超过 maxHandoffHops 即熔断；
 * - 环路检测：同一对助手（A↔B）之间**连续**往返超过 handoffCycleRepeatLimit 个来回
 *   即熔断（踢皮球）。判定的是连续乒乓而不是窗口内的累计重复——多阶段流程
 *   （如游戏主持人轮流 @ 各玩家、玩家逐一回 @ 主持人的轮辐式协作）会让同一条边
 *   跨阶段反复出现，这是合法推进；真正的病态环路是两个助手不间断互踢、无第三方介入。
 * 熔断后不再触发下一跳，改为以群调度助手名义 @群主 说明卡点（ask_owner 语义，
 * 确定性实现，不依赖 LLM）。人类发言清零全部计数（用户介入 = 新协作回合）。
 */

interface RoomBudgetState {
  hops: number;
  // 最近一跳所属的无序助手对（`min<->max`），与该对当前的连续跳数。
  // 换了交接对即重置——只有不间断的 A↔B 往返才会累计。
  lastPairKey?: string;
  pairRunHops: number;
}

const roomBudgets = new Map<string, RoomBudgetState>();

export type HandoffVerdict = 'ok' | 'hop_limit' | 'cycle';

/** 人类发言时调用：清零房间协作预算，开始新一轮协作回合。 */
export function resetCollaborationBudget(chatRoomId: string): void {
  roomBudgets.delete(chatRoomId);
}

/**
 * 助手快路径接力前调用：登记一跳并返回裁决。
 * 返回非 'ok' 时调用方不应触发目标助手，转而调用 notifyCollaborationBudgetExceeded。
 */
export function registerHandoff(
  chatRoomId: string,
  sourceAgentId: string,
  targetAgentId: string,
): HandoffVerdict {
  const state = roomBudgets.get(chatRoomId) ?? { hops: 0, pairRunHops: 0 };
  roomBudgets.set(chatRoomId, state);

  const maxHops = config.agent.maxHandoffHops;
  if (Number.isFinite(maxHops) && maxHops > 0 && state.hops + 1 > maxHops) {
    return 'hop_limit';
  }

  // 无序对：A→B 与 B→A 属于同一对，连续命中同一对即乒乓往返
  const pairKey = sourceAgentId < targetAgentId
    ? `${sourceAgentId}<->${targetAgentId}`
    : `${targetAgentId}<->${sourceAgentId}`;
  const runHops = state.lastPairKey === pairKey ? state.pairRunHops + 1 : 1;
  // limit 个来回 = limit*2 跳；超过即熔断（如 limit=3 → 第 7 跳触发）
  const cycleLimit = config.agent.handoffCycleRepeatLimit;
  if (Number.isFinite(cycleLimit) && cycleLimit > 0 && runHops > cycleLimit * 2) {
    return 'cycle';
  }

  state.hops += 1;
  state.lastPairKey = pairKey;
  state.pairRunHops = runHops;
  return 'ok';
}

/**
 * 熔断后向群主汇报卡点：以群调度助手名义发一条 @群主 的消息（ask_owner 语义）。
 * 该消息来源是 GROUP_COORDINATOR_ID 且只 @ 用户，不会再次触发任何助手或协调器。
 */
export async function notifyCollaborationBudgetExceeded(params: {
  chatRoomId: string;
  triggerMessage: Message;
  verdict: Exclude<HandoffVerdict, 'ok'>;
  sourceAgentName?: string;
  targetAgentName: string;
}): Promise<void> {
  const { chatRoomId, triggerMessage, verdict, sourceAgentName, targetAgentName } = params;

  debugLog('collaborationBudgetExceeded', {
    chatRoomId,
    verdict,
    sourceAgentName,
    targetAgentName,
    triggerMessageId: triggerMessage.id,
  });

  const chatRoom = await chatRoomService.findById(chatRoomId);
  const ownerUsername = chatRoom?.owner?.username;
  const locale = normalizeLocale((chatRoom?.owner as any)?.preferredLanguage);
  const ownerMention = ownerUsername ? `@${ownerUsername} ` : '';
  const source = sourceAgentName ?? '';

  const content = verdict === 'hop_limit'
    ? pickLocaleText(
        {
          'zh-CN': `${ownerMention}本轮协作的助手接力已达安全上限（${config.agent.maxHandoffHops} 跳），已暂停自动接力。最后一跳：${source} → ${targetAgentName}。请确认任务进展后回复继续，或直接 @ 对应助手。`,
          'en-US': `${ownerMention}This collaboration round hit the handoff safety limit (${config.agent.maxHandoffHops} hops); automatic handoff is paused. Last hop: ${source} → ${targetAgentName}. Please review the progress and reply to continue, or @ the assistant directly.`,
        },
        locale,
      )
    : pickLocaleText(
        {
          'zh-CN': `${ownerMention}检测到 ${source} 与 ${targetAgentName} 之间连续往返交接超过 ${config.agent.handoffCycleRepeatLimit} 个来回且无第三方介入，疑似互相踢皮球，已暂停自动接力。请确认任务卡点后介入。`,
          'en-US': `${ownerMention}Detected ${source} and ${targetAgentName} handing off back and forth more than ${config.agent.handoffCycleRepeatLimit} consecutive round trips with no third party involved — likely stuck in a loop; automatic handoff is paused. Please review the blocker and intervene.`,
        },
        locale,
      );

  const coordinatorAgent = await agentService.findById(GROUP_COORDINATOR_ID);
  const msg = await buildAIMessage(
    content,
    triggerMessage.id,
    INTERNAL_COORDINATOR_AGENT_NAME,
    GROUP_COORDINATOR_ID,
    chatRoomId,
    coordinatorAgent?.avatar,
    coordinatorAgent?.avatarColor,
  );
  await messageService.create({
    id: msg.id,
    type: 'REPLY',
    content: msg.content,
    time: msg.time,
    agentId: GROUP_COORDINATOR_ID,
    chatRoomId,
    replyMessageId: triggerMessage.id,
    isHuman: false,
  });
  if (globalEmit) await globalEmit(msg, chatRoomId);
}
