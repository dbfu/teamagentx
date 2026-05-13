import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import { agentService } from '../../../core/agent/agent.service.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';
import { installSkillFromSourceTool } from './skills-helper.tools.js';
import { getChatHistoryTool } from './skill-manager.tools.js';

// 助手生成助手的专用 ID
export const AGENT_CREATOR_AGENT_ID = '29ffb519-82d2-4c32-8bc8-0b8d814a4eee';

// ACP 工具枚举
export const ACP_TOOL_VALUES = [
  'claude',
  'codex',
] as const;

export type AcpToolValue = (typeof ACP_TOOL_VALUES)[number];

// 单个助手配置类型
type AgentConfig = {
  name: string;
  description: string;
  prompt: string;
  avatar?: string;
  avatarColor?: string;
  type?: 'builtin' | 'acp';
  acpTool?: AcpToolValue;
  workDir?: string;
  llmProviderId?: string;
  categoryId?: string;
};

function normalizeAgentTypeConfig(config: Pick<AgentConfig, 'type' | 'acpTool'>): {
  type: 'builtin' | 'acp';
  acpTool?: AcpToolValue;
} {
  const type = config.type || 'acp';
  return {
    type,
    acpTool: type === 'acp' ? (config.acpTool || 'claude') : undefined,
  };
}

// 创建助手工具
export const createAgentTool = tool(
  async ({
    name,
    description,
    prompt,
    avatar,
    avatarColor,
    type,
    acpTool,
    workDir,
    llmProviderId,
    categoryId,
  }: AgentConfig) => {
    try {
      const normalizedType = normalizeAgentTypeConfig({ type, acpTool });

      // 检查名称是否已存在
      const existing = await agentService.findByName(name);
      if (existing) {
        return `助手名称 "${name}" 已存在，请使用其他名称。`;
      }

      const agent = await agentService.create({
        name,
        description,
        prompt,
        avatar: avatar || 'Bot',
        avatarColor: avatarColor || 'bg-blue-500',
        type: normalizedType.type,
        acpTool: normalizedType.acpTool,
        workDir,
        llmProviderId,
        categoryId,
      });

      return JSON.stringify({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          type: agent.type,
        },
        message: `成功创建助手 "${name}"。用户可以在群聊中通过 @${name} 来使用它。`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '创建失败',
      });
    }
  },
  {
    name: 'create_agent',
    description: '【必须用户确认后才能调用】创建一个新的AI助手。⚠️ 重要：调用此工具前，必须先向用户展示助手配置（名称、描述、核心能力），并明确询问"是否确认创建？"等待用户回复确认后才能调用。如果用户提出修改，调整配置后再次确认。',
    schema: z.object({
      name: z.string().describe('助手名称，必须唯一'),
      description: z.string().describe('助手功能描述'),
      prompt: z.string().describe('系统提示词，定义助手的行为和能力'),
      avatar: z.string().optional().describe('头像图标名称'),
      avatarColor: z
        .string()
        .optional()
        .describe('头像背景颜色，Tailwind渐变类'),
      type: z
        .enum(['builtin', 'acp'])
        .optional()
        .describe('助手类型，默认 acp'),
      acpTool: z.enum(ACP_TOOL_VALUES).optional().describe('ACP 工具名称（type=acp 时默认 claude）'),
      workDir: z.string().optional().describe('工作目录路径，可选'),
      llmProviderId: z
        .string()
        .optional()
        .describe('LLM供应商ID，可选；ACP 仅支持 claude/anthropic 和 codex/openai'),
      categoryId: z.string().optional().describe('分类ID，可选'),
    }),
  },
);

// 批量创建助手工具
export const createAgentsTool = tool(
  async ({ agents }: { agents: AgentConfig[] }) => {
    if (!agents || agents.length === 0) {
      return JSON.stringify({
        success: false,
        error: '请提供至少一个助手配置',
      });
    }

    const results: Array<{
      name: string;
      success: boolean;
      agent?: { id: string; name: string; description: string; type: string };
      error?: string;
    }> = [];

    let successCount = 0;
    let failCount = 0;

    for (const config of agents) {
      try {
        const normalizedType = normalizeAgentTypeConfig(config);

        // 检查名称是否已存在
        const existing = await agentService.findByName(config.name);
        if (existing) {
          results.push({
            name: config.name,
            success: false,
            error: `助手名称 "${config.name}" 已存在`,
          });
          failCount++;
          continue;
        }

        const agent = await agentService.create({
          name: config.name,
          description: config.description,
          prompt: config.prompt,
          avatar: config.avatar || 'Bot',
          avatarColor: config.avatarColor || 'bg-blue-500',
          type: normalizedType.type,
          acpTool: normalizedType.acpTool,
          workDir: config.workDir,
          llmProviderId: config.llmProviderId,
          categoryId: config.categoryId,
        });

        results.push({
          name: config.name,
          success: true,
          agent: {
            id: agent.id,
            name: agent.name,
            description: agent.description || '',
            type: agent.type,
          },
        });
        successCount++;
      } catch (error) {
        results.push({
          name: config.name,
          success: false,
          error: error instanceof Error ? error.message : '创建失败',
        });
        failCount++;
      }
    }

    return JSON.stringify({
      success: successCount > 0,
      summary: `批量创建完成：成功 ${successCount} 个，失败 ${failCount} 个`,
      results,
    });
  },
  {
    name: 'create_agents',
    description: '【必须用户确认后才能调用】批量创建多个AI助手。⚠️ 重要：调用此工具前，必须先向用户展示所有助手配置（名称、描述、核心能力），并明确询问"是否确认创建这些助手？"等待用户回复确认后才能调用。如果用户提出修改，调整配置后再次确认。',
    schema: z.object({
      agents: z
        .array(
          z.object({
            name: z.string().describe('助手名称，必须唯一'),
            description: z.string().describe('助手功能描述'),
            prompt: z.string().describe('系统提示词，定义助手的行为和能力'),
            avatar: z.string().optional().describe('头像图标名称'),
            avatarColor: z.string().optional().describe('头像背景颜色'),
            type: z.enum(['builtin', 'acp']).optional().describe('助手类型，默认 acp'),
            acpTool: z.enum(ACP_TOOL_VALUES).optional().describe('ACP 工具名称（type=acp 时默认 claude）'),
            workDir: z.string().optional().describe('工作目录路径'),
            llmProviderId: z
              .string()
              .optional()
              .describe('LLM供应商ID；ACP 仅支持 claude/anthropic 和 codex/openai'),
            categoryId: z.string().optional().describe('分类ID'),
          }),
        )
        .describe('助手配置数组'),
    }),
  },
);

