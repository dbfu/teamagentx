type SnapshotCapabilityType = 'text' | 'image' | 'audio';

interface SnapshotRoomInput {
  id: string;
  name: string;
  description: string | null;
  rules: string | null;
  workDir: string | null;
  defaultAgentId: string | null;
  agentTriggerMode: 'auto' | 'manual' | 'coordinator';
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
  claudeModel: string | null;
  llmProviderId: string | null;
  speechConfig: Record<string, unknown> | null;
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
  payload: string;
}

interface BuildTemplateSnapshotInput {
  room: SnapshotRoomInput;
  agents: SnapshotAgentInput[];
  categories: SnapshotCategoryInput[];
  cronTasks: SnapshotCronTaskInput[];
}

export function buildTemplateSnapshot(input: BuildTemplateSnapshotInput) {
  return {
    room: {
      ...input.room,
      workDir: null,
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
      claudeModel: agent.claudeModel,
      llmProviderId: null,
      speechConfig: agent.speechConfig,
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
      payload: task.payload,
    })),
  };
}
