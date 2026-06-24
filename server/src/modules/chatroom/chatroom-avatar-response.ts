export const INLINE_AVATAR_REFERENCE_PREFIX = '__teamagentx_inline_avatar__:';

const INLINE_IMAGE_AVATAR_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

type AvatarContainer = {
  avatar?: string | null;
};

type ChatRoomAvatarContainer = AvatarContainer & {
  owner?: AvatarContainer | null;
  chatRoomAgents?: Array<{
    user?: AvatarContainer | null;
    agent?: AvatarContainer | null;
  }>;
};

export function compactInlineChatRoomAvatars<T extends ChatRoomAvatarContainer>(chatRooms: T[]) {
  const inlineAvatars: Record<string, string> = {};
  const references = new Map<string, string>();

  const compactAvatar = (avatar: string | null | undefined) => {
    if (!avatar || !INLINE_IMAGE_AVATAR_PATTERN.test(avatar)) return avatar;

    let reference = references.get(avatar);
    if (!reference) {
      reference = String(references.size);
      references.set(avatar, reference);
      inlineAvatars[reference] = avatar;
    }

    return `${INLINE_AVATAR_REFERENCE_PREFIX}${reference}`;
  };

  const data = chatRooms.map((chatRoom) => ({
    ...chatRoom,
    avatar: compactAvatar(chatRoom.avatar),
    owner: chatRoom.owner
      ? { ...chatRoom.owner, avatar: compactAvatar(chatRoom.owner.avatar) }
      : chatRoom.owner,
    chatRoomAgents: chatRoom.chatRoomAgents?.map((chatRoomAgent) => ({
      ...chatRoomAgent,
      user: chatRoomAgent.user
        ? { ...chatRoomAgent.user, avatar: compactAvatar(chatRoomAgent.user.avatar) }
        : chatRoomAgent.user,
      agent: chatRoomAgent.agent
        ? { ...chatRoomAgent.agent, avatar: compactAvatar(chatRoomAgent.agent.avatar) }
        : chatRoomAgent.agent,
    })),
  })) as T[];

  return { data, inlineAvatars };
}
