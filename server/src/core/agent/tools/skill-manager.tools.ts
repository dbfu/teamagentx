/**
 * 技能管理助手的工具定义
 * 用于生成技能、查看技能、symlink 安装技能
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { createSystemTool as tool } from './system-tool.js';
import { agentService } from '../../../core/agent/agent.service.js';
import { messageService } from '../../../modules/message/message.service.js';
import { skillInstallService } from '../../../modules/skill/skill-install.service.js';
import { getSharedSkillsDir } from '../../../modules/skill/preinstalled-skills.js';
import { clearExecutorCacheEntries } from '../agent-handler/cache.js';

// 技能管理助手的专用 ID
export const SKILL_MANAGER_AGENT_ID = '596667f7-f901-4613-92a7-cc71d859fa22';

export { getSharedSkillsDir };

// 获取对话历史工具
export const getChatHistoryTool = tool(
  async ({ chatRoomId, limit = 50 }: { chatRoomId?: string; limit?: number }) => {
    if (!chatRoomId) {
      return '错误：缺少 chatRoomId 参数';
    }

    try {
      const messages = await messageService.findByChatRoomId(chatRoomId, {
        take: limit,
        order: 'asc',
      });

      if (messages.length === 0) {
        return '该群聊暂无对话历史';
      }

      const formattedHistory = messages
        .map((msg) => {
          const senderName = msg.user?.username || msg.agent?.name || '未知';
          const role = msg.isHuman ? '用户' : '助手';
          const time = new Date(msg.time).toLocaleString('zh-CN');
          return `[${time}] ${role}(${senderName}): ${msg.content}`;
        })
        .join('\n\n');

      return `对话历史（共 ${messages.length} 条消息）：\n\n${formattedHistory}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `获取对话历史失败: ${message}`;
    }
  },
  {
    name: 'get_chat_history',
    description: '获取指定群聊的对话历史，用于分析并生成技能。返回格式化的对话记录。',
    schema: z.object({
      chatRoomId: z.string().describe('群聊 ID'),
      limit: z.number().optional().default(50).describe('消息数量限制，默认 50'),
    }),
  },
);

// 创建技能工具
export const createSkillTool = tool(
  async ({
    skillName,
    description,
    content,
  }: {
    skillName: string;
    description: string;
    content: string;
  }) => {
    try {
      // 规范化技能名称（小写、连字符）
      const normalizedSlug = skillName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      if (!normalizedSlug) {
        return '错误：技能名称无效，请使用字母和数字';
      }

      const sharedSkillsDir = getSharedSkillsDir();
      const skillDir = path.join(sharedSkillsDir, normalizedSlug);

      // 检查是否已存在
      if (fs.existsSync(skillDir)) {
        return `技能「${normalizedSlug}」已存在于共享目录，请使用不同的名称或先删除现有技能`;
      }

      // 创建技能目录
      fs.mkdirSync(skillDir, { recursive: true });

      // 写入 SKILL.md
      const skillMdContent = `---
name: ${skillName}
description: ${description}
---

${content}`;

      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        skillMdContent,
        'utf-8',
      );

      // 写入 origin.json 元数据
      const originDir = path.join(skillDir, '.skills');
      fs.mkdirSync(originDir, { recursive: true });

      const originData = {
        version: 1,
        source: 'user-created',
        slug: normalizedSlug,
        installedAt: Date.now(),
        skillName,
        skillDescription: description,
      };

      fs.writeFileSync(
        path.join(originDir, 'origin.json'),
        JSON.stringify(originData, null, 2),
        'utf-8',
      );

      return `✅ 技能「${skillName}」已创建到共享目录: ${skillDir}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `创建技能失败: ${message}`;
    }
  },
  {
    name: 'create_skill',
    description: '创建新技能到共享目录 ~/.teamagentx/skills/。技能创建后可通过 symlink_skill 安装到指定助手。',
    schema: z.object({
      skillName: z.string().describe('技能名称（使用小写字母和连字符，如 my-skill）'),
      description: z.string().describe('技能描述（简要说明技能用途）'),
      content: z.string().describe('SKILL.md 的完整内容（不含 frontmatter，系统会自动添加）'),
    }),
  },
);

// symlink 安装技能工具
export const symlinkSkillTool = tool(
  async ({
    skillName,
    targetAgentId,
  }: {
    skillName: string;
    targetAgentId: string;
  }) => {
    try {
      const sharedSkillsDir = getSharedSkillsDir();
      let skillSlug = skillName;
      let sourceSkillDir = path.join(sharedSkillsDir, skillSlug);

      // 检查技能是否存在于共享目录
      if (!fs.existsSync(sourceSkillDir)) {
        // 尝试从已安装的技能中查找
        const installedSkills = skillInstallService.listInstalled(sharedSkillsDir);
        const found = installedSkills.find(
          (s) => s.slug === skillName || s.slug?.includes(skillName),
        );
        if (!found) {
          return `错误：技能「${skillName}」不存在于共享目录，请先创建或安装该技能`;
        }
        skillSlug = found.slug;
        sourceSkillDir = path.join(sharedSkillsDir, skillSlug);
      }

      // 获取目标助手信息
      const targetAgent = await agentService.findById(targetAgentId);
      if (!targetAgent) {
        return `错误：目标助手不存在: ${targetAgentId}`;
      }

      const targetSkillsDir = skillInstallService.getAgentSkillsDir(targetAgent);
      const targetSymlink = path.join(targetSkillsDir, skillSlug);

      // 确保目标目录存在
      fs.mkdirSync(targetSkillsDir, { recursive: true });

      // 如果已存在同名文件/目录，先删除
      if (fs.existsSync(targetSymlink)) {
        const stats = fs.lstatSync(targetSymlink);
        if (stats.isSymbolicLink()) {
          fs.unlinkSync(targetSymlink);
        } else {
          fs.rmSync(targetSymlink, { recursive: true, force: true });
        }
      }

      // 创建 symlink
      fs.symlinkSync(sourceSkillDir, targetSymlink, 'dir');
      clearExecutorCacheEntries(targetAgent.name);

      return `✅ 技能「${skillSlug}」已安装到「${targetAgent.name}」\n路径: ${targetSymlink}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `symlink 安装失败: ${message}`;
    }
  },
  {
    name: 'symlink_skill',
    description: '将共享目录中的技能通过 symlink 安装到指定助手。symlink 方式安装的技能更新后会自动同步。',
    schema: z.object({
      skillName: z.string().describe('技能名称（目录名）'),
      targetAgentId: z.string().describe('目标助手 ID'),
    }),
  },
);

// 列出共享技能工具
export const listSharedSkillsTool = tool(
  async () => {
    try {
      const sharedSkillsDir = getSharedSkillsDir();

      if (!fs.existsSync(sharedSkillsDir)) {
        return '共享技能目录为空，暂无技能';
      }

      const entries = fs.readdirSync(sharedSkillsDir, { withFileTypes: true });
      const skills: Array<{
        slug: string;
        name: string;
        description: string;
        source: string;
        installedAgents: string[];
      }> = [];
      const agents = await agentService.findActive();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const skillDir = path.join(sharedSkillsDir, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const originPath = path.join(skillDir, '.skills', 'origin.json');

        if (!fs.existsSync(skillMdPath)) continue;

        // 解析 SKILL.md 获取名称和描述
        let name = entry.name;
        let description = '';
        let source = 'unknown';

        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const lines = frontmatterMatch[1].split('\n');
            for (const line of lines) {
              const match = line.match(/^(\w+):\s*(.+)$/);
              if (match) {
                const [, key, value] = match;
                if (key === 'name') name = value.replace(/^["']|["']$/g, '');
                if (key === 'description') description = value.replace(/^["']|["']$/g, '');
              }
            }
          }
        } catch {
          // 忽略解析错误
        }

        // 读取 origin.json
        if (fs.existsSync(originPath)) {
          try {
            const origin = JSON.parse(fs.readFileSync(originPath, 'utf-8'));
            source = origin.source || 'unknown';
          } catch {
            // 忽略
          }
        }

        // 查找已安装到哪些助手
        const installedAgents: string[] = [];
        for (const agent of agents) {
          const agentSkillPath = path.join(
            skillInstallService.getAgentSkillsDir(agent),
            entry.name,
          );
          if (fs.existsSync(agentSkillPath)) {
            installedAgents.push(agent.name);
          }
        }

        skills.push({
          slug: entry.name,
          name,
          description,
          source,
          installedAgents,
        });
      }

      if (skills.length === 0) {
        return '共享技能目录为空，暂无技能';
      }

      const formattedList = skills
        .map(
          (s) =>
            `**${s.name}**\n目录名: ${s.slug}\n描述: ${s.description || '无'}\n来源: ${s.source}\n已安装到: ${s.installedAgents.length > 0 ? s.installedAgents.join(', ') : '无'}`,
        )
        .join('\n\n');

      return `共享技能列表（共 ${skills.length} 个）：\n\n${formattedList}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `获取共享技能列表失败: ${message}`;
    }
  },
  {
    name: 'list_shared_skills',
    description: '列出共享目录 ~/.teamagentx/skills/ 中的所有技能，包括名称、描述、来源和已安装到哪些助手。',
    schema: z.object({}),
  },
);

// 列出助手技能工具
export const listAgentSkillsTool = tool(
  async ({ agentId }: { agentId?: string }) => {
    try {
      // 如果没有提供 agentId，使用技能管理助手自身的 ID
      const targetAgentId = agentId || SKILL_MANAGER_AGENT_ID;

      const targetAgent = await agentService.findById(targetAgentId);
      if (!targetAgent) {
        return `错误：助手不存在: ${targetAgentId}`;
      }

      const skillsDir = skillInstallService.getAgentSkillsDir(targetAgent);

      if (!fs.existsSync(skillsDir)) {
        return `「${targetAgent.name}」暂未安装任何技能`;
      }

      const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
      const skills: Array<{ name: string; description: string; isSymlink: boolean }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (entry.name.startsWith('.')) continue;

        const skillPath = path.join(skillsDir, entry.name);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        // 检查是否是 symlink
        const isSymlink = entry.isSymbolicLink() || fs.lstatSync(skillPath).isSymbolicLink();

        if (!fs.existsSync(skillMdPath)) continue;

        // 解析 SKILL.md
        let name = entry.name;
        let description = '';

        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const lines = frontmatterMatch[1].split('\n');
            for (const line of lines) {
              const match = line.match(/^(\w+):\s*(.+)$/);
              if (match) {
                const [, key, value] = match;
                if (key === 'name') name = value.replace(/^["']|["']$/g, '');
                if (key === 'description') description = value.replace(/^["']|["']$/g, '');
              }
            }
          }
        } catch {
          // 忽略解析错误
        }

        skills.push({ name, description, isSymlink });
      }

      if (skills.length === 0) {
        return `「${targetAgent.name}」暂未安装任何技能`;
      }

      const formattedList = skills
        .map(
          (s) =>
            `**${s.name}**${s.isSymlink ? ' (symlink)' : ''}\n${s.description || '无描述'}`,
        )
        .join('\n\n');

      return `「${targetAgent.name}」已安装的技能（共 ${skills.length} 个）：\n\n${formattedList}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `获取助手技能列表失败: ${message}`;
    }
  },
  {
    name: 'list_agent_skills',
    description: '列出指定助手已安装的技能。如果不提供 agentId，则列出技能管理助手自身的技能。',
    schema: z.object({
      agentId: z.string().optional().describe('目标助手 ID，不提供则查看自身'),
    }),
  },
);

// 技能管理助手的工具列表
export const skillManagerTools = [
  getChatHistoryTool,
  createSkillTool,
  symlinkSkillTool,
  listSharedSkillsTool,
  listAgentSkillsTool,
];
