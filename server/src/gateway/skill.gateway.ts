import { FastifyInstance } from 'fastify';
import * as fs from 'fs';
import {
  skillInstallService,
  InstalledSkill,
  SkillSearchResult,
  SkillInstallResult,
  DiscoveredSkill,
  DiscoverResult,
  ExternalSkill,
  ExternalImportResult,
} from '../modules/skill/skill-install.service.js';
import { agentService } from '../core/agent/agent.service.js';
import { clearExecutorCache } from '../core/agent/agent-handler/index.js';
import * as path from 'path';
import * as os from 'os';

interface ResolvedSharedSkill {
  slug: string;
  sourceDir: string;
  version: string | null;
}

// 获取共享技能目录路径
function getSharedSkillsDir(): string {
  return path.join(os.homedir(), '.teamagentx', 'skills');
}

function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function readSkillDisplayName(skillDir: string): string | null {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const nameLine = match[1]
      .split('\n')
      .find((line) => line.trim().startsWith('name:'));
    if (!nameLine) return null;

    return nameLine
      .replace(/^name:\s*/, '')
      .replace(/^["']|["']$/g, '')
      .trim();
  } catch {
    return null;
  }
}

function resolveSharedSkill(skillName: string): ResolvedSharedSkill | null {
  const sharedSkillsDir = getSharedSkillsDir();
  const input = skillName.trim();
  if (!input || !fs.existsSync(sharedSkillsDir)) {
    return null;
  }

  const directSourceDir = path.join(sharedSkillsDir, input);
  if (fs.existsSync(path.join(directSourceDir, 'SKILL.md'))) {
    return {
      slug: input,
      sourceDir: directSourceDir,
      version: null,
    };
  }

  const normalizedInput = normalizeSkillName(input);
  const installedSkills = skillInstallService.listInstalled(sharedSkillsDir);
  for (const skill of installedSkills) {
    const sourceDir = path.join(sharedSkillsDir, skill.slug);
    const displayName = readSkillDisplayName(sourceDir);
    const matchesSlug =
      normalizeSkillName(skill.slug) === normalizedInput ||
      normalizeSkillName(skill.slug).includes(normalizedInput);
    const matchesDisplayName =
      !!displayName && normalizeSkillName(displayName) === normalizedInput;

    if (matchesSlug || matchesDisplayName) {
      return {
        slug: skill.slug,
        sourceDir,
        version: skill.version,
      };
    }
  }

  return null;
}

function linkSharedSkillToAgent(
  sharedSkill: ResolvedSharedSkill,
  targetSkillsDir: string,
): string {
  const targetPath = path.join(targetSkillsDir, sharedSkill.slug);
  fs.mkdirSync(targetSkillsDir, { recursive: true });

  if (fs.existsSync(targetPath)) {
    const stats = fs.lstatSync(targetPath);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(targetPath);
    } else {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  }

  fs.symlinkSync(sharedSkill.sourceDir, targetPath, 'dir');
  return targetPath;
}

// 获取 Agent 的 Skills 目录（每个 agent 有独立目录）
async function getAgentSkillsDir(agentId: string): Promise<string> {
  const agent = await agentService.findById(agentId);
  if (!agent) {
    throw new Error('助手不存在');
  }

  const skillsDir = skillInstallService.getAgentSkillsDir(agent);
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }
  return skillsDir;
}

// 会话存储（用于保存 discover 结果）
const discoverSessions = new Map<string, DiscoverResult>();

// 清理过期会话（超过 10 分钟）
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, result] of discoverSessions.entries()) {
    // 会话超过 10 分钟未使用，清理
    if (now - (result.skills[0]?.metadata?.discoveredAt || 0) > 600000) {
      // 清理临时目录
      if (result.version !== 'local' && result.tempDir) {
        try {
          fs.rmSync(result.tempDir, { recursive: true, force: true });
        } catch {
          // 忽略
        }
      }
      discoverSessions.delete(sessionId);
    }
  }
}

