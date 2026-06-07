import prisma from '../lib/prisma.js';

const GROUP_AVATAR_COUNT = 24;

/**
 * 根据字符串计算确定性哈希值
 * 与前端 group-avatars.tsx 的 hashAvatarValue 保持一致
 */
function hashAvatarValue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * 计算群聊的头像索引
 * 如果 avatar 已经是数字字符串则直接使用，否则根据名称哈希计算
 */
function getAvatarIndex(chatRoomName: string, currentAvatar: string | null): number {
  // 如果当前头像已经是数字，直接返回
  if (currentAvatar && /^\d+$/.test(currentAvatar)) {
    return Number(currentAvatar) % GROUP_AVATAR_COUNT;
  }
  // 根据群聊名称计算确定性索引
  return hashAvatarValue(chatRoomName) % GROUP_AVATAR_COUNT;
}

/**
 * 为所有没有 numeric avatar 的群聊分配头像索引
 * 在系统启动时调用，确保所有群聊都有图片头像
 */
export async function migrateChatRoomAvatars(): Promise<void> {
  console.log('[migrate-chatroom-avatars] 检查是否需要迁移群聊头像...');

  const chatRooms = await prisma.chatRoom.findMany({
    select: { id: true, name: true, avatar: true },
  });

  // 自定义图片 URL（以 /、data:、http(s):、file:、./ 开头）不参与迁移
  const CUSTOM_AVATAR_URL_PATTERN = /^(data:image\/|blob:|https?:\/\/|file:\/\/|\/|\.{1,2}\/)/i;
  const chatRoomsNeedUpdate = chatRooms.filter(
    (c) => !c.avatar || (!/^\d+$/.test(c.avatar) && !CUSTOM_AVATAR_URL_PATTERN.test(c.avatar))
  );

  if (chatRoomsNeedUpdate.length === 0) {
    console.log('[migrate-chatroom-avatars] 所有群聊已使用数字头像，无需迁移');
    return;
  }

  console.log(`[migrate-chatroom-avatars] 发现 ${chatRoomsNeedUpdate.length}/${chatRooms.length} 个群聊需要迁移头像`);

  let updated = 0;
  for (const chatRoom of chatRoomsNeedUpdate) {
    const avatarIndex = getAvatarIndex(chatRoom.name, chatRoom.avatar);
    await prisma.chatRoom.update({
      where: { id: chatRoom.id },
      data: { avatar: String(avatarIndex) },
    });
    console.log(
      `[migrate-chatroom-avatars] ${chatRoom.name}: "${chatRoom.avatar ?? 'null'}" -> ${avatarIndex}`
    );
    updated++;
  }

  console.log(`[migrate-chatroom-avatars] 头像迁移完成，共更新 ${updated} 个群聊`);
}