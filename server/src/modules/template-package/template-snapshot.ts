import { parseRoomEnvVars } from '../../core/agent/room-env-vars.js';

type SnapshotCapabilityType = 'text' | 'image' | 'audio';

interface SnapshotRoomInput {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  dispatchRules?: string | null;
  envVars?: string | null;
  workDir: string | null;
  defaultAgentId: string | null;
  agentTriggerMode: 'auto' | 'manual' | 'coordinator';
  avatar?: string | null;
  avatarColor?: string | null;
}

interface SnapshotAgentCapabilityInput {
  capabilityType: Exclude<SnapshotCapabilityType, 'text'>;
  enabled: boolean;
  llmProviderId: string | null;
}

interface SnapshotAgentInput {
  id: string;
  name: string;
  prompt: string;
  type: string;
  acpTool: string | null;
  categoryId?: string | null;
  workDir: string | null;
  proxyConfig: string | null;
  codexModel: string | null;
  codexFastMode?: boolean;
  claudeModel: string | null;
  thinkingMode: string;
  llmProviderId: string | null;
  speechConfig: Record<string, unknown> | null;
  avatar?: string | null;
  avatarColor?: string | null;
  capabilities: SnapshotAgentCapabilityInput[];
}

interface SnapshotCategoryInput {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

interface SnapshotCronTaskInput {
  id: string;
  name: string;
  description: string | null;
  scheduleType: 'cron' | 'interval' | 'once';
  cronExpression: string | null;
  intervalMinutes: number | null;
  scheduledAt: string | null;
  payload: string;
  agentIds: string[];
  enabled: boolean;
  maxRetries: number;
}

interface SnapshotCommandInput {
  id?: string;
  name: string;
  content: string;
  sortOrder: number;
}

interface BuildTemplateSnapshotInput {
  room: SnapshotRoomInput;
  agents: SnapshotAgentInput[];
  categories: SnapshotCategoryInput[];
  cronTasks: SnapshotCronTaskInput[];
  commands?: SnapshotCommandInput[];
}

export function buildTemplateSnapshot(input: BuildTemplateSnapshotInput) {
  return {
    room: {
      ...input.room,
      envVars: serializeTemplateRoomEnvVars(input.room.envVars),
      workDir: null,
      avatar: input.room.avatar ?? null,
      avatarColor: input.room.avatarColor ?? null,
    },
    agents: input.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      prompt: agent.prompt,
      type: agent.type,
      acpTool: agent.acpTool,
      categoryId: agent.categoryId ?? null,
      workDir: null,
      proxyConfig: null,
      codexModel: agent.codexModel,
      codexFastMode: Boolean(agent.codexFastMode),
      claudeModel: agent.claudeModel,
      thinkingMode: agent.thinkingMode,
      llmProviderId: null,
      speechConfig: agent.speechConfig,
      avatar: agent.avatar ?? null,
      avatarColor: agent.avatarColor ?? null,
      capabilities: agent.capabilities.map((capability) => ({
        capabilityType: capability.capabilityType,
        enabled: capability.enabled,
        llmProviderId: null,
        modelType: capability.capabilityType,
      })),
    })),
    categories: input.categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
    })),
    cronTasks: input.cronTasks.map((task) => ({
      id: task.id,
      name: task.name,
      description: task.description,
      scheduleType: task.scheduleType,
      cronExpression: task.cronExpression,
      intervalMinutes: task.intervalMinutes,
      scheduledAt: task.scheduledAt,
      payload: task.payload,
      agentIds: task.agentIds,
      enabled: task.enabled,
      maxRetries: task.maxRetries,
    })),
    commands: (input.commands ?? []).map((command) => ({
      ...(command.id ? { id: command.id } : {}),
      name: command.name,
      content: command.content,
      sortOrder: command.sortOrder,
    })),
  };
}

export function serializeTemplateRoomEnvVars(raw: string | null | undefined): string | null {
  const envVars = parseRoomEnvVars(raw).map((envVar) => ({
    key: envVar.key,
    value: '',
    ...(envVar.description ? { description: envVar.description } : {}),
  }));

  return envVars.length > 0 ? JSON.stringify(envVars) : null;
}
