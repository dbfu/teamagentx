import {
  type TemplateManifest,
} from './template-manifest.js';
import type {
  TemplateSkillPackage,
  TemplateSkillUsage,
} from './template-skill-packager.js';
import {
  buildTemplateSnapshot,
} from './template-snapshot.js';
import type { CapabilityDescriptor } from './capability-mapper.js';
import {
  createDefaultAgentSpeechConfig,
  normalizeAgentSpeechConfig,
} from '../speech/speech-config.js';

interface BuildTemplatePackagePayloadInput {
  templateId: string;
  version: string;
  title: string;
  summary?: string | null;
  sourceType: 'local' | 'market';
  sourceAuthor?: string | null;
  room: Parameters<typeof buildTemplateSnapshot>[0]['room'];
  agents: Parameters<typeof buildTemplateSnapshot>[0]['agents'];
  categories: Parameters<typeof buildTemplateSnapshot>[0]['categories'];
  cronTasks: Parameters<typeof buildTemplateSnapshot>[0]['cronTasks'];
  skills?: TemplateSkillPackage[];
  skillUsages?: TemplateSkillUsage[];
  degradedSkills?: Array<{ slug: string; reason: string }>;
  includeSkills?: boolean;
  includeCronTasks?: boolean;
}

export function buildTemplatePackagePayload(input: BuildTemplatePackagePayloadInput) {
  const includedCronTasks = input.includeCronTasks === false ? [] : input.cronTasks;
  const includedSkills = input.includeSkills === false ? [] : (input.skills ?? []);
  const includedSkillUsages = input.includeSkills === false ? [] : (input.skillUsages ?? []);
  const includedDegradedSkills = input.includeSkills === false ? [] : (input.degradedSkills ?? []);

  const snapshot = buildTemplateSnapshot({
    room: input.room,
    agents: input.agents,
    categories: input.categories,
    cronTasks: includedCronTasks,
  });

  const manifest: TemplateManifest = {
    schemaVersion: '1.0',
    templateId: input.templateId,
    version: input.version,
    title: input.title,
    summary: input.summary?.trim() || null,
    source: {
      type: input.sourceType,
      author: input.sourceAuthor?.trim() || null,
      channel: null,
    },
    contents: {
      group: true,
      agents: snapshot.agents.length,
      categories: snapshot.categories.length,
      skills: includedSkills.length,
      cronTasks: snapshot.cronTasks.length,
    },
  };

  return {
    manifest,
    snapshot,
    capabilityDescriptors: buildCapabilityDescriptors(snapshot.agents),
    skills: includedSkills,
    skillUsages: includedSkillUsages,
    degradedSkills: includedDegradedSkills,
  };
}

function buildCapabilityDescriptors(
  agents: Array<{
    id: string;
    acpTool: string | null;
    speechConfig: Record<string, unknown> | null;
    capabilities: Array<{ capabilityType: 'image' | 'audio'; enabled: boolean }>;
  }>,
): CapabilityDescriptor[] {
  const descriptors: CapabilityDescriptor[] = [];

  for (const agent of agents) {
    descriptors.push({
      agentRef: agent.id,
      capabilityType: 'text',
      required: true,
      tool: agent.acpTool === 'claude' || agent.acpTool === 'codex'
        ? agent.acpTool
        : null,
      providerProtocol: agent.acpTool === 'claude'
        ? 'anthropic'
        : agent.acpTool === 'codex'
        ? 'openai'
        : null,
      modelType: 'text',
    });

    const hasExplicitAudioCapability = agent.capabilities.some(
      (c) => c.enabled && c.capabilityType === 'audio',
    );

    for (const capability of agent.capabilities) {
      if (!capability.enabled) continue;
      descriptors.push({
        agentRef: agent.id,
        capabilityType: capability.capabilityType,
        required: capability.capabilityType === 'image',
        providerProtocol: 'openai',
        modelType: capability.capabilityType,
      });
    }

    // 仅在 capabilities 中没有已启用的 audio 时才从 speechConfig 补充，避免重复描述符
    if (!hasExplicitAudioCapability && hasPortableAudioCapability(agent.speechConfig)) {
      descriptors.push({
        agentRef: agent.id,
        capabilityType: 'audio',
        required: false,
        providerProtocol: 'openai',
        modelType: 'audio',
      });
    }
  }

  return descriptors;
}

function hasPortableAudioCapability(speechConfig: Record<string, unknown> | null): boolean {
  if (!speechConfig) return false;

  const normalizedConfig = normalizeAgentSpeechConfig(speechConfig as Parameters<typeof normalizeAgentSpeechConfig>[0]);
  if (!normalizedConfig.behavior.enabled || normalizedConfig.behavior.outputMode === 'off') {
    return false;
  }

  // `browser-local` 只代表本地浏览器播报偏好，不是模板包里需要迁移或映射的语音模型依赖。
  if (normalizedConfig.profile.provider === 'browser-local') {
    return false;
  }

  const defaults = createDefaultAgentSpeechConfig();
  return normalizedConfig.profile.provider !== defaults.profile.provider
    || normalizedConfig.profile.model !== defaults.profile.model
    || normalizedConfig.profile.voice !== defaults.profile.voice
    || normalizedConfig.profile.fallbackProvider !== defaults.profile.fallbackProvider
    || normalizedConfig.profile.vendorOptions !== defaults.profile.vendorOptions;
}
