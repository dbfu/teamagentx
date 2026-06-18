import type { PendingMention } from '../tools/mention.tools.js';

/**
 * 助手 mention_agents 工具的「派发意图缓冲区」注册表。
 *
 * 工具调用走无状态 HTTP（internal-agent-tools.gateway），无法用闭包持有本轮状态，
 * 因此用服务端注册表按 `chatRoomId:agentId` 暂存助手本轮登记的派发目标。
 *
 * 生命周期：
 * - 助手执行期间，每次调用 mention_agents → recordMentions 并集去重写入；
 * - 助手本轮结束（exec 完成）→ takeMentions 读取并清空，喂给派发决策；
 * - 任务开始 / 异常收尾 → clearMentions 兜底清理，避免上一轮残留泄漏到下一轮。
 *
 * 说明：TaskQueue 对同一 chatRoom-agent 串行处理，故 `chatRoomId:agentId` 作为键足够。
 */

const buffers = new Map<string, Map<string, PendingMention>>();

function keyOf(chatRoomId: string, agentId: string): string {
  return `${chatRoomId}:${agentId}`;
}

/** 并集去重写入本轮缓冲；同一目标重复登记时 task 后写覆盖。 */
export function recordMentions(
  chatRoomId: string,
  agentId: string,
  mentions: PendingMention[],
): void {
  if (mentions.length === 0) return;
  const key = keyOf(chatRoomId, agentId);
  const map = buffers.get(key) ?? new Map<string, PendingMention>();
  buffers.set(key, map);
  for (const m of mentions) {
    map.set(m.agentId, m);
  }
}

/** 只读查看本轮缓冲（不清空），用于调试 / 测试。 */
export function peekMentions(chatRoomId: string, agentId: string): PendingMention[] {
  const map = buffers.get(keyOf(chatRoomId, agentId));
  return map ? [...map.values()] : [];
}

/** 读取并清空本轮缓冲：轮末派发决策使用。 */
export function takeMentions(chatRoomId: string, agentId: string): PendingMention[] {
  const key = keyOf(chatRoomId, agentId);
  const map = buffers.get(key);
  if (!map) return [];
  buffers.delete(key);
  return [...map.values()];
}

/** 清空本轮缓冲（不返回）：任务开始 / 异常收尾兜底。 */
export function clearMentions(chatRoomId: string, agentId: string): void {
  buffers.delete(keyOf(chatRoomId, agentId));
}
