import { z } from 'zod';
import { createSystemTool } from './system-tool.js';
import { recordMentions } from '../agent-handler/mention-buffer.js';
import type { HandoffMention, MentionDispatchMode } from '../../../types/handoff.js';

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

export type PendingMention = HandoffMention;

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
  'Each call is one dispatch stage. Within one call, `mode` controls how multiple targets run:',
  'mode="parallel" (default) fans out to all targets at once and you collect their results;',
  'mode="serial" runs the targets one after another, feeding each one the previous output (use when there is a dependency).',
  'Calling this tool MULTIPLE TIMES in a turn always chains the calls serially, regardless of mode —',
  'each later call only starts after the previous call (and its whole sub-tree) has finished, and receives all earlier outputs as input.',
  'So: want parallel? one call with several targets + mode="parallel". Want a dependency chain? mode="serial", or split into multiple calls.',
  'Dispatch happens after your turn ends, not at call time.',
  '说明（中文）：把任务交接给群内其他助手。只有当你确实希望对方行动时才调用，不要靠在正文里写「@名字」来触发。',
  '每次调用是一个派发阶段：同一次调用内 mode="parallel"（默认）并行扇出、你负责收口；mode="serial" 按顺序串行、把前一个产出喂给后一个（有依赖时用）。',
  '一轮内多次调用恒串行：后一次调用要等前一次（及其子任务）全部结束才开始，并能拿到此前所有产出。想并行就一次 @ 多个 + parallel；想接力链就 serial 或分多次调用。派发在你本轮结束后统一进行。',
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
  mode: z
    .enum(['serial', 'parallel'])
    .default('parallel')
    .describe(
      '本次调用内多个目标的派发方式：parallel=并行扇出+收口（默认）；serial=按顺序串行接力（有依赖时用）。单个目标时无意义。',
    ),
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

      // 把本次调用作为一个独立批次写入注册表（保留调用边界，供串行/并行归一化）；
      // 批内按 agentId 去重（同一目标重复时 task 后写覆盖）。
      const recorded = recordMentions(
        ctx.chatRoomId,
        ctx.selfAgentId,
        pending,
        (input.mode ?? 'parallel') as MentionDispatchMode,
        input.intent,
      );
      if (!recorded) {
        throw new Error('mention_agents 当前不在有效的助手执行上下文中');
      }

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
export function appendMentionBlock(
  content: string,
  pending: PendingMention[],
  options?: { suggestion?: boolean },
): string {
  if (pending.length === 0) return content;
  const block = pending
    .map((m) => {
      const mention = m.task ? `@${m.agentName} ${m.task}` : `@${m.agentName}`;
      return options?.suggestion ? `建议 ${mention}` : mention;
    })
    .join('\n');
  const base = content.trimEnd();
  return base ? `${base}\n\n${block}` : block;
}

export { MENTION_TOOL_NAME };
