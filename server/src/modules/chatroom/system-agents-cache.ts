// 系统助手列表缓存（30 秒 TTL）
// 单独提取为模块以避免 chatroom.service 与 agent.service 之间的循环依赖
import prisma from '../../lib/prisma.js';

export type SystemAgentInfo = {
  id: string;
  name: string;
  avatar: string | null;
  avatarColor: string | null;
  description: string | null;
  type: string;
  agentLevel: string;
  speechConfig: string | null;
};

const SYSTEM_AGENTS_CACHE_TTL_MS = 30_000;
let cache: SystemAgentInfo[] | null = null;
let cachedAt = 0;

export function invalidateSystemAgentsCache(): void {
  cache = null;
  cachedAt = 0;
}

export async function getSystemAgentsCached(): Promise<SystemAgentInfo[]> {
  if (cache && Date.now() - cachedAt < SYSTEM_AGENTS_CACHE_TTL_MS) {
    return cache;
  }
  const agents = await prisma.agent.findMany({
    where: { agentLevel: 'system', isActive: true },
    select: {
      id: true,
      name: true,
      avatar: true,
      avatarColor: true,
      description: true,
      type: true,
      agentLevel: true,
      speechConfig: true,
    },
  });
  cache = agents;
  cachedAt = Date.now();
  return agents;
}
