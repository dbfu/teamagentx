import prisma from '../../lib/prisma.js';
import type { Platform } from './bridge.service.js';

export async function bindBridgePlatformToChatRoom(platform: Platform, chatRoomId: string) {
  const existingRoomBinding = await prisma.platformConfig.findFirst({
    where: {
      chatRoomId,
      platform: { not: platform },
    },
    select: { platform: true },
  });

  if (existingRoomBinding) {
    throw new Error(`该群聊已绑定其他机器人：${existingRoomBinding.platform}`);
  }

  const existingPlatformBinding = await prisma.platformConfig.findUnique({
    where: { platform },
    select: { chatRoomId: true },
  });

  if (existingPlatformBinding?.chatRoomId && existingPlatformBinding.chatRoomId !== chatRoomId) {
    throw new Error('该机器人已绑定到其他群聊');
  }

  return prisma.platformConfig.upsert({
    where: { platform },
    create: {
      platform,
      chatRoomId,
      enabled: true,
      updatedAt: new Date(),
    },
    update: {
      chatRoomId,
      enabled: true,
    },
    include: {
      chatRoom: {
        select: { id: true, name: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function listBridgeBindings(platform?: Platform) {
  const configs = await prisma.platformConfig.findMany({
    where: {
      ...(platform ? { platform } : {}),
      chatRoomId: { not: null },
    },
    include: {
      chatRoom: {
        select: { id: true, name: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return configs.map((config) => ({
    id: config.id,
    platform: config.platform as Platform,
    externalId: 'ANY',
    chatRoomId: config.chatRoomId!,
    chatRoom: config.chatRoom!,
    botToken: config.botToken,
    webhookSecret: undefined,
    defaultAgentId: config.defaultAgentId,
    defaultAgent: config.defaultAgent,
    config: config.config,
    enabled: config.enabled,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }));
}

export async function getBridgeBindingByPlatform(platform: Platform) {
  return prisma.platformConfig.findUnique({
    where: { platform },
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function getBridgeBindingByChatRoom(chatRoomId: string) {
  return prisma.platformConfig.findFirst({
    where: { chatRoomId },
    include: {
      chatRoom: {
        select: { id: true, name: true, defaultAgentId: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function updateBridgeBinding(id: string, data: { enabled?: boolean }) {
  return prisma.platformConfig.update({
    where: { id },
    data: {
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    },
    include: {
      chatRoom: {
        select: { id: true, name: true },
      },
      defaultAgent: {
        select: { id: true, name: true, avatar: true, avatarColor: true },
      },
    },
  });
}

export async function deleteBridgeBinding(id: string) {
  return prisma.platformConfig.update({
    where: { id },
    data: {
      chatRoomId: null,
      enabled: true,
    },
  });
}
