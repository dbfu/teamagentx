import { z } from 'zod';
import { tool } from 'langchain';
import { agentService } from '../../../core/agent/agent.service.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';
import { installSkillFromSourceTool } from './skills-helper.tools.js';
import { getChatHistoryTool } from './skill-manager.tools.js';
import { normalizeAgentSpeechConfig, type AgentSpeechConfig } from '../../../modules/speech/speech-config.js';

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
  speechConfig?: AgentSpeechConfig;
};

// speechConfig zod schema（复用）
const speechConfigSchema = z
  .object({
    behavior: z.object({
      enabled: z.boolean().describe('是否启用语音播报'),
      outputMode: z.enum(['off', 'manual', 'auto_final_only']).describe('播报模式：off 关闭，manual 手动播放，auto_final_only 自动播报最终回答'),
      autoPlay: z.boolean().optional().describe('是否自动播放，默认 false'),
    }),
    profile: z.object({
      provider: z.string().nullable().optional().describe('provider，默认 browser-local'),
      model: z.string().nullable().optional().describe('模型标识'),
      voice: z.string().nullable().optional().describe('音色 ID，null 表示自动选择'),
      fallbackProvider: z.string().nullable().optional().describe('回退 provider'),
      speed: z.number().min(0.5).max(2).optional().describe('语速，0.5-2，默认 1'),
      volume: z.number().min(0).max(1).optional().describe('音量，0-1，默认 1'),
      pitch: z.number().nullable().optional().describe('音高'),
      emotion: z.string().nullable().optional().describe('情绪'),
      style: z.string().nullable().optional().describe('风格'),
      format: z.string().nullable().optional().describe('输出格式'),
      sampleRate: z.number().nullable().optional().describe('采样率'),
      temperature: z.number().nullable().optional().describe('采样温度'),
      prompt: z.string().nullable().optional().describe('语音风格提示词'),
      vendorOptions: z.record(z.string(), z.unknown()).nullable().optional().describe('厂商扩展参数'),
    }),
  })
  .optional()
  .describe('语音播报配置，不填则不设置语音');

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
    speechConfig,
  }: AgentConfig) => {
    try {
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
        type: type || 'builtin',
        acpTool,
        workDir,
        llmProviderId,
        categoryId,
        speechConfig: speechConfig ? normalizeAgentSpeechConfig(speechConfig) : null,
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
        .describe('助手类型，默认 builtin'),
      acpTool: z.enum(ACP_TOOL_VALUES).optional().describe('ACP 工具名称（仅 type=acp 时需要）'),
      workDir: z.string().optional().describe('工作目录路径，可选'),
      llmProviderId: z
        .string()
        .optional()
        .describe('LLM供应商ID，可选；ACP 仅支持 claude/anthropic 和 codex/openai'),
      categoryId: z.string().optional().describe('分类ID，可选'),
      speechConfig: speechConfigSchema,
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
          type: config.type || 'builtin',
          acpTool: config.acpTool,
          workDir: config.workDir,
          llmProviderId: config.llmProviderId,
          categoryId: config.categoryId,
          speechConfig: config.speechConfig ? normalizeAgentSpeechConfig(config.speechConfig) : null,
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
            type: z.enum(['builtin', 'acp']).optional().describe('助手类型，默认 builtin'),
            acpTool: z.enum(ACP_TOOL_VALUES).optional().describe('ACP 工具名称'),
            workDir: z.string().optional().describe('工作目录路径'),
            llmProviderId: z
              .string()
              .optional()
              .describe('LLM供应商ID；ACP 仅支持 claude/anthropic 和 codex/openai'),
            categoryId: z.string().optional().describe('分类ID'),
            speechConfig: speechConfigSchema,
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
    const activeProviders = providers.filter((p) => p.isActive);
    if (activeProviders.length === 0) {
      return '没有可用的 LLM 供应商。请先在设置中配置 LLM Provider。';
    }
    return activeProviders
      .map(
        (p) =>
          `ID: ${p.id}\n名称: ${p.name}\n类型: ${p.type}\n模型: ${p.model}\n默认: ${p.isDefault ? '是' : '否'}`,
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

// 查询助手工具（用于找到要更新的助手 ID）
export const listAgentsTool = tool(
  async () => {
    const agents = await agentService.findAll();
    const custom = agents.filter((a) => a.agentLevel !== 'system');
    if (custom.length === 0) return '暂无自定义助手。';
    return custom
      .map(
        (a) =>
          `ID: ${a.id}\n名称: ${a.name}\n描述: ${a.description || '无'}\n语音: ${a.speechConfig ? JSON.stringify(a.speechConfig) : '未配置'}`,
      )
      .join('\n\n');
  },
  {
    name: 'list_agents',
    description: '列出所有自定义助手及其当前配置（含语音配置），用于查找需要更新的助手 ID。',
    schema: z.object({}),
  },
);

// 更新助手工具
export const updateAgentTool = tool(
  async ({
    agentId,
    name,
    description,
    prompt,
    speechConfig,
    llmProviderId,
    categoryId,
  }: {
    agentId: string;
    name?: string;
    description?: string;
    prompt?: string;
    speechConfig?: AgentSpeechConfig;
    llmProviderId?: string;
    categoryId?: string;
  }) => {
    try {
      const agent = await agentService.update(agentId, {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(prompt !== undefined && { prompt }),
        ...(llmProviderId !== undefined && { llmProviderId }),
        ...(categoryId !== undefined && { categoryId }),
        ...(speechConfig !== undefined && { speechConfig: normalizeAgentSpeechConfig(speechConfig) }),
      });

      return JSON.stringify({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          speechConfig: agent.speechConfig,
        },
        message: `成功更新助手 "${agent.name}"。`,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : '更新失败',
      });
    }
  },
  {
    name: 'update_agent',
    description: '【必须用户确认后才能调用】更新已有助手的配置，包括语音播报设置。先用 list_agents 获取助手 ID，再调用此工具。',
    schema: z.object({
      agentId: z.string().describe('要更新的助手 ID'),
      name: z.string().optional().describe('新名称（可选）'),
      description: z.string().optional().describe('新描述（可选）'),
      prompt: z.string().optional().describe('新系统提示词（可选）'),
      speechConfig: speechConfigSchema,
      llmProviderId: z.string().optional().describe('新 LLM 供应商 ID（可选）'),
      categoryId: z.string().optional().describe('新分类 ID（可选）'),
    }),
  },
);

// 批量更新助手工具（串行执行，避免并发写库冲突）
export const updateAgentsTool = tool(
  async ({
    agents,
  }: {
    agents: Array<{
      agentId: string;
      name?: string;
      description?: string;
      prompt?: string;
      speechConfig?: AgentSpeechConfig;
      llmProviderId?: string;
      categoryId?: string;
    }>;
  }) => {
    if (!agents || agents.length === 0) {
      return JSON.stringify({ success: false, error: '请提供至少一个助手配置' });
    }

    const results: Array<{
      agentId: string;
      name?: string;
      success: boolean;
      error?: string;
    }> = [];
    let successCount = 0;
    let failCount = 0;

    for (const config of agents) {
      try {
        const agent = await agentService.update(config.agentId, {
          ...(config.name !== undefined && { name: config.name }),
          ...(config.description !== undefined && { description: config.description }),
          ...(config.prompt !== undefined && { prompt: config.prompt }),
          ...(config.llmProviderId !== undefined && { llmProviderId: config.llmProviderId }),
          ...(config.categoryId !== undefined && { categoryId: config.categoryId }),
          ...(config.speechConfig !== undefined && {
            speechConfig: normalizeAgentSpeechConfig(config.speechConfig),
          }),
        });
        results.push({ agentId: config.agentId, name: agent.name, success: true });
        successCount++;
      } catch (error) {
        results.push({
          agentId: config.agentId,
          success: false,
          error: error instanceof Error ? error.message : '更新失败',
        });
        failCount++;
      }
    }

    return JSON.stringify({
      success: successCount > 0,
      summary: `批量更新完成：成功 ${successCount} 个，失败 ${failCount} 个`,
      results,
    });
  },
  {
    name: 'update_agents',
    description:
      '【必须用户确认后才能调用】批量更新多个助手配置，串行执行避免并发冲突。需要同时更新多个助手时优先使用此工具，而非多次调用 update_agent。先用 list_agents 获取助手 ID，再调用此工具。',
    schema: z.object({
      agents: z
        .array(
          z.object({
            agentId: z.string().describe('要更新的助手 ID'),
            name: z.string().optional().describe('新名称（可选）'),
            description: z.string().optional().describe('新描述（可选）'),
            prompt: z.string().optional().describe('新系统提示词（可选）'),
            speechConfig: speechConfigSchema,
            llmProviderId: z.string().optional().describe('新 LLM 供应商 ID（可选）'),
            categoryId: z.string().optional().describe('新分类 ID（可选）'),
          }),
        )
        .describe('要更新的助手配置数组'),
    }),
  },
);

// 助手生成助手的工具列表
export const agentCreatorTools = [
  createAgentTool,
  createAgentsTool,
  listAgentsTool,
  updateAgentTool,
  updateAgentsTool,
  listLlmProvidersTool,
  createLlmProviderTool,
  installSkillFromSourceTool,
  getChatHistoryTool,
];
