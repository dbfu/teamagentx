/**
 * 群聊管理助手的工具定义
 * 用于创建群聊、管理群成员等
 */
import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { agentService } from '../../../core/agent/agent.service.js';
import { broadcastAgentJoinedMessage } from '../agent-handler/message-utils.js';

// 群聊管理助手的专用 ID
export const CHATROOM_HELPER_AGENT_ID = 'c3d4e5f6-7890-abcd-ef12-345678901234';

// 创建群聊工具
export const createChatRoomTool = tool(
  async ({
    name,
    description,
    avatar,
    avatarColor,
    agentIds,
  }: {
    name: string;
    description?: string;
    avatar?: string;
    avatarColor?: string;
    agentIds?: string[];
  }) => {
    try {
      // 创建群聊
      const chatRoom = await chatRoomService.create({
        name,
        description,
        avatar,
        avatarColor,
      });

      if (!chatRoom) {
        return JSON.stringify({
          success: false,
          error: '创建群聊失败：返回结果为空',
        });
      }

      // 如果指定了助手列表，添加到群聊
      const addedAgents: string[] = [];
      if (agentIds && agentIds.length > 0) {
        for (const agentId of agentIds) {
          const agent = await agentService.findById(agentId);
          if (agent) {
            await chatRoomService.addAgent({
              chatRoomId: chatRoom.id,
              agentId,
              role: 'MEMBER',
            });
            addedAgents.push(agent.name);
          }
        }
      }

      return JSON.stringify({
        success: true,
        chatRoom: {
          id: chatRoom.id,
          name: chatRoom.name,
          description: chatRoom.description,
        },
        addedAgents,
        message: `成功创建群聊"${name}"${addedAgents.length > 0 ? `，已添加助手: ${addedAgents.join(', ')}` : ''}`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '创建群聊失败',
      });
    }
  },
  {
    name: 'create_chatroom',
    description: '【必须用户确认后才能调用】创建一个新的群聊。⚠️ 重要：调用前必须先向用户展示群聊配置（名称、描述、要添加的助手），并询问确认。',
    schema: z.object({
      name: z.string().describe('群聊名称'),
      description: z.string().optional().describe('群聊描述'),
      avatar: z.string().optional().describe('群聊头像（emoji或图标名称）'),
      avatarColor: z.string().optional().describe('群聊头像颜色'),
      agentIds: z.array(z.string()).optional().describe('要添加到群聊的助手ID列表'),
    }),
  },
);

