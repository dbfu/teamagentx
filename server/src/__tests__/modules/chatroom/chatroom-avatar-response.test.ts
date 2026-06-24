import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INLINE_AVATAR_REFERENCE_PREFIX,
  compactInlineChatRoomAvatars,
} from '../../../modules/chatroom/chatroom-avatar-response.js';

test('deduplicates inline avatars across chat room list data', () => {
  const avatar = 'data:image/png;base64,avatar-data';
  const chatRooms: Array<{
    id: string;
    avatar?: string;
    owner?: { avatar?: string };
    chatRoomAgents?: Array<{
      user?: { avatar?: string };
      agent?: { avatar?: string };
    }>;
  }> = [
    {
      id: 'room-1',
      avatar,
      owner: { avatar },
      chatRoomAgents: [{ user: { avatar }, agent: { avatar: '4' } }],
    },
    {
      id: 'room-2',
      avatar: '2',
      owner: { avatar },
      chatRoomAgents: [{ agent: { avatar } }],
    },
  ];
  const { data, inlineAvatars } = compactInlineChatRoomAvatars(chatRooms);

  assert.deepEqual(inlineAvatars, { 0: avatar });
  assert.equal(data[0]?.avatar, `${INLINE_AVATAR_REFERENCE_PREFIX}0`);
  assert.equal(data[0]?.owner?.avatar, `${INLINE_AVATAR_REFERENCE_PREFIX}0`);
  assert.equal(data[0]?.chatRoomAgents?.[0]?.user?.avatar, `${INLINE_AVATAR_REFERENCE_PREFIX}0`);
  assert.equal(data[0]?.chatRoomAgents?.[0]?.agent?.avatar, '4');
  assert.equal(data[1]?.avatar, '2');
  assert.equal(data[1]?.owner?.avatar, `${INLINE_AVATAR_REFERENCE_PREFIX}0`);
  assert.equal(data[1]?.chatRoomAgents?.[0]?.agent?.avatar, `${INLINE_AVATAR_REFERENCE_PREFIX}0`);
});
