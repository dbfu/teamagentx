/**
 * 群聊管理助手的工具定义
 * 用于创建群聊、管理群成员等
 */
import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import { chatRoomService } from '../../../modules/chatroom/chatroom.service.js';
import { agentService } from '../../../core/agent/agent.service.js';
import { broadcastChatRoomCreated, broadcastAgentsUpdated } from '../agent-handler/status.js';
import {
  broadcastAgentJoinedMessage,
  broadcastChatRoomRulesUpdatedMessage,
  broadcastChatRoomDispatchRulesUpdatedMessage,
} from '../agent-handler/message-utils.js';
import { clearExecutorCacheEntries } from '../agent-handler/cache.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';
import { createLlmClient } from '../../../lib/llm-client.js';
import {
  parseDispatchRulesYaml,
  stringifyDispatchRules,
  collectReferencedAgentNames,
} from '../dispatch-rules/schema.js';
import {
  buildDispatchRulesGenerationMessages,
} from '../dispatch-rules/generation.js';

// 群聊管理助手的专用 ID
export const CHATROOM_HELPER_AGENT_ID = 'c3d4e5f6-7890-abcd-ef12-345678901234';

const GROUP_AVATAR_COUNT = 24;

function getRandomGroupAvatarValue(): string {
  return String(Math.floor(Math.random() * (GROUP_AVATAR_COUNT - 1)) + 1);
}

async function resolveOwnerIdForNewChatRoom(sourceChatRoomId?: string): Promise<string | undefined> {
  if (!sourceChatRoomId) return undefined;

  const sourceChatRoom = await chatRoomService.findById(sourceChatRoomId);
  if (!sourceChatRoom) {
    throw new Error(`当前群聊不存在: ${sourceChatRoomId}`);
  }
  if (!sourceChatRoom.ownerId) {
    throw new Error(`当前群聊"${sourceChatRoom.name}"没有群主，无法创建新的归属群聊`);
  }

  return sourceChatRoom.ownerId;
}

// 创建群聊工具
export function createChatRoomToolForSource(sourceChatRoomId?: string) {
  return tool(
    async ({
      name,
      description,
      rules,
      agentIds,
      dispatchRules,
      injectGroupHistory = true,
    }: {
      name: string;
      description?: string;
      rules?: string;
      agentIds?: string[];
      dispatchRules?: string;
      injectGroupHistory?: boolean;
    }) => {
      try {
        const ownerId = await resolveOwnerIdForNewChatRoom(sourceChatRoomId);
        const createData = {
          name,
          description,
          // 群聊头像统一使用系统内置的随机编号头像，不由模型指定
          avatar: getRandomGroupAvatarValue(),
          rules: rules?.trim() || undefined,
        };
        // 创建群聊
        const chatRoom = ownerId
          ? await chatRoomService.createWithOwner({
              ...createData,
              ownerId,
            })
          : await chatRoomService.create(createData);

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
                injectGroupHistory,
              });
              addedAgents.push(agent.name);
            }
          }
        }

        // 建群时设置群调度规则（工作流）：优先用模型在 dispatchRules 字段里直接给出的规则，
        // 否则在已添加业务助手时按群内助手自动生成。尽力而为：失败不阻断建群，只在结果里提示。
        let dispatchRulesApplied = false;
        let dispatchRulesError: string | undefined;
        if (dispatchRules?.trim() || addedAgents.length > 0) {
          try {
            const ruleResult = await applyDispatchRulesForRoom(chatRoom.id, {
              providedYaml: dispatchRules,
            });
            dispatchRulesApplied = ruleResult.ok;
            if (!ruleResult.ok) {
              dispatchRulesError = ruleResult.error;
            }
          } catch (error) {
            dispatchRulesError = error instanceof Error ? error.message : '设置群调度规则失败';
          }
        }

        const latestChatRoom = await chatRoomService.findById(chatRoom.id);
        broadcastChatRoomCreated(latestChatRoom ?? chatRoom);

        return JSON.stringify({
          success: true,
          chatRoom: {
            id: chatRoom.id,
            name: chatRoom.name,
            description: chatRoom.description,
            rules: latestChatRoom?.rules ?? chatRoom.rules,
          },
          addedAgents,
          dispatchRulesApplied,
          ...(dispatchRulesError ? { dispatchRulesError } : {}),
          message: `成功创建群聊"${name}"${rules?.trim() ? '，已设置群规则' : ''}${addedAgents.length > 0 ? `，已添加助手: ${addedAgents.join(', ')}` : ''}${dispatchRulesApplied ? '，已设置群调度规则（工作流），可在群设置中查看可视化流程图' : ''}`,
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
    description: '【必须用户确认后才能调用】创建一个新的群聊，可同时设置群规则与群调度规则（工作流）。⚠️ 重要：调用前必须先向用户展示群聊配置（名称、描述、群规则、要添加的助手、群调度规则），并询问确认。',
    schema: z.object({
      name: z.string().describe('群聊名称'),
      description: z.string().optional().describe('群聊描述'),
      rules: z.string().optional().describe('创建群聊时同步写入的群规则内容，支持 Markdown 格式。未生成或用户不需要时可省略。'),
      agentIds: z.array(z.string()).optional().describe('要添加到群聊的助手ID列表'),
      dispatchRules: z
        .string()
        .optional()
        .describe(
          '群调度规则（工作流）YAML，描述群内助手如何协作调度。结构：version: 1；agents（name/role）；workflows（name + steps，步骤可为单个 agent、parallel 并行、oneOf 二选一，支持 when/on_pass/on_fail 流转）；可选 routing、constraints。建议在已知 agentIds 时一并生成并传入，其中引用的助手名必须都在群内；省略时若已添加助手会按群内助手自动生成。',
        ),
      injectGroupHistory: z
        .boolean()
        .optional()
        .describe('通过 agentIds 添加的助手是否可以访问群历史，默认 true；仅当用户明确要求不让助手访问群历史时才传 false'),
    }),
  },
);
}

