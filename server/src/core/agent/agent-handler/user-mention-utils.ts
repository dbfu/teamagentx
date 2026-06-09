import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { parseKnownMentions } from './message-utils.js';

export async function messageMentionsRoomUser(
  chatRoomId: string,
  content: string,
): Promise<boolean> {
  const userMembers = await chatRoomService.getUserMembers(chatRoomId);
  const usernames = userMembers
    .map((member) => member.user?.username)
    .filter((username): username is string => Boolean(username));

  if (usernames.length === 0) return false;

  return parseKnownMentions(content, usernames, { allowInline: true }).length > 0;
}
