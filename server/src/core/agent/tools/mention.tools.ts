import { z } from 'zod';
import { createSystemTool } from './system-tool.js';
import { recordMentions } from '../agent-handler/mention-buffer.js';

/**
 * 助手「显式派发意图」工具 mention_agents。
 *
 * 背景：助手互相接力此前靠对**助手输出的自由文本**跑 parseKnownMentions 反推 @ 了谁
 * （handler.ts），导致助手草拟方案时写「交给 @UI设计 …」「@admin 请审阅」这类**叙述性**
 * 文本被误当成真实派发。本工具把「派给谁」从「事后猜 prose」改成「助手主动调用、结构化登记」。
 *
 * 设计要点（详见 docs/15-mention-dispatch-tool-prd.md）：
 * - 工具**只登记、不派发**：每次调用把目标写入本轮执行的 buffer，真正派发在助手这一轮
 *   结束后由调用方读 buffer 决定，保证「一轮一个决策点」、不会边生成边再入。
 * - 多次调用按 agentId **并集去重**（同一助手重复时 task 后写覆盖）。
 * - 即时校验只做 unknown_agent / self（便宜、当场可判）；环检测 / 扇出上限等依赖
 *   「本轮最终并集」与派发上下文，留到轮末判定。
 * - buffer 绑定「单次执行」：执行器按 chatRoom-agent 缓存，务必每轮新建 createMentionTools
 *   或调用 reset，避免上轮残留泄漏到下轮。
 */

export interface PendingMention {
  agentId: string;
  agentName: string;
  task: string;
}

export interface MentionToolContext {
  /** 当前群聊 id，用于把登记写入按 chatRoomId:agentId 键的缓冲注册表。 */
  chatRoomId: string;
  /** 当前执行助手自身的 agentId，用于拒绝 @自己 + 作为缓冲键。 */
  selfAgentId: string;
  /**
   * 名称 → 助手的解析器（应只命中当前群内活跃业务助手）。
   * 由调用方注入（默认基于 chatRoomService），便于测试与复用。
   * 可返回 Promise 以支持 DB 查询。
   */
  resolveAgent: (
    name: string,
  ) => { id: string; name: string } | null | Promise<{ id: string; name: string } | null>;
}

export type MentionRejectReason = 'unknown_agent' | 'self';

export interface MentionToolResult {
  ok: boolean;
  accepted: Array<{ agent: string; agentId: string }>;
  rejected: Array<{ agent: string; reason: MentionRejectReason }>;
  note: string;
}

export interface MentionToolsBundle {
  /** 注入给执行器的工具列表（当前仅 mention_agents）。 */
  tools: ReturnType<typeof createSystemTool>[];
}

const MENTION_TOOL_NAME = 'mention_agents';

const MENTION_TOOL_DESCRIPTION = [
  'Hand off the conversation to one or more other assistants in this chatroom.',
  'Call this ONLY when you actually want those assistants to act — do NOT rely on writing "@name" in your prose.',
  'You may call it multiple times; targets are merged. Mentioning a single assistant relays the baton to it;',
  'mentioning multiple assistants makes YOU the convergence owner who collects their results.',
  'Dispatch happens after your turn ends, not at call time.',
  '说明（中文）：把任务交接给群内的其他助手。只有当你确实希望对方行动时才调用，不要靠在正文里写「@名字」来触发。',
  '可多次调用，目标会合并；@ 单个=接力，@ 多个=你作为发起者负责收口。派发在你本轮结束后统一进行。',
].join(' ');

const mentionSchema = z.object({
  mentions: z
    .array(
      z.object({
        agent: z
          .string()
          .min(1)
          .describe('目标助手在本群内的可见名称（不要带 @，不要用内部 ID）。'),
        task: z
          .string()
          .default('')
          .describe('交给该助手的具体任务 / 剩余工作；扇出多个时各自独立。'),
      }),
    )
    .min(1)
    .describe('本次要交接的目标助手列表。'),
  intent: z
    .string()
    .optional()
    .describe('可选：本次接力的整体意图说明，便于收口与审计。'),
});

type MentionToolInput = z.infer<typeof mentionSchema>;

/**
 * 为指定助手在指定群创建 mention 工具。
 * 工具调用只把目标并集写入缓冲注册表（mention-buffer），不派发；
 * 派发由助手本轮结束后的派发层读取缓冲决定。
 */
export function createMentionTools(ctx: MentionToolContext): MentionToolsBundle {
  const mentionTool = createSystemTool<MentionToolInput>(
    async (input): Promise<MentionToolResult> => {
      const accepted: MentionToolResult['accepted'] = [];
      const rejected: MentionToolResult['rejected'] = [];
      const pending: PendingMention[] = [];

      for (const item of input.mentions ?? []) {
        const rawName = (item.agent ?? '').trim();
        const agent = rawName ? await ctx.resolveAgent(rawName) : null;

        // 即时校验：解析不到 / @自己 直接回拒，让模型当场改正。
        if (!agent) {
          rejected.push({ agent: rawName, reason: 'unknown_agent' });
          continue;
        }
        if (agent.id === ctx.selfAgentId) {
          rejected.push({ agent: agent.name, reason: 'self' });
          continue;
        }

        pending.push({
          agentId: agent.id,
          agentName: agent.name,
          task: (item.task ?? '').trim(),
        });
        accepted.push({ agent: agent.name, agentId: agent.id });
      }

      // 并集去重写入注册表（同一目标重复时 task 后写覆盖）。
      recordMentions(ctx.chatRoomId, ctx.selfAgentId, pending);

      return {
        ok: rejected.length === 0,
        accepted,
        rejected,
        note: '已登记，将在你本轮结束后统一处理',
      };
    },
    {
      name: MENTION_TOOL_NAME,
      description: MENTION_TOOL_DESCRIPTION,
      schema: mentionSchema,
    },
  );

  return { tools: [mentionTool] };
}

/**
 * 把本轮登记的派发意图序列化成规范化的 @ 文本块，追加到助手消息正文末尾。
 *
 * - 保持现有「@助手名」纯文本格式（本期不引入 token），因此现有 remark-mentions / 高亮
 *   逻辑无需改动即可正确渲染。
 * - 块是机器生成的规范文本（行首「@名称 」+ 空格 + task），不会出现自由 prose 的歧义。
 * - ⚠️ 派发权威是 buffer 本身，不是 parse 这个块；块只承担「显示 + 历史记录」。
 */
export function appendMentionBlock(content: string, pending: PendingMention[]): string {
  if (pending.length === 0) return content;
  const block = pending
    .map((m) => (m.task ? `@${m.agentName} ${m.task}` : `@${m.agentName}`))
    .join('\n');
  const base = content.trimEnd();
  return base ? `${base}\n\n${block}` : block;
}

export { MENTION_TOOL_NAME };
