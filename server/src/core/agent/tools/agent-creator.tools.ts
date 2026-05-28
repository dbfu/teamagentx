import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { createSystemTool as tool } from './system-tool.js';
import { agentService } from '../../../core/agent/agent.service.js';
import { categoryService } from '../../../modules/category/category.service.js';
import { llmProviderService } from '../../../modules/llm-provider/llm-provider.service.js';
import {
  getSharedSkillsDir,
  installDefaultSkillsForNewAgent,
} from '../../../modules/skill/preinstalled-skills.js';
import { skillInstallService } from '../../../modules/skill/skill-install.service.js';
import { createSkillDirectoryLink } from '../../../modules/skill/skill-link.js';
import { readSkillMetadata } from '../../../modules/skill/skill-metadata.js';
import { installSkillFromSourceTool } from './skills-helper.tools.js';
import { listSharedSkillsTool } from './skill-manager.tools.js';
import {
  deserializeAgentSpeechConfig,
  normalizeAgentSpeechConfig,
  type AgentSpeechConfig,
} from '../../../modules/speech/speech-config.js';
import {
  inferSpeechPresetId,
  resolveSpeechConfigInput,
  SPEECH_PRESETS,
  type SpeechPresetId,
} from '../../../modules/speech/speech-presets.js';
import {
  buildSpeechVoiceCatalog,
} from '../../../modules/speech/voice-catalog.js';
import { clearExecutorCacheEntries } from '../agent-handler/cache.js';

// 助手生成助手的专用 ID
export const AGENT_CREATOR_AGENT_ID = '29ffb519-82d2-4c32-8bc8-0b8d814a4eee';

// 本地 Agent 工具枚举
export const ACP_TOOL_VALUES = [
  'claude',
  'codex',
] as const;

export type AcpToolValue = (typeof ACP_TOOL_VALUES)[number];

const LLM_MODEL_TYPES = ['text', 'image', 'video', 'audio'] as const;
const IMAGE_GEN_API_TYPES = ['sync', 'async', 'auto'] as const;
const AUDIO_USAGE_VALUES = ['tts', 'stt', 'both'] as const;

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
  speechPresetId?: SpeechPresetId;
  speechConfig?: AgentSpeechConfig;
  autoInstallSkillNames?: string[];
};

