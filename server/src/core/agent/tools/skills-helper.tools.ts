import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import { agentService } from '../../../core/agent/agent.service.js';
import { skillInstallService } from '../../../modules/skill/skill-install.service.js';
import { clearExecutorCacheEntries } from '../agent-handler/cache.js';

// Skills 安装助手的专用 ID
export const SKILLS_HELPER_AGENT_ID = '596667f7-f901-4613-92a7-cc71d859fa22';

// 列出可用 Agent 工具
export const listAgentsTool = tool(
  async () => {
    const agents = await agentService.findActive();
    const builtinAgents = agents.filter((a) => a.type === 'builtin');
    if (builtinAgents.length === 0) {
      return '没有可用的内置助手。';
    }
    return builtinAgents
      .map(
        (a) => `ID: ${a.id}\n名称: ${a.name}\n描述: ${a.description || '无'}`,
      )
      .join('\n\n');
  },
  {
    name: 'list_builtin_agents',
    description: '列出所有可用的内置助手，用于选择 Skills 安装目标。',
    schema: z.object({}),
  },
);

// 从来源安装 Skill 工具（备选方案：当用户只提供 GitHub 地址时可用）
export const installSkillFromSourceTool = tool(
  async ({
    source,
    skillName,
    targetAgentId,
  }: {
    source: string;
    skillName: string;
    targetAgentId: string;
  }) => {
    try {
      const targetAgent = await agentService.findById(targetAgentId);
      if (!targetAgent) {
        return `目标助手不存在: ${targetAgentId}`;
      }
      if (targetAgent.type !== 'builtin') {
        return `只能为内置类型助手安装 Skills，「${targetAgent.name}」是 ${targetAgent.type} 类型`;
      }

      const skillsDir = skillInstallService.getAgentSkillsDir(targetAgent);

      // 发现并安装
      const discoverResult = await skillInstallService.discover(source);

      if (discoverResult.skills.length === 0) {
        return `${source} 中没有找到 Skills`;
      }

      // 匹配 skill
      const skill = discoverResult.skills.find(
        (s, i) =>
          s.name.toLowerCase() === skillName.toLowerCase() ||
          s.name.toLowerCase().includes(skillName.toLowerCase()) ||
          String(i) === skillName,
      );

      if (!skill) {
        const list = discoverResult.skills
          .map((s, i) => `${i}: ${s.name}`)
          .join('\n');
        return `未找到「${skillName}」，可用 Skills:\n${list}`;
      }

      // 检查已安装
      const installed = skillInstallService.listInstalled(skillsDir);
      const slug = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (installed.find((s) => s.slug === slug)) {
        return `「${skill.name}」已安装，如需更新请先卸载`;
      }

      // 安装
      const [result] = await skillInstallService.installSelected(
        discoverResult,
        [skill],
        skillsDir,
      );
      clearExecutorCacheEntries(targetAgent.name);
      return `✅ 已安装「${skill.name}」到「${targetAgent.name}」(版本: ${result.version})`;
    } catch (error) {
      return `安装失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: 'install_skill_from_source',
    description:
      '备选工具：从 GitHub/本地来源安装 Skill。优先按用户提供的文档命令执行，仅当用户只给出地址时使用此工具。',
    schema: z.object({
      source: z.string().describe('来源：GitHub owner/repo 或本地路径'),
      skillName: z.string().describe('Skill 名称或索引'),
      targetAgentId: z.string().describe('目标助手 ID'),
    }),
  },
);

// Skills 安装助手的工具列表
export const skillsHelperTools = [listAgentsTool, installSkillFromSourceTool];