export const createChatRoomTool = createChatRoomToolForSource();

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
    injectGroupHistory = true,
  }: {
    chatRoomId: string;
    agentIds: string[];
    injectGroupHistory?: boolean;
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
          injectGroupHistory,
        });
        addedAgents.push({ name: agent.name, description: agent.description });

        // 发送助手加入通知消息
        await broadcastAgentJoinedMessage(chatRoomId, agent.name, agent.description);
      }

      let message = `群聊"${chatRoom.name}"操作结果：`;
      if (addedAgents.length > 0) {
        message += `\n✅ 已添加: ${addedAgents.map(a => a.name).join(', ')}`;
        // 广播群聊助手列表更新事件，通知前端刷新
        broadcastAgentsUpdated(chatRoomId);
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
    description: '将助手添加到指定群聊。默认情况下被拉进群的助手可以访问群历史（injectGroupHistory=true），除非用户明确要求不让其访问群历史。',
    schema: z.object({
      chatRoomId: z.string().describe('群聊ID'),
      agentIds: z.array(z.string()).describe('要添加的助手ID列表'),
      injectGroupHistory: z
        .boolean()
        .optional()
        .describe('被添加的助手是否可以访问群历史，默认 true；仅当用户明确要求不让助手访问群历史时才传 false'),
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

      // 广播群聊助手列表更新事件，通知前端刷新
      broadcastAgentsUpdated(chatRoomId);

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

// 配置群规则工具
export const updateChatRoomRulesTool = tool(
  async ({
    chatRoomId,
    rules,
  }: {
    chatRoomId: string;
    rules: string;
  }) => {
    try {
      const chatRoom = await chatRoomService.findById(chatRoomId);
      if (!chatRoom) {
        return JSON.stringify({ success: false, error: `群聊不存在: ${chatRoomId}` });
      }

      const updatedChatRoom = await chatRoomService.update(chatRoomId, { rules });
      clearExecutorCacheEntries(undefined, chatRoomId);
      if ((chatRoom.rules ?? '') !== (updatedChatRoom.rules ?? '')) {
        await broadcastChatRoomRulesUpdatedMessage(chatRoomId, updatedChatRoom.rules);
      }

      return JSON.stringify({
        success: true,
        message: `✅ 已成功更新群聊"${chatRoom.name}"的群规则`,
        rules,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '更新群规则失败',
      });
    }
  },
  {
    name: 'update_chatroom_rules',
    description: '【需要用户确认】配置或更新群聊的群规则。群规则会注入到群内所有助手的上下文中，影响助手的行为和回复风格。',
    schema: z.object({
      chatRoomId: z.string().describe('群聊ID'),
      rules: z.string().describe('群规则内容，支持 Markdown 格式。传空字符串表示清空规则。'),
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

/**
 * 为群聊设置「群调度规则（工作流）」并保存：
 * - 传入 providedYaml 时直接校验并保存（create_chatroom 在 schema 里携带规则的路径）；
 * - 否则用默认模型按群内助手自动生成。
 * 供 generate_dispatch_rules 工具与 create_chatroom 共用。
 * 返回结构化结果，由调用方决定如何处理失败（建群时失败不应阻断建群）。
 */
export async function applyDispatchRulesForRoom(
  roomId: string,
  opts: { providedYaml?: string; instructions?: string } = {},
): Promise<{ ok: boolean; dispatchRules?: string; roomName?: string; error?: string }> {
  const chatRoom = await chatRoomService.findById(roomId);
  if (!chatRoom) {
    return { ok: false, error: `群聊不存在: ${roomId}` };
  }

  // 只把业务助手（非系统级、激活中）作为可调度对象
  const members = await chatRoomService.getAgents(roomId);
  const businessAgents = members
    .map((m) => m.agent)
    .filter(
      (a): a is NonNullable<typeof a> =>
        !!a && (a as any).agentLevel !== 'system' && (a as any).isActive !== false,
    )
    .map((a) => ({ name: a.name, description: (a as any).description ?? '' }));

  if (businessAgents.length === 0) {
    return { ok: false, error: '当前群聊没有可调度的业务助手，请先添加助手再生成调度规则' };
  }

  // 优先使用调用方直接提供的 YAML（create_chatroom 携带）；否则用默认模型按群内助手自动生成
  let yamlText: string;
  if (opts.providedYaml?.trim()) {
    // 去掉模型可能误加的代码围栏
    yamlText = opts.providedYaml.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
  } else {
    const provider = await llmProviderService.findDefault();
    if (!provider) {
      return { ok: false, error: '没有可用的默认模型配置，无法生成' };
    }

    const messages = buildDispatchRulesGenerationMessages({
      roomName: chatRoom.name,
      agents: businessAgents,
      ownerUsername: (chatRoom.owner as any)?.username,
      instructions: opts.instructions,
    });

    const client = createLlmClient(provider, { temperature: 0, maxTokens: 4096 });
    const raw = await client.invoke(messages);
    // 去掉模型可能误加的代码围栏
    yamlText = raw.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
  }

  const parsed = parseDispatchRulesYaml(yamlText);
  if (!parsed.ok || !parsed.data) {
    return { ok: false, error: `生成结果不符合格式，请重试。原因：${parsed.error}` };
  }

  // 校验引用的助手名都真实存在
  const validNames = new Set(businessAgents.map((a) => a.name));
  const unknown = collectReferencedAgentNames(parsed.data).filter((n) => !validNames.has(n));
  if (unknown.length > 0) {
    return { ok: false, error: `生成的规则引用了群里不存在的助手：${unknown.join(', ')}，请重试` };
  }

  const finalYaml = stringifyDispatchRules(parsed.data);
  await chatRoomService.update(roomId, { dispatchRules: finalYaml });
  clearExecutorCacheEntries(undefined, roomId);
  await broadcastChatRoomDispatchRulesUpdatedMessage(roomId, finalYaml);

  return { ok: true, dispatchRules: finalYaml, roomName: chatRoom.name };
}

// 生成 / 优化群调度规则（工作流）工具
export function generateDispatchRulesToolForSource(sourceChatRoomId?: string) {
  return tool(
    async ({
      chatRoomId,
      instructions,
    }: {
      chatRoomId?: string;
      instructions?: string;
    }) => {
      try {
        const roomId = chatRoomId?.trim() || sourceChatRoomId;
        if (!roomId) {
          return JSON.stringify({ success: false, error: '未指定群聊，且无法确定当前群聊' });
        }

        const result = await applyDispatchRulesForRoom(roomId, { instructions });
        if (!result.ok) {
          return JSON.stringify({ success: false, error: result.error });
        }

        return JSON.stringify({
          success: true,
          message: `✅ 已为群聊"${result.roomName}"生成群调度规则（工作流），可在群设置中查看可视化流程图`,
          dispatchRules: result.dispatchRules,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : '生成群调度规则失败',
        });
      }
    },
    {
      name: 'generate_dispatch_rules',
      description:
        '生成或优化群聊的「群调度规则（工作流）」。不指定 chatRoomId 时默认当前群聊。提供 instructions 时按用户要求优化，不提供时根据群内助手名称与描述自动生成。结果为结构化 YAML，注入给群调度助手并可在群设置中可视化。',
      schema: z.object({
        chatRoomId: z.string().optional().describe('群聊ID，不传则使用当前群聊'),
        instructions: z
          .string()
          .optional()
          .describe('用户对调度规则的要求或草稿（自然语言）；为空则根据群内助手自动生成'),
      }),
    },
  );
}

// 群聊管理助手的工具列表
export function createChatRoomHelperTools(sourceChatRoomId?: string) {
  return [
    createChatRoomToolForSource(sourceChatRoomId),
    listChatRoomsTool,
    listAgentsTool,
    addAgentToChatRoomTool,
    removeAgentFromChatRoomTool,
    updateChatRoomRulesTool,
    generateDispatchRulesToolForSource(sourceChatRoomId),
    deleteChatRoomTool,
  ];
}

export const chatroomHelperTools = createChatRoomHelperTools();