type SkillSummary = {
  slug: string;
  name: string;
  description: string;
  sourceDir: string;
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

function listSharedSkillSummaries(): SkillSummary[] {
  const sharedSkillsDir = getSharedSkillsDir();
  if (!fs.existsSync(sharedSkillsDir)) return [];

  const entries = fs.readdirSync(sharedSkillsDir, { withFileTypes: true });
  const summaries: SkillSummary[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const sourceDir = path.join(sharedSkillsDir, entry.name);
    const skillMdPath = path.join(sourceDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    const metadata = readSkillMetadata(skillMdPath);
    if (!metadata.name || !metadata.description) continue;

    summaries.push({
      slug: entry.name,
      name: metadata.name,
      description: metadata.description,
      sourceDir,
    });
  }

  return summaries;
}

async function installModelSelectedSkills(
  agent: { id: string; name: string; type: 'builtin' | 'acp'; workDir: string | null },
  skillNames: string[] | undefined,
): Promise<{ installed: string[]; skipped: string[] }> {
  const requestedSkillNames = Array.from(new Set((skillNames || []).map((name) => name.trim()).filter(Boolean)));
  if (requestedSkillNames.length === 0) {
    return { installed: [], skipped: [] };
  }

  const sharedSkills = listSharedSkillSummaries();
  const skillByName = new Map<string, SkillSummary>();
  for (const skill of sharedSkills) {
    skillByName.set(skill.slug.toLowerCase(), skill);
    skillByName.set(skill.name.toLowerCase(), skill);
  }

  const targetSkillsDir = skillInstallService.getAgentSkillsDir(agent);
  const installedSkills: string[] = [];
  const skippedSkills: string[] = [];
  fs.mkdirSync(targetSkillsDir, { recursive: true });

  for (const skillName of requestedSkillNames) {
    const skill = skillByName.get(skillName.toLowerCase());
    if (!skill) {
      skippedSkills.push(skillName);
      continue;
    }

    const targetSymlink = path.join(targetSkillsDir, skill.slug);
    if (fs.existsSync(targetSymlink)) {
      installedSkills.push(skill.slug);
      continue;
    }

    try {
      createSkillDirectoryLink(skill.sourceDir, targetSymlink);
      installedSkills.push(skill.slug);
      console.log(`[agent-creator] 已根据模型选择为「${agent.name}」安装技能: ${skill.slug}`);
    } catch (error) {
      skippedSkills.push(skillName);
      console.warn(`[agent-creator] 为「${agent.name}」安装模型选择的技能失败: ${skill.slug}`, error);
    }
  }

  return { installed: installedSkills, skipped: skippedSkills };
}

const speechPresetIdSchema = z
  .enum(['system-default', 'gentle-guide', 'steady-pro', 'bright-host'])
  .optional()
  .describe('内置语音预设 ID：system-default / gentle-guide / steady-pro / bright-host');

// speechConfig zod schema（复用）
const speechConfigSchema = z
  .object({
    behavior: z.object({
      enabled: z.boolean().describe('是否启用语音播报'),
      outputMode: z.enum(['off', 'manual', 'auto_final_only']).describe('播报模式：off 关闭，manual 手动播放，auto_final_only 自动播报最终回答'),
      autoPlay: z.boolean().default(false).describe('是否自动播放，默认 false'),
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
    speechPresetId,
    speechConfig,
    autoInstallSkillNames,
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
        speechConfig: resolveSpeechConfigInput({
          speechPresetId,
          speechConfig: speechConfig ?? null,
          currentSpeechConfig: null,
        }),
      });
      const installedDefaultSkills = await installDefaultSkillsForNewAgent(agent);
      const selectedSkillsResult = await installModelSelectedSkills(agent, autoInstallSkillNames);

      return JSON.stringify({
        success: true,
        agent: {
          id: agent.id,
          name: agent.name,
          description: agent.description,
          type: agent.type,
        },
        installedDefaultSkills,
        modelSelectedSkills: selectedSkillsResult.installed,
        skippedModelSelectedSkills: selectedSkillsResult.skipped,
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
      acpTool: z.enum(ACP_TOOL_VALUES).optional().describe('本地 Agent 工具名称（type=acp 时默认 claude）'),
      workDir: z.string().optional().describe('工作目录路径，可选'),
      llmProviderId: z
        .string()
        .optional()
        .describe('LLM供应商ID，可选；本地 Agent 仅支持 claude/anthropic 和 codex/openai'),
      categoryId: z.string().optional().describe('分类ID，可选'),
      speechPresetId: speechPresetIdSchema,
      speechConfig: speechConfigSchema,
      autoInstallSkillNames: z
        .array(z.string())
        .optional()
        .describe('由模型根据 list_shared_skills 返回的共享技能列表自行选择要安装的技能名称或目录名。不要猜测；没有合适技能时传空数组或省略。'),
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
      installedDefaultSkills?: string[];
      modelSelectedSkills?: string[];
      skippedModelSelectedSkills?: string[];
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
          speechConfig: resolveSpeechConfigInput({
            speechPresetId: config.speechPresetId,
            speechConfig: config.speechConfig ?? null,
            currentSpeechConfig: null,
          }),
        });
        const installedDefaultSkills = await installDefaultSkillsForNewAgent(agent);
        const selectedSkillsResult = await installModelSelectedSkills(agent, config.autoInstallSkillNames);

        results.push({
          name: config.name,
          success: true,
          agent: {
            id: agent.id,
            name: agent.name,
            description: agent.description || '',
            type: agent.type,
          },
          installedDefaultSkills,
          modelSelectedSkills: selectedSkillsResult.installed,
          skippedModelSelectedSkills: selectedSkillsResult.skipped,
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
            acpTool: z.enum(ACP_TOOL_VALUES).optional().describe('本地 Agent 工具名称（type=acp 时默认 claude）'),
            workDir: z.string().optional().describe('工作目录路径'),
            llmProviderId: z
              .string()
              .optional()
              .describe('LLM供应商ID；本地 Agent 仅支持 claude/anthropic 和 codex/openai'),
            categoryId: z.string().optional().describe('分类ID'),
            speechPresetId: speechPresetIdSchema,
            speechConfig: speechConfigSchema,
            autoInstallSkillNames: z
              .array(z.string())
              .optional()
              .describe('由模型根据 list_shared_skills 返回的共享技能列表自行选择要安装的技能名称或目录名。不要猜测；没有合适技能时传空数组或省略。'),
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
    modelType,
    apiProtocol,
    sttModel,
    audioUsage,
    imageProvider,
    imageApiType,
    isActive,
    isDefault,
  }: {
    name: string;
    apiUrl?: string;
    apiKey: string;
    model: string;
    modelType?: (typeof LLM_MODEL_TYPES)[number];
    apiProtocol?: 'anthropic' | 'openai';
    sttModel?: string | null;
    audioUsage?: (typeof AUDIO_USAGE_VALUES)[number] | null;
    imageProvider?: string | null;
    imageApiType?: (typeof IMAGE_GEN_API_TYPES)[number] | null;
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
        modelType: modelType || 'text',
        apiProtocol: apiProtocol || 'anthropic',
        sttModel,
        audioUsage,
        imageProvider,
        imageApiType,
        isActive: isActive ?? true,
        isDefault: isDefault ?? false,
      });
      clearExecutorCacheEntries();

      return JSON.stringify({
        success: true,
        provider: {
          id: provider.id,
          name: provider.name,
          modelType: provider.modelType,
          apiUrl: provider.apiUrl,
          model: provider.model,
          sttModel: provider.sttModel,
          audioUsage: provider.audioUsage,
          imageProvider: provider.imageProvider,
          imageApiType: provider.imageApiType,
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
    description: '【必须用户确认后才能调用】创建一个新的模型配置，支持文本、图片、语音、视频模型。⚠️ 重要：调用此工具前，必须先向用户展示模型配置信息（名称、模型类型、协议、API URL、API Key、模型名称，以及图片/语音专用字段），并明确询问"是否确认创建？"等待用户回复确认后才能调用。如果用户提出修改，调整配置后再次确认。',
    schema: z.object({
      name: z.string().describe('模型配置名称，必须唯一，例如"我的Claude API"'),
      modelType: z.enum(LLM_MODEL_TYPES).optional().describe('模型类型，默认 text。text=文本，image=图片，audio=语音，video=视频'),
      apiUrl: z.string().optional().describe('API 端点 URL，例如 https://api.anthropic.com 或 https://api.openai.com/v1'),
      apiKey: z.string().describe('API Key'),
      model: z.string().describe('模型名称，例如 claude-sonnet-4-20250514'),
      apiProtocol: z.enum(['anthropic', 'openai']).optional().describe('API 协议类型，anthropic 支持 thinking/prompt caching，openai 兼容更多模型，默认 anthropic'),
      sttModel: z.string().nullable().optional().describe('语音识别模型，仅 audio 类型需要；留空则与 model 共用'),
      audioUsage: z.enum(AUDIO_USAGE_VALUES).nullable().optional().describe('语音模型用途，仅 audio 类型需要：tts、stt 或 both，默认 both'),
      imageProvider: z.string().nullable().optional().describe('图片模型供应商，仅 image 类型需要，例如 openai、apimart、openrouter、gemini'),
      imageApiType: z.enum(IMAGE_GEN_API_TYPES).nullable().optional().describe('图片模型调用方式，仅 image 类型需要：sync、async 或 auto，默认 sync'),
      isActive: z.boolean().optional().describe('是否激活，默认 true'),
      isDefault: z.boolean().optional().describe('是否设为默认模型，默认 false'),
    }),
  },
);

// 查询助手工具（用于找到要更新的助手 ID）
export const listAgentsTool = tool(
  async () => {
    const agents = await agentService.findAll();
    if (agents.length === 0) return '暂无助手。';
    return agents
      .map((a) => {
        const parsedSpeechConfig = deserializeAgentSpeechConfig(a.speechConfig);
        const inferredPresetId = inferSpeechPresetId(parsedSpeechConfig);
        return `ID: ${a.id}\n名称: ${a.name}\n级别: ${a.agentLevel === 'system' ? '系统助手' : '自定义助手'}\n描述: ${a.description || '无'}\n分类ID: ${a.categoryId || '未分类'}\n分类名称: ${a.category?.name || '未分类'}\n语音预设: ${inferredPresetId || '自定义/未匹配'}\n语音: ${a.speechConfig ? String(a.speechConfig) : '未配置'}`;
      })
      .join('\n\n');
  },
  {
    name: 'list_agents',
    description: '列出所有助手及其当前配置（含系统助手、分类信息与语音配置），用于查找需要更新的助手 ID。',
    schema: z.object({}),
  },
);

export const listCategoriesTool = tool(
  async () => {
    const categories = await categoryService.findAll();
    if (categories.length === 0) return '暂无助手分类。';
    return categories
      .map((category) => (
        `ID: ${category.id}\n名称: ${category.name}\n描述: ${category.description || '无'}\n助手数量: ${category._count?.agents ?? 0}`
      ))
      .join('\n\n');
  },
  {
    name: 'list_categories',
    description: '列出所有助手分类及其 ID，用于按分类名称查找对应 UUID，并给助手设置 categoryId。',
    schema: z.object({}),
  },
);

export const listVoicePresetsTool = tool(
  async () => {
    return SPEECH_PRESETS.map((preset) =>
      `ID: ${preset.id}\n名称: ${preset.name}\n适合: ${preset.recommendedFor.join('、')}\n说明: ${preset.description}\n默认语音配置: ${JSON.stringify(preset.speechConfig)}`,
    ).join('\n\n');
  },
  {
    name: 'list_voice_presets',
    description: '列出系统内置语音预设列表及默认配置。创建或编辑助手前，先调用此工具为助手选择最合适的语音预设。',
    schema: z.object({}),
  },
);

export const listVoiceCatalogTool = tool(
  async () => {
    const audioProviders = await llmProviderService.findActive('audio');
    const catalog = buildSpeechVoiceCatalog({
      audioProviders,
      browserLocalSnapshot: null,
    });

    const localSection = [
      '本地音色（browser-local）',
      '- 本地音色与当前浏览器/设备绑定，助手管理工具不会跨用户或跨设备读取具体列表。',
      '- 如需查看本机真实可用音色，请在当前客户端打开助手详情页语音设置，或调用当前登录客户端对应的 /speech/catalog。',
      '- 未拿到当前客户端本地音色 ID 时，配置 browser-local 请优先使用 voice=null，避免猜测音色名称。',
    ].join('\n');

    const remoteSection = catalog.remoteProviders.length > 0
      ? catalog.remoteProviders.map((provider) => {
          const modelLines = provider.models.map((model) => {
            const voiceLines = model.voices.length > 0
              ? model.voices.map((voice) => `    - ${voice.id} | ${voice.label}`).join('\n')
              : '    - 未提供静态音色列表，可手动填写 profile.voice';
            return `  模型: ${model.id}\n${voiceLines}`;
          }).join('\n');

          return [
            `供应商ID: ${provider.llmProviderId}`,
            `名称: ${provider.llmProviderName}`,
            `类型: ${provider.providerLabel}`,
            `API: ${provider.apiUrl || '未配置'}`,
            '配置要点:',
            '  profile.provider = openai-compatible-tts',
            `  profile.vendorOptions.llmProviderId = ${provider.llmProviderId}`,
            modelLines,
          ].join('\n');
        }).join('\n\n')
      : '暂无可用远程 TTS 供应商。请先在模型管理中配置 audio 类型且 audioUsage 为 tts/both 的 openai 协议模型。';

    return `${localSection}\n\n远程音色目录\n${remoteSection}`;
  },
  {
    name: 'list_voice_catalog',
    description: '列出当前可配置的完整语音目录，包含最近一次客户端上报的本地 browser-local 音色，以及所有可用远程 TTS 供应商的 providerId、模型和音色列表。配置助手语音前优先使用此工具。',
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
    speechPresetId,
    speechConfig,
    llmProviderId,
    categoryId,
  }: {
    agentId: string;
    name?: string;
    description?: string;
    prompt?: string;
    speechPresetId?: SpeechPresetId;
    speechConfig?: AgentSpeechConfig;
    llmProviderId?: string;
    categoryId?: string;
  }) => {
    try {
      const currentAgent = await agentService.findById(agentId);
      if (!currentAgent) {
        return JSON.stringify({
          success: false,
          error: '助手不存在',
        });
      }

      const agent = await agentService.update(agentId, {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(prompt !== undefined && { prompt }),
        ...(llmProviderId !== undefined && { llmProviderId }),
        ...(categoryId !== undefined && { categoryId }),
        ...((speechPresetId !== undefined || speechConfig !== undefined) && {
          speechConfig: resolveSpeechConfigInput({
            speechPresetId,
            speechConfig: speechConfig ?? null,
            currentSpeechConfig: deserializeAgentSpeechConfig(currentAgent.speechConfig),
          }),
        }),
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
      speechPresetId: speechPresetIdSchema,
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
      speechPresetId?: SpeechPresetId;
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
        const currentAgent = await agentService.findById(config.agentId);
        if (!currentAgent) {
          results.push({
            agentId: config.agentId,
            success: false,
            error: '助手不存在',
          });
          failCount++;
          continue;
        }

        const agent = await agentService.update(config.agentId, {
          ...(config.name !== undefined && { name: config.name }),
          ...(config.description !== undefined && { description: config.description }),
          ...(config.prompt !== undefined && { prompt: config.prompt }),
          ...(config.llmProviderId !== undefined && { llmProviderId: config.llmProviderId }),
          ...(config.categoryId !== undefined && { categoryId: config.categoryId }),
          ...((config.speechPresetId !== undefined || config.speechConfig !== undefined) && {
            speechConfig: resolveSpeechConfigInput({
              speechPresetId: config.speechPresetId,
              speechConfig: config.speechConfig ?? null,
              currentSpeechConfig: deserializeAgentSpeechConfig(currentAgent.speechConfig),
            }),
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
            speechPresetId: speechPresetIdSchema,
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
  listCategoriesTool,
  listVoicePresetsTool,
  listVoiceCatalogTool,
  listSharedSkillsTool,
  updateAgentTool,
  updateAgentsTool,
  listLlmProvidersTool,
  createLlmProviderTool,
  installSkillFromSourceTool,
];
