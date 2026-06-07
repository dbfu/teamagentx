import prisma from '../lib/prisma.js';

const AGENT_AVATAR_COUNT = 30;

/**
 * 根据字符串计算确定性哈希值
 * 与前端 agent-avatars.tsx 的 hashAvatarValue 保持一致
 */
function hashAvatarValue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * 计算助手的头像索引
 * 如果 avatar 已经是数字字符串则直接使用，否则根据名称哈希计算
 */
function getAvatarIndex(agentName: string, currentAvatar: string | null): number {
  // 如果当前头像已经是数字，直接返回
  if (currentAvatar && /^\d+$/.test(currentAvatar)) {
    return Number(currentAvatar) % AGENT_AVATAR_COUNT;
  }
  // 根据助手名称计算确定性索引
  return hashAvatarValue(agentName) % AGENT_AVATAR_COUNT;
}

/**
 * 为所有没有 numeric avatar 的助手分配头像索引
 * 在系统启动时调用，确保所有助手都有 sprite 头像
 */
export async function migrateAgentAvatars(): Promise<void> {
  console.log('[migrate-avatars] 检查是否需要迁移助手头像...');

  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, avatar: true },
  });

  // 自定义图片 URL（以 /、data:、http(s):、file:、./ 开头）不参与迁移，
  // 否则用户上传的自定义头像会在每次启动时被覆盖成数字 sprite
  const CUSTOM_AVATAR_URL_PATTERN = /^(data:image\/|blob:|https?:\/\/|file:\/\/|\/|\.{1,2}\/)/i;
  const agentsNeedUpdate = agents.filter(
    (a) => !a.avatar || (!/^\d+$/.test(a.avatar) && !CUSTOM_AVATAR_URL_PATTERN.test(a.avatar))
  );

  if (agentsNeedUpdate.length === 0) {
    console.log('[migrate-avatars] 所有助手已使用数字头像，无需迁移');
    return;
  }

  console.log(`[migrate-avatars] 发现 ${agentsNeedUpdate.length}/${agents.length} 个助手需要迁移头像`);

  let updated = 0;
  for (const agent of agentsNeedUpdate) {
    const avatarIndex = getAvatarIndex(agent.name, agent.avatar);
    await prisma.agent.update({
      where: { id: agent.id },
      data: { avatar: String(avatarIndex) },
    });
    console.log(
      `[migrate-avatars] ${agent.name}: "${agent.avatar ?? 'null'}" -> ${avatarIndex}`
    );
    updated++;
  }

  console.log(`[migrate-avatars] 头像迁移完成，共更新 ${updated} 个助手`);
}