// 列出可用 LLM 供应商工具
export const listLlmProvidersTool = tool(
  async () => {
    const providers = await llmProviderService.findAll();
    const activeProviders = providers.filter((p) => p.isActive && ((p as any).modelType || 'text') === 'text');
    if (activeProviders.length === 0) {
      return '没有可用的 LLM 供应商。请先在设置中配置 LLM Provider。';
    }
    return activeProviders
      .map(
        (p) =>
          `ID: ${p.id}\n名称: ${p.name}\n类型: ${p.type}\n模型类型: ${(p as any).modelType || 'text'}\n模型: ${p.model}\n默认: ${p.isDefault ? '是' : '否'}`,
      )
      .join('\n\n');
  },
  {
    name: 'list_llm_providers',
    description: '列出所有可用的 LLM 供应商，用于为新助手选择 LLM。',
    schema: z.object({}),
  },
);

// 创建 LLM 供应商工具
export const createLlmProviderTool = tool(
  async ({
    name,
    apiUrl,
    apiKey,
    model,
    apiProtocol,
    isActive,
    isDefault,
  }: {
    name: string;
    apiUrl: string;
    apiKey: string;
    model: string;
    apiProtocol?: 'anthropic' | 'openai';
    isActive?: boolean;
    isDefault?: boolean;
  }) => {
    try {
      // 检查名称是否已存在
      const existing = await llmProviderService.findByName(name);
      if (existing) {
        return JSON.stringify({
          success: false,
          error: `模型配置名称 "${name}" 已存在，请使用其他名称。`,
        });
      }

      const provider = await llmProviderService.create({
        name,
        type: 'custom',
        apiUrl,
        apiKey,
        model,
        apiProtocol: apiProtocol || 'anthropic',
        isActive: isActive ?? true,
        isDefault: isDefault ?? false,
      });

      return JSON.stringify({
        success: true,
        provider: {
          id: provider.id,
          name: provider.name,
          apiUrl: provider.apiUrl,
          model: provider.model,
          apiProtocol: provider.apiProtocol,
          isDefault: provider.isDefault,
        },
        message: `成功创建模型配置 "${name}"。用户可以在创建助手时选择使用这个模型。`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '创建失败',
      });
    }
  },
  {
    name: 'create_llm_provider',
    description: '【必须用户确认后才能调用】创建一个新的LLM模型配置。⚠️ 重要：调用此工具前，必须先向用户展示模型配置信息（名称、API URL、API Key、模型名称），并明确询问"是否确认创建？"等待用户回复确认后才能调用。如果用户提出修改，调整配置后再次确认。',
    schema: z.object({
      name: z.string().describe('模型配置名称，必须唯一，例如"我的Claude API"'),
      apiUrl: z.string().describe('API 端点 URL，例如 https://api.anthropic.com'),
      apiKey: z.string().describe('API Key'),
      model: z.string().describe('模型名称，例如 claude-sonnet-4-20250514'),
      apiProtocol: z.enum(['anthropic', 'openai']).optional().describe('API 协议类型，anthropic 支持 thinking/prompt caching，openai 兼容更多模型，默认 anthropic'),
      isActive: z.boolean().optional().describe('是否激活，默认 true'),
      isDefault: z.boolean().optional().describe('是否设为默认模型，默认 false'),
    }),
  },
);

// 助手生成助手的工具列表
export const agentCreatorTools = [
  createAgentTool,
  createAgentsTool, // 批量创建助手
  listLlmProvidersTool,
  createLlmProviderTool, // 创建模型配置
  installSkillFromSourceTool,
  getChatHistoryTool, // 获取对话历史，用于从对话生成助手
];
