import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import type { Message } from '../../../types/message.js';
import { parseKnownMentions } from './message-utils.js';
import { GROUP_COORDINATOR_ID } from '../system-assistant.constants.js';

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

/**
 * 直达回复判定：当用户这条消息紧邻的上一条是「助手 @ 了本用户」的消息时，
 * 说明用户是在回复那个助手的提问/确认，应直接把回复派给该助手
 * （协调模式跳过群调度助手；自由协作模式跳过默认助手裁决）。
 *
 * 两条规则：
 *   1. 紧邻的上一条消息是助手发的，且 @ 了「当前发消息的这个用户」（被 @ 者 == 回复者）。
 *   2. 中间没有任何其他消息（取房间最近一条即可，天然保证紧邻）。
 *
 * @returns 命中时返回该助手的 agentId；否则返回 null。
 */
export async function findDirectReplyAgentId(
  chatRoomId: string,
  message: Message,
): Promise<string | null> {
  const senderUsername = message.user;
  if (!message.isHuman || !senderUsername) return null;

  const [previous] = await messageService.findByChatRoomId(chatRoomId, {
    take: 1,
    order: 'desc',
    beforeMessageId: message.id,
  });

  if (!previous || previous.isHuman || !previous.agentId) return null;

  // 群调度助手不是普通执行器：协调模式下它的 ask_owner 消息会 @群主转发助手的提问。
  // 用户回复这种消息时不能「直达」去把群调度助手当业务助手入队执行，必须回落到
  // runCoordinatorDispatch，由群调度按「回答转发问题 → 调度回原提问助手」重新路由。
  if (previous.agentId === GROUP_COORDINATOR_ID) return null;

  const mentionsSender =
    parseKnownMentions(previous.content, [senderUsername], { allowInline: true })
      .length > 0;

  return mentionsSender ? previous.agentId : null;
}
