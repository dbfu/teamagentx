export const GROUP_ASSISTANT_ID = '4f7c8a91-2d6b-4c8f-9a7e-5b1d2c3e4f60';
export const GROUP_COORDINATOR_ID = '6b375f6f-7fb7-4c7b-9f1b-70a88af1f1a0';

export const GROUP_ASSISTANT_WELCOME_MESSAGE = `你好，我是群助手，负责帮你管理 TeamAgentX 的系统能力。我可以帮你：

- 创建、配置和管理助手与模型
- 生成、安装和管理技能
- 创建定时任务，管理群聊与协作规则
- 接入 MCP、飞书、Telegram、钉钉等外部平台

告诉我你想完成什么，@我说出你的需求。例如: @群助手 帮我创建一个产品需求分析助手。`;

export const AGENT_CREATOR_ID = '29ffb519-82d2-4c32-8bc8-0b8d814a4eee';
export const SKILL_MANAGER_ID = '596667f7-f901-4613-92a7-cc71d859fa22';
export const CRON_TASK_HELPER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
export const CHATROOM_HELPER_ID = 'c3d4e5f6-7890-abcd-ef12-345678901234';
export const EXTERNAL_PLATFORM_HELPER_ID = '8f7d1f9a-4e08-4c2d-a489-67b02c9d4101';

export const LEGACY_SYSTEM_AGENT_IDS = [
  AGENT_CREATOR_ID,
  SKILL_MANAGER_ID,
  CRON_TASK_HELPER_ID,
  CHATROOM_HELPER_ID,
  EXTERNAL_PLATFORM_HELPER_ID,
];

export const VISIBLE_SYSTEM_AGENT_IDS = [GROUP_ASSISTANT_ID];
export const HIDDEN_SYSTEM_AGENT_IDS: string[] = [];
export const SYSTEM_AGENT_IDS = [GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID];

export function isLegacySystemAgentId(agentId: string | null | undefined): boolean {
  return !!agentId && LEGACY_SYSTEM_AGENT_IDS.includes(agentId);
}

export function isHiddenSystemAgentId(agentId: string | null | undefined): boolean {
  return !!agentId && HIDDEN_SYSTEM_AGENT_IDS.includes(agentId);
}

export function shouldEnableRoomHistoryByDefault(agentId: string | null | undefined): boolean {
  return agentId === GROUP_ASSISTANT_ID || agentId === GROUP_COORDINATOR_ID;
}