export async function skillGateway(app: FastifyInstance) {
  // ========== Skills 搜索 ==========

  app.get<{
    Querystring: { q?: string; limit?: number };
  }>('/skills/search', {
    schema: {
      description: '搜索 ClawdHub Registry 上的 Skills',
      tags: ['Skills'],
      querystring: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '搜索关键词' },
          limit: { type: 'number', default: 10, description: '返回数量限制' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  displayName: { type: 'string' },
                  version: { type: 'string' },
                  score: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { q = '', limit = 10 } = request.query;

    if (!q.trim()) {
      return reply.send({ success: true, data: [] });
    }

    try {
      const results = await skillInstallService.search(q.trim(), limit);
      return reply.send({ success: true, data: results });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== Skills 发现 ==========

  app.post<{
    Params: { agentId: string };
    Body: { slug: string };
  }>('/agents/:agentId/skills/discover', {
    schema: {
      description: '发现仓库中的所有 Skills（clone 并扫描 SKILL.md）',
      tags: ['Skills'],
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
        },
        required: ['agentId'],
      },
      body: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'GitHub 仓库地址（owner/repo 或完整 URL）' },
        },
        required: ['slug'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                sessionId: { type: 'string' },
                repoSlug: { type: 'string' },
                version: { type: 'string' },
                skills: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      relativePath: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { slug } = request.body;

    if (!slug?.trim()) {
      return reply.code(400).send({ success: false, error: 'slug 是必填参数' });
    }

    try {
      // 检查 agent 是否存在（但不需要工作目录）
      await getAgentSkillsDir(agentId);

      // 发现 skills
      const discoverResult = await skillInstallService.discover(slug.trim());

      // 生成会话 ID
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 添加发现时间用于清理
      if (discoverResult.skills.length > 0) {
        discoverResult.skills[0].metadata = {
          ...discoverResult.skills[0].metadata,
          discoveredAt: Date.now(),
        };
      }

      // 存储会话
      discoverSessions.set(sessionId, discoverResult);

      // 清理过期会话
      cleanupExpiredSessions();

      return reply.send({
        success: true,
        data: {
          sessionId,
          repoSlug: discoverResult.repoSlug,
          version: discoverResult.version,
          skills: discoverResult.skills,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message === '助手不存在') {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skillGateway] Discover failed: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== Skills 安装选中 ==========

  app.post<{
    Params: { agentId: string };
    Body: { sessionId: string; selectedIndices: number[] };
  }>('/agents/:agentId/skills/install-selected', {
    schema: {
      description: '安装选中的 Skills',
      tags: ['Skills'],
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
        },
        required: ['agentId'],
      },
      body: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'discover 返回的会话 ID' },
          selectedIndices: {
            type: 'array',
            items: { type: 'number' },
            description: '选中的 skill 索引列表',
          },
        },
        required: ['sessionId', 'selectedIndices'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  version: { type: 'string' },
                  installedAt: { type: 'number' },
                  path: { type: 'string' },
                },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { sessionId, selectedIndices } = request.body;

    if (!sessionId || !selectedIndices || selectedIndices.length === 0) {
      return reply.code(400).send({ success: false, error: 'sessionId 和 selectedIndices 是必填参数' });
    }

    try {
      const workDir = await getAgentSkillsDir(agentId);

      // 获取会话
      const discoverResult = discoverSessions.get(sessionId);
      if (!discoverResult) {
        return reply.code(404).send({ success: false, error: '会话已过期或不存在' });
      }

      // 根据 index 获取选中的 skills
      const selectedSkills = selectedIndices
        .filter(i => i >= 0 && i < discoverResult.skills.length)
        .map(i => discoverResult.skills[i]);

      if (selectedSkills.length === 0) {
        return reply.code(400).send({ success: false, error: '未选择有效的技能' });
      }

      // 安装选中的 skills
      const results = await skillInstallService.installSelected(
        discoverResult,
        selectedSkills,
        workDir
      );

      // 清除该 agent 的 executor 缓存，使 skills 立即生效
      const agent = await agentService.findById(agentId);
      if (agent) {
        clearExecutorCache(agent.name);
      }

      // 清理会话
      discoverSessions.delete(sessionId);

      return reply.send({ success: true, data: results });
    } catch (error) {
      if (error instanceof Error && error.message === '助手不存在') {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skillGateway] Install failed: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== Skills 安装（旧版，直接安装） ==========

  app.post<{
    Params: { agentId: string };
    Body: { slug: string };
  }>('/agents/:agentId/skills/install', {
    schema: {
      description: '从 GitHub 仓库安装 Skill（如果仓库有多个 skill 会返回错误提示选择）',
      tags: ['Skills'],
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
        },
        required: ['agentId'],
      },
      body: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Skill slug 名称或完整 GitHub URL' },
        },
        required: ['slug'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                version: { type: 'string' },
                installedAt: { type: 'number' },
                path: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;
    const { slug } = request.body;

    if (!slug?.trim()) {
      return reply.code(400).send({ success: false, error: 'slug 是必填参数' });
    }

    try {
      const input = slug.trim();
      const workDir = await getAgentSkillsDir(agentId);
      const sharedSkill = resolveSharedSkill(input);

      const agent = await agentService.findById(agentId);

      if (sharedSkill) {
        const symlinkPath = linkSharedSkillToAgent(sharedSkill, workDir);
        if (agent) {
          clearExecutorCache(agent.name);
        }

        return reply.send({
          success: true,
          data: {
            slug: sharedSkill.slug,
            version: sharedSkill.version || 'shared',
            installedAt: Date.now(),
            path: symlinkPath,
          },
        });
      }

      const result = await skillInstallService.install(input, workDir);

      // 清除该 agent 的 executor 缓存，使 skills 立即生效
      if (agent) {
        clearExecutorCache(agent.name);
      }

      return reply.send({ success: true, data: result });
    } catch (error) {
      if (error instanceof Error && error.message === '助手不存在') {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skillGateway] Install failed: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== Agent Skills 列表 ==========

  app.get<{
    Params: { agentId: string };
  }>('/agents/:agentId/skills', {
    schema: {
      description: '获取 Agent 已安装的 Skills 列表',
      tags: ['Skills'],
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
        },
        required: ['agentId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  slug: { type: 'string' },
                  version: { type: 'string', nullable: true },
                  installedAt: { type: 'number', nullable: true },
                },
              },
            },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId } = request.params;

    try {
      const workDir = await getAgentSkillsDir(agentId);
      const skills = skillInstallService.listInstalled(workDir);
      return reply.send({ success: true, data: skills });
    } catch (error) {
      if (error instanceof Error && error.message === '助手不存在') {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== Skills 删除 ==========

  app.delete<{
    Params: { agentId: string; slug: string };
  }>('/agents/:agentId/skills/:slug', {
    schema: {
      description: '删除 Agent 已安装的 Skill',
      tags: ['Skills'],
      params: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['agentId', 'slug'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { agentId, slug } = request.params;

    try {
      const workDir = await getAgentSkillsDir(agentId);
      const removed = skillInstallService.uninstall(slug, workDir);

      if (!removed) {
        return reply.code(404).send({ success: false, error: '技能未安装' });
      }

      // 清除该 agent 的 executor 缓存，使删除立即生效
      const agent = await agentService.findById(agentId);
      if (agent) {
        clearExecutorCache(agent.name);
      }

      return reply.send({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === '助手不存在') {
        return reply.code(404).send({ success: false, error: '助手不存在' });
      }
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== 共享技能接口 ==========

  // 列出共享技能
  app.get('/skills/shared', {
    schema: {
      description: '列出共享目录中的所有技能',
      tags: ['Skills'],
    },
  }, async (request, reply) => {
    try {
      const sharedSkillsDir = getSharedSkillsDir();

      if (!fs.existsSync(sharedSkillsDir)) {
        return reply.send({ success: true, data: { skills: [] } });
      }

      const entries = fs.readdirSync(sharedSkillsDir, { withFileTypes: true });
      const skills: Array<{
        name: string;
        slug: string;
        description: string;
        source: string;
        installedAgents: string[];
      }> = [];
      const agents = await agentService.findActive();

      for (const entry of entries) {
        // 跳过非目录和非软连接
        const isDir = entry.isDirectory();
        const isSymlink = entry.isSymbolicLink();
        if (!isDir && !isSymlink) continue;
        if (entry.name.startsWith('.')) continue;

        const skillDir = path.join(sharedSkillsDir, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const originPath = path.join(skillDir, '.skills', 'origin.json');

        if (!fs.existsSync(skillMdPath)) continue;

        let name = entry.name;
        let description = '';
        let source = 'unknown';

        // 解析 SKILL.md
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const fmContent = frontmatterMatch[1];
            const lines = fmContent.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const match = lines[i].match(/^(\w+):\s*(.*)$/);
              if (match) {
                const [, key, rawValue] = match;
                if (key === 'name') {
                  name = rawValue.replace(/^["']|["']$/g, '').trim();
                } else if (key === 'description') {
                  const trimmed = rawValue.trim();
                  if (trimmed === '|' || trimmed === '>' || trimmed === '|-' || trimmed === '>-') {
                    // YAML multi-line scalar: collect indented lines below
                    const parts: string[] = [];
                    for (let j = i + 1; j < lines.length; j++) {
                      if (lines[j].match(/^\s/) && lines[j].trim() !== '') {
                        parts.push(lines[j].trim());
                      } else {
                        break;
                      }
                    }
                    description = parts.join(' ').trim();
                  } else if (trimmed === '|' || trimmed === '') {
                    description = '';
                  } else {
                    description = trimmed.replace(/^["']|["']$/g, '');
                  }
                }
              }
            }
          }
        } catch {
          // 忽略
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
          const installedPath = path.join(
            skillInstallService.getAgentSkillsDir(agent),
            entry.name,
          );
          if (fs.existsSync(installedPath)) {
            installedAgents.push(agent.name);
          }
        }

        skills.push({ name, slug: entry.name, description, source, installedAgents });
      }

      return reply.send({ success: true, data: { skills } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // 创建技能到共享目录
  app.post<{
    Body: { skillName: string; description: string; content: string };
  }>('/skills/create', {
    schema: {
      description: '创建新技能到共享目录',
      tags: ['Skills'],
      body: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: '技能名称' },
          description: { type: 'string', description: '技能描述' },
          content: { type: 'string', description: 'SKILL.md 内容' },
        },
        required: ['skillName', 'description', 'content'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                skillPath: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { skillName, description, content } = request.body;

    try {
      const normalizedSlug = skillName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      if (!normalizedSlug) {
        return reply.code(400).send({ success: false, error: '技能名称无效' });
      }

      const sharedSkillsDir = getSharedSkillsDir();
      const skillDir = path.join(sharedSkillsDir, normalizedSlug);

      if (fs.existsSync(skillDir)) {
        return reply.code(400).send({ success: false, error: '技能已存在' });
      }

      fs.mkdirSync(skillDir, { recursive: true });

      const skillMdContent = `---
name: ${skillName}
description: ${description}
---

${content}`;

      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillMdContent, 'utf-8');

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

      fs.writeFileSync(path.join(originDir, 'origin.json'), JSON.stringify(originData, null, 2), 'utf-8');

      return reply.send({ success: true, data: { skillPath: skillDir } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // symlink 安装技能
  app.post<{
    Body: { skillName: string; targetAgentId: string };
  }>('/skills/symlink', {
    schema: {
      description: '将共享目录中的技能 symlink 安装到指定助手',
      tags: ['Skills'],
      body: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: '技能名称' },
          targetAgentId: { type: 'string', description: '目标助手 ID' },
        },
        required: ['skillName', 'targetAgentId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                symlinkPath: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { skillName, targetAgentId } = request.body;

    try {
      const sharedSkill = resolveSharedSkill(skillName);
      if (!sharedSkill) {
        return reply.code(404).send({ success: false, error: '技能不存在于共享目录' });
      }

      const targetAgent = await agentService.findById(targetAgentId);
      if (!targetAgent) {
        return reply.code(404).send({ success: false, error: '目标助手不存在' });
      }

      const targetSkillsDir = await getAgentSkillsDir(targetAgentId);
      const targetSymlink = linkSharedSkillToAgent(sharedSkill, targetSkillsDir);

      // 清除缓存
      clearExecutorCache(targetAgent.name);

      return reply.send({ success: true, data: { symlinkPath: targetSymlink } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // 删除 symlink
  app.delete<{
    Body: { skillName: string; targetAgentId: string };
  }>('/skills/symlink', {
    schema: {
      description: '删除助手中的技能 symlink',
      tags: ['Skills'],
      body: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: '技能名称' },
          targetAgentId: { type: 'string', description: '目标助手 ID' },
        },
        required: ['skillName', 'targetAgentId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { skillName, targetAgentId } = request.body;

    try {
      const targetAgent = await agentService.findById(targetAgentId);
      if (!targetAgent) {
        return reply.code(404).send({ success: false, error: '目标助手不存在' });
      }

      const targetSkillsDir = await getAgentSkillsDir(targetAgentId);
      const removed = skillInstallService.uninstall(skillName, targetSkillsDir);
      if (!removed) {
        return reply.code(404).send({ success: false, error: '技能未安装' });
      }

      clearExecutorCache(targetAgent.name);

      return reply.send({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // 获取技能详情（完整内容）
  app.get<{
    Params: { slug: string };
  }>('/skills/:slug', {
    schema: {
      description: '获取技能的完整内容',
      tags: ['Skills'],
      params: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: '技能 slug' },
        },
        required: ['slug'],
      },
    },
  }, async (request, reply) => {
    const { slug } = request.params;

    try {
      const sharedSkillsDir = getSharedSkillsDir();
      const skillDir = path.join(sharedSkillsDir, slug);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillDir)) {
        return reply.code(404).send({ success: false, error: '技能不存在' });
      }

      // 读取 SKILL.md
      let content = '';
      let name = slug;
      let description = '';
      let frontmatter: Record<string, string> = {};

      if (fs.existsSync(skillMdPath)) {
        content = fs.readFileSync(skillMdPath, 'utf-8');

        // 解析 frontmatter
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
          const lines = frontmatterMatch[1].split('\n');
          for (const line of lines) {
            const match = line.match(/^(\w+):\s*(.+)$/);
            if (match) {
              const [, key, value] = match;
              const cleanValue = value.replace(/^["']|["']$/g, '');
              frontmatter[key] = cleanValue;
              if (key === 'name') name = cleanValue;
              if (key === 'description') description = cleanValue;
            }
          }
        }
      }

      // 提取正文内容（去掉 frontmatter）
      const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

      // 读取 origin.json
      let source = 'unknown';
      const originPath = path.join(skillDir, '.skills', 'origin.json');
      if (fs.existsSync(originPath)) {
        try {
          const origin = JSON.parse(fs.readFileSync(originPath, 'utf-8'));
          source = origin.source || 'unknown';
        } catch {
          // 忽略
        }
      }

      // 列出技能目录下的所有文件
      const files: Array<{
        name: string;
        path: string;
        type: 'file' | 'directory';
        size?: number;
        content?: string;
      }> = [];

      const scanDir = (dir: string, basePath: string = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          // 跳过 .skills 目录（元数据）
          if (entry.name === '.skills') continue;

          const fullPath = path.join(dir, entry.name);
          const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;

          // 检查是否是目录或软连接目录
          const isDir = entry.isDirectory();
          const isSymlink = entry.isSymbolicLink();

          if (isDir || isSymlink) {
            // 对于软连接，需要检查其指向的目标是否是目录
            let targetIsDir = isDir;
            if (isSymlink) {
              try {
                const targetPath = fs.realpathSync(fullPath);
                targetIsDir = fs.statSync(targetPath).isDirectory();
              } catch {
                // 软连接目标不存在或无法访问，跳过
                continue;
              }
            }

            if (targetIsDir) {
              files.push({
                name: entry.name,
                path: relativePath,
                type: 'directory',
              });
              // 递归扫描子目录（软连接也递归）
              scanDir(fullPath, relativePath);
            } else {
              // 软连接指向文件，当作文件处理
              try {
                const stat = fs.statSync(fullPath);
                const fileEntry: (typeof files)[0] = {
                  name: entry.name,
                  path: relativePath,
                  type: 'file',
                  size: stat.size,
                };

                // 对于文本文件，读取内容
                const ext = path.extname(entry.name).toLowerCase();
                const textExtensions = [
                  '.md', '.txt', '.json', '.yaml', '.yml',
                  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
                  '.py', '.rb', '.go', '.rs', '.java', '.kt',
                  '.sh', '.bash', '.zsh', '.fish',
                  '.html', '.css', '.scss', '.less', '.sass',
                  '.xml', '.toml', '.ini', '.env',
                  '.mdx', '.rst', '.org',
                ];

                if (textExtensions.includes(ext) || entry.name.startsWith('.')) {
                  try {
                    if (stat.size < 100 * 1024) {
                      fileEntry.content = fs.readFileSync(fullPath, 'utf-8');
                    }
                  } catch {
                    // 忽略读取错误
                  }
                }

                files.push(fileEntry);
              } catch {
                // 忽略无法访问的软连接
              }
            }
          } else {
            const stat = fs.statSync(fullPath);
            const fileEntry: (typeof files)[0] = {
              name: entry.name,
              path: relativePath,
              type: 'file',
              size: stat.size,
            };

            // 对于文本文件，读取内容
            const ext = path.extname(entry.name).toLowerCase();
            const textExtensions = [
              '.md', '.txt', '.json', '.yaml', '.yml',
              '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
              '.py', '.rb', '.go', '.rs', '.java', '.kt',
              '.sh', '.bash', '.zsh', '.fish',
              '.html', '.css', '.scss', '.less', '.sass',
              '.xml', '.toml', '.ini', '.env',
              '.mdx', '.rst', '.org',
            ];

            if (textExtensions.includes(ext) || entry.name.startsWith('.')) {
              try {
                // 限制文件大小，避免读取过大的文件
                if (stat.size < 100 * 1024) { // 100KB
                  fileEntry.content = fs.readFileSync(fullPath, 'utf-8');
                }
              } catch {
                // 忽略读取错误
              }
            }

            files.push(fileEntry);
          }
        }
      };

      scanDir(skillDir);

      // 按路径排序
      files.sort((a, b) => a.path.localeCompare(b.path));

      return reply.send({
        success: true,
        data: {
          slug,
          name,
          description,
          source,
          frontmatter,
          content: bodyContent.trim(),
          rawContent: content,
          files,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // ========== 外部技能导入 ==========

  // 扫描外部 AI 工具目录中的技能
  app.get('/skills/external', {
    schema: {
      description: '扫描外部 AI 工具目录（~/.claude、~/.codex、~/.openclaw、~/.agent）中的技能',
      tags: ['Skills'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                skills: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      slug: { type: 'string' },
                      sourceTool: { type: 'string' },
                      sourcePath: { type: 'string' },
                      existsInShared: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        500: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const externalSkills = skillInstallService.discoverExternalSkills();
      return reply.send({ success: true, data: { skills: externalSkills } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skillGateway] External skills scan failed: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });

  // 导入外部技能到共享目录
  app.post<{
    Body: {
      sourcePath: string;
      method?: 'symlink' | 'copy';
    };
  }>('/skills/import-external', {
    schema: {
      description: '导入外部技能到共享目录，支持 symlink（自动同步）或 copy（独立管理）两种方式',
      tags: ['Skills'],
      body: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string', description: '外部技能的完整路径' },
          method: { type: 'string', enum: ['symlink', 'copy'], default: 'symlink', description: '导入方式' },
        },
        required: ['sourcePath'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                slug: { type: 'string' },
                method: { type: 'string' },
                targetPath: { type: 'string' },
                success: { type: 'boolean' },
                error: { type: 'string' },
              },
            },
          },
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
        500: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { sourcePath, method = 'symlink' } = request.body;

    if (!sourcePath?.trim()) {
      return reply.code(400).send({ success: false, error: 'sourcePath 是必填参数' });
    }

    // 处理 ~ 开头的路径
    let resolvedPath = sourcePath.trim();
    if (resolvedPath.startsWith('~')) {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
    }

    // 安全检查：确保路径在允许的外部目录范围内
    const homeDir = os.homedir();
    const allowedDirs = ['.claude/skills', '.codex/skills', '.openclaw/skills', '.agents/skills', '.agent/skills'];
    const isAllowed = allowedDirs.some(dir => {
      const fullPath = path.join(homeDir, dir);
      return resolvedPath.startsWith(fullPath);
    });

    if (!isAllowed) {
      return reply.code(400).send({
        success: false,
        error: 'sourcePath 必须在允许的外部目录范围内（~/.claude/skills、~/.codex/skills、~/.openclaw/skills、~/.agents/skills、~/.agent/skills）',
      });
    }

    try {
      const result = skillInstallService.importExternalSkill(resolvedPath, method);
      if (!result.success) {
        return reply.code(400).send({ success: false, error: result.error || '导入失败' });
      }
      return reply.send({ success: true, data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[skillGateway] Import external skill failed: ${message}`);
      return reply.code(500).send({ success: false, error: message });
    }
  });
}
