// Agent 工具导出

// Skills 安装助手工具
export {
  SKILLS_HELPER_AGENT_ID,
  skillsHelperTools,
} from './skills-helper.tools.js';

// 技能管理助手工具（生成、查看、symlink 安装技能）
export {
  SKILL_MANAGER_AGENT_ID,
  skillManagerTools,
  getSharedSkillsDir,
} from './skill-manager.tools.js';

// 助手生成助手工具
export {
  AGENT_CREATOR_AGENT_ID,
  agentCreatorTools,
} from './agent-creator.tools.js';

// 定时任务助手工具
export {
  CRON_TASK_HELPER_AGENT_ID,
  cronTaskHelperTools,
} from './cron-task-helper.tools.js';

// 群聊管理助手工具
export {
  CHATROOM_HELPER_AGENT_ID,
  chatroomHelperTools,
} from './chatroom-helper.tools.js';

export {
  EXTERNAL_PLATFORM_HELPER_AGENT_ID,
  createExternalPlatformHelperTools,
} from './external-platform-helper.tools.js';

export { createChatHistorySearchTools } from './chat-history-search.tools.js';
export { getSystemAssistantTools } from './system-assistant.tools.js';
