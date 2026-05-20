import prisma from '../../lib/prisma.js';
import { agentService } from '../../core/agent/agent.service.js';
import { chatRoomService } from '../chatroom/chatroom.service.js';
import { bridgeService, type Platform } from './bridge.service.js';
import { clearChatRoom } from '../chatroom/chatroom-clear.js';

const HELP_RE = /^\/help$/i;
const CLEAR_RE = /^\/clear$/i;
const AT_RE = /^\/at\s+(\S+)(?:\s+([\s\S]+))?$/i;

export type CommandType = 'help' | 'clear' | 'at';

export interface DetectedCommand {
  type: CommandType;
  agentName?: string;
  content?: string;
}

export function detectBridgeCommand(text: string): DetectedCommand | null {
  const t = text.trim();
  if (HELP_RE.test(t)) return { type: 'help' };
  if (CLEAR_RE.test(t)) return { type: 'clear' };
  const m = t.match(AT_RE);
  if (m) return { type: 'at', agentName: m[1], content: m[2] };
  return null;
}

interface CommandContext {
  chatRoomId: string;
  botId: string;
  externalId: string;
  platform: Platform;
}

async function sendReply(ctx: CommandContext, text: string): Promise<void> {
  await bridgeService.sendDirectMessage(ctx.platform, ctx.botId, ctx.externalId, text).catch((err) => {
    console.error(`[Bridge][Command] 回复失败 platform=${ctx.platform}:`, err instanceof Error ? err.message : err);
  });
}

export async function handleHelpCommand(ctx: CommandContext): Promise<void> {
  let agentNames: string[] = [];
  try {
    const rows = await prisma.chatRoomAgent.findMany({
      where: { chatRoomId: ctx.chatRoomId, agentId: { not: null } },
      include: { agent: { select: { name: true, isActive: true } } },
    });
    agentNames = rows.filter((r) => r.agent?.isActive).map((r) => r.agent!.name);
  } catch (err) {
    console.warn('[Bridge][Command] 获取群助手列表失败:', err instanceof Error ? err.message : err);
  }

  const agentLine = agentNames.length > 0
    ? `\n当前群助手：${agentNames.join('、')}`
    : '\n（当前无活跃助手）';

  await sendReply(
    ctx,
    `🤖 可用指令：\n/help - 查看帮助\n/at {助手名} [消息] - 快捷触发指定助手\n/clear - 清空助手上下文记忆${agentLine}`,
  );
}

export async function handleClearCommand(ctx: CommandContext): Promise<void> {
  try {
    await clearChatRoom(ctx.chatRoomId);
    await sendReply(ctx, '✅ 群聊记录已清空，助手将重新开始对话');
  } catch (err) {
    console.error('[Bridge][Command] 清空群聊失败:', err instanceof Error ? err.message : err);
    await sendReply(ctx, '❌ 清空失败，请稍后重试');
  }
}

/**
 * 处理 /at 指令。
 * 成功时返回转换后的消息文本（供调用方继续走 receiveBridgeMessage 路径）。
 * 失败时返回 null（已向平台回复错误）。
 */
export async function handleAtCommand(
  ctx: CommandContext,
  agentName: string | undefined,
  content: string | undefined,
): Promise<string | null> {
  const cleanName = (agentName ?? '').replace(/^@/, '').trim();
  if (!cleanName) {
    await sendReply(ctx, '❌ 用法：/at 助手名 [消息内容]');
    return null;
  }

  let agent = await agentService.findByName(cleanName);
  if (!agent) {
    const active = await agentService.findActive();
    agent = active.find((a) => a.name.toLowerCase() === cleanName.toLowerCase()) ?? null;
  }

  if (!agent || !agent.isActive) {
    await sendReply(ctx, `❌ 未找到助手：${cleanName}，发送 /help 查看可用助手`);
    return null;
  }

  if (agent.agentLevel !== 'system') {
    const isMember = await chatRoomService.isAgentMember(ctx.chatRoomId, agent.id);
    if (!isMember) {
      await sendReply(ctx, `❌ 助手 ${agent.name} 不在当前群聊中`);
      return null;
    }
  }

  const tail = content?.trim() ?? '';
  return tail ? `@${agent.name} ${tail}` : `@${agent.name}`;
}