// 列出所有群聊工具
export const listChatRoomsTool = tool(
  async () => {
    try {
      const chatRooms = await chatRoomService.findAll();

      if (chatRooms.length === 0) {
        return '暂无群聊';
      }

      const formattedList = chatRooms
        .map(
          (cr) =>
            `**${cr.name}** (ID: ${cr.id})\n描述: ${cr.description || '无'}\n创建时间: ${new Date(cr.createdAt).toLocaleString('zh-CN')}`,
        )
        .join('\n\n');

      return `群聊列表（共 ${chatRooms.length} 个）：\n\n${formattedList}`;
    } catch (error) {
      return `获取群聊列表失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'list_chatrooms',
    description: '列出所有群聊',
    schema: z.object({}),
  },
);

// 列出所有助手工具
export const listAgentsTool = tool(
  async () => {
    try {
      const agents = await agentService.findActive();

      if (agents.length === 0) {
        return '暂无助手';
      }

      const formattedList = agents
        .map(
          (a) =>
            `**${a.name}** (ID: ${a.id})\n类型: ${a.type}\n描述: ${a.description || '无'}`,
        )
        .join('\n\n');

      return `助手列表（共 ${agents.length} 个）：\n\n${formattedList}`;
    } catch (error) {
      return `获取助手列表失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'list_agents',
    description: '列出所有可用的助手，用于选择添加到群聊',
    schema: z.object({}),
  },
);

// 添加助手到群聊工具
export const addAgentToChatRoomTool = tool(
  async ({
    chatRoomId,
    agentIds,
  }: {
    chatRoomId: string;
    agentIds: string[];
  }) => {
    try {
      const chatRoom = await chatRoomService.findById(chatRoomId);
      if (!chatRoom) {
        return `群聊不存在: ${chatRoomId}`;
      }

      const addedAgents: { name: string; description: string | null }[] = [];
      const failedAgents: string[] = [];

      for (const agentId of agentIds) {
        const agent = await agentService.findById(agentId);
        if (!agent) {
          failedAgents.push(`${agentId} (不存在)`);
          continue;
        }

        // 检查是否已在群聊中
        const existing = await chatRoomService.isAgentMember(chatRoomId, agentId);
        if (existing) {
          failedAgents.push(`${agent.name} (已在群聊中)`);
          continue;
        }

        await chatRoomService.addAgent({
          chatRoomId,
          agentId,
          role: 'MEMBER',
        });
        addedAgents.push({ name: agent.name, description: agent.description });

        // 发送助手加入通知消息
        await broadcastAgentJoinedMessage(chatRoomId, agent.name, agent.description);
      }

      let message = `群聊"${chatRoom.name}"操作结果：`;
      if (addedAgents.length > 0) {
        message += `\n✅ 已添加: ${addedAgents.map(a => a.name).join(', ')}`;
      }
      if (failedAgents.length > 0) {
        message += `\n❌ 失败: ${failedAgents.join(', ')}`;
      }

      return message;
    } catch (error) {
      return `添加助手失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'add_agents_to_chatroom',
    description: '将助手添加到指定群聊',
    schema: z.object({
      chatRoomId: z.string().describe('群聊ID'),
      agentIds: z.array(z.string()).describe('要添加的助手ID列表'),
    }),
  },
);

// 从群聊移除助手工具
export const removeAgentFromChatRoomTool = tool(
  async ({
    chatRoomId,
    agentId,
  }: {
    chatRoomId: string;
    agentId: string;
  }) => {
    try {
      const chatRoom = await chatRoomService.findById(chatRoomId);
      if (!chatRoom) {
        return `群聊不存在: ${chatRoomId}`;
      }

      const agent = await agentService.findById(agentId);
      if (!agent) {
        return `助手不存在: ${agentId}`;
      }

      // 查找 ChatRoomAgent 记录
      const chatRoomAgent = await chatRoomService.getAgentMember(chatRoomId, agentId);
      if (!chatRoomAgent) {
        return `助手"${agent.name}"不在群聊"${chatRoom.name}"中`;
      }

      await chatRoomService.removeAgent(chatRoomAgent.id);

      return `✅ 已将助手"${agent.name}"从群聊"${chatRoom.name}"移除`;
    } catch (error) {
      return `移除助手失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'remove_agent_from_chatroom',
    description: '从群聊中移除助手',
    schema: z.object({
      chatRoomId: z.string().describe('群聊ID'),
      agentId: z.string().describe('要移除的助手ID'),
    }),
  },
);

// 删除群聊工具
export const deleteChatRoomTool = tool(
  async ({ chatRoomId }: { chatRoomId: string }) => {
    try {
      const chatRoom = await chatRoomService.findById(chatRoomId);
      if (!chatRoom) {
        return `群聊不存在: ${chatRoomId}`;
      }

      const name = chatRoom.name;
      await chatRoomService.delete(chatRoomId);

      return `✅ 已删除群聊"${name}"`;
    } catch (error) {
      return `删除群聊失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'delete_chatroom',
    description: '【必须用户确认后才能调用】删除指定群聊。⚠️ 重要：删除前必须向用户确认。',
    schema: z.object({
      chatRoomId: z.string().describe('要删除的群聊ID'),
    }),
  },
);

// 群聊管理助手的工具列表
export const chatroomHelperTools = [
  createChatRoomTool,
  listChatRoomsTool,
  listAgentsTool,
  addAgentToChatRoomTool,
  removeAgentFromChatRoomTool,
  deleteChatRoomTool,
];
