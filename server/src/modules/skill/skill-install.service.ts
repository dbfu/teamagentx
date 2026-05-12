import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import type { Agent } from '@prisma/client';

// 已安装 Skill 信息
export interface InstalledSkill {
  slug: string;
  version: string | null;
  installedAt?: number;
  source?: string;
  ref?: string;
}

// 安装结果
export interface SkillInstallResult {
  slug: string;
  version: string;
  installedAt: number;
  path: string;
}

// Skill 搜索结果
export interface SkillSearchResult {
  slug: string;
  displayName?: string;
  version?: string;
  score: number;
}

// 预设的 Skills 仓库列表（用于搜索）
const KNOWN_SKILL_REPOS: Array<{
  repo: string;
  description: string;
  keywords: string[];
  skills: string[];
}> = [
  {
    repo: 'peterskoett/self-improving-agent',
    description: '自我改进和学习能力，自动记录错误和改进',
    keywords: ['self-improvement', 'learning', 'error', 'correction', '改进', '学习', '错误', '自我'],
    skills: ['self-improvement'],
  },
  {
    repo: 'anthropics/anthropic-cookbook',
    description: 'Claude 使用技巧和示例代码',
    keywords: ['claude', 'anthropic', 'cookbook', 'tips', 'examples', '技巧', '示例'],
    skills: ['claude-tips', 'prompt-engineering'],
  },
  {
    repo: 'affaan-m/everything-claude-code',
    description: 'Claude Code 的全面指南，包含大量 skills',
    keywords: ['claude-code', 'agent', 'eval', 'engineering', 'debugging', 'payment', 'sort', 'cli'],
    skills: ['agent-eval', 'agentic-engineering', 'agent-introspection-debugging', 'agent-payment-x402', 'agent-sort', 'bun-runtime', 'mcp-server-patterns', 'nextjs-turbopack', 'investor-outreach', 'market-research'],
  },
];

// 发现的 Skill（用于用户选择）
export interface DiscoveredSkill {
  name: string;
  description: string;
  relativePath: string; // 相对于仓库根目录
  metadata?: Record<string, any>;
}

// 发现结果
export interface DiscoverResult {
  repoSlug: string;
  version: string;
  skills: DiscoveredSkill[];
  tempDir: string; // 临时目录路径，用于后续安装
}

// 解析后的 Skill 来源
interface ParsedSource {
  type: 'github' | 'gitlab' | 'local' | 'git';
  url: string;
  owner?: string;
  repo?: string;
  ref?: string;
  subpath?: string;
  localPath?: string;
}

// 要跳过的目录
const SKIP_DIRS = [
  '.git', '.github', 'node_modules', '.npm', '.yarn', 'dist', 'build',
  '.next', '.nuxt', 'out', 'coverage', '.coverage', '__pycache__',
  '.pytest_cache', '.mypy_cache', 'venv', '.venv', 'env', '.env',
  '.idea', '.vscode', '.vs', 'vendor', 'target', 'pkg', 'docs',
];

// 外部 AI 工具技能目录定义
export const EXTERNAL_SKILL_DIRS = [
  { path: '.claude/skills', name: 'Claude Code', icon: 'claude' },
  { path: '.codex/skills', name: 'Codex', icon: 'codex' },
  { path: '.openclaw/skills', name: 'OpenClaw', icon: 'openclaw' },
  { path: '.agents/skills', name: 'Agents', icon: 'agents' },
  { path: '.agent/skills', name: 'Agent', icon: 'agent' },
];

// 外部技能发现结果
export interface ExternalSkill {
  name: string;
  description: string;
  slug: string;
  sourceTool: string;    // 工具名称：claude | codex | openclaw | agent
  sourcePath: string;    // 完整路径
  existsInShared: boolean; // 是否已存在于共享目录
}

// 外部技能导入结果
export interface ExternalImportResult {
  slug: string;
  method: 'symlink' | 'copy';
  targetPath: string;
  success: boolean;
  error?: string;
}

// 优先搜索目录（与 skills CLI 保持一致）
const PRIORITY_SEARCH_DIRS = [
  '', // 根目录
  'skills',
  'skills/.curated',
  'skills/.experimental',
  'skills/.system',
  '.agents/skills',
  '.claude/skills',
  '.cline/skills',
  '.codebuddy/skills',
  '.codex/skills',
  '.commandcode/skills',
  '.continue/skills',
  '.cursor/skills',
  '.goose/skills',
  '.iflow/skills',
  '.junie/skills',
  '.kilocode/skills',
  '.kiro/skills',
  '.mux/skills',
  '.neovate/skills',
  '.opencode/skills',
  '.openhands/skills',
  '.pi/skills',
  '.qoder/skills',
  '.roo/skills',
  '.trae/skills',
  '.windsurf/skills',
  '.zencoder/skills',
];

/**
 * 解析 Skill 输入为实际来源
 * 支持：owner/repo, GitHub URL, GitLab URL, 本地路径, 任意 git URL
 */
function parseSource(input: string): ParsedSource {
  const trimmed = input.trim();

  // 本地路径
  if (isLocalPath(trimmed)) {
    const resolvedPath = path.resolve(trimmed);
    return {
      type: 'local',
      url: resolvedPath,
      localPath: resolvedPath,
    };
  }

  // GitHub shorthand: owner/repo 或 owner/repo/subpath
  const shorthandMatch = trimmed.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthandMatch && !trimmed.includes(':') && !trimmed.startsWith('.')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      owner,
      repo,
      subpath: subpath || undefined,
    };
  }

  // GitHub URL with tree path: github.com/owner/repo/tree/ref/subpath
  const githubTreeWithPathMatch = trimmed.match(
    /github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/,
  );
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      owner,
      repo,
      ref,
      subpath,
    };
  }

  // GitHub URL with tree only: github.com/owner/repo/tree/ref
  const githubTreeMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      owner,
      repo,
      ref,
    };
  }

  // GitHub repo URL: github.com/owner/repo
  const githubRepoMatch = trimmed.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`,
      owner,
      repo,
    };
  }

  // GitLab URL
  const gitlabMatch = trimmed.match(/gitlab\.com\/(.+)/);
  if (gitlabMatch) {
    const repoPath = gitlabMatch[1].replace(/\.git$/, '');
    return {
      type: 'gitlab',
      url: `https://gitlab.com/${repoPath}.git`,
    };
  }

  // Git URL (ssh or https)
  if (trimmed.startsWith('git@') || trimmed.endsWith('.git')) {
    return {
      type: 'git',
      url: trimmed,
    };
  }

  // 默认当作 GitHub shorthand
  return {
    type: 'github',
    url: `https://github.com/${trimmed}.git`,
  };
}

/**
 * 判断是否为本地路径
 */
function isLocalPath(input: string): boolean {
  return (
    path.isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    /^[a-zA-Z]:[/\\]/.test(input) // Windows path
  );
}

/**
 * 检查 git 是否可用
 */
function checkGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取仓库的最新 commit hash 作为版本号
 */
function getGitCommitHash(repoDir: string): string {
  try {
    const hash = execSync('git rev-parse --short HEAD', {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    return hash;
  } catch {
    return 'unknown';
  }
}

/**
 * 从 slug 提取显示名称
 */
function extractSlug(source: ParsedSource): string {
  if (source.type === 'local') {
    return path.basename(source.localPath || '');
  }
  if (source.owner && source.repo) {
    return `${source.owner}/${source.repo}`;
  }
  // 从 URL 提取最后部分
  const parts = source.url.replace(/\.git$/, '').split('/');
  return parts[parts.length - 1] || 'unknown';
}

/**
 * 安全检查子路径（防止路径穿越）
 */
function sanitizeSubpath(subpath: string): string {
  const segments = subpath.replace(/\\/g, '/').split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(`Unsafe subpath: "${subpath}" contains path traversal`);
    }
  }
  return subpath;
}

/**
 * 解析 SKILL.md 文件，提取 name 和 description
 */
function parseSkillMd(skillMdPath: string): DiscoveredSkill | null {
  try {
    const content = fs.readFileSync(skillMdPath, 'utf-8');

    // 解析 YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const data: Record<string, any> = {};

    // 简单解析 YAML frontmatter
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        // 处理引号包裹的值
        data[key] = value.replace(/^["']|["']$/g, '');
      }
    }

    if (!data.name || !data.description) {
      return null;
    }

    if (typeof data.name !== 'string' || typeof data.description !== 'string') {
      return null;
    }

    return {
      name: data.name,
      description: data.description,
      relativePath: path.dirname(skillMdPath),
      metadata: data.metadata,
    };
  } catch {
    return null;
  }
}

/**
 * 在目录中查找所有 SKILL.md 文件
 */
function discoverSkillsInDir(baseDir: string, subpath?: string): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const seenNames = new Set<string>();

  const searchPath = subpath ? path.join(baseDir, subpath) : baseDir;

  if (!fs.existsSync(searchPath)) {
    return skills;
  }

  // 先检查根目录是否有 SKILL.md
  const rootSkillMd = path.join(searchPath, 'SKILL.md');
  if (fs.existsSync(rootSkillMd)) {
    const skill = parseSkillMd(rootSkillMd);
    if (skill) {
      skill.relativePath = subpath || '';
      skills.push(skill);
      seenNames.add(skill.name);
    }
  }

  // 搜索优先目录
  for (const priorityDir of PRIORITY_SEARCH_DIRS) {
    const dirPath = path.join(searchPath, priorityDir);
    if (!fs.existsSync(dirPath)) continue;

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.includes(entry.name)) continue;

        const skillDir = path.join(dirPath, entry.name);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        if (fs.existsSync(skillMdPath)) {
          const skill = parseSkillMd(skillMdPath);
          if (skill && !seenNames.has(skill.name)) {
            // 计算相对于 baseDir 的路径
            skill.relativePath = path.relative(baseDir, skillDir);
            skills.push(skill);
            seenNames.add(skill.name);
          }
        }
      }
    } catch {
      // 忽略错误
    }
  }

  // 如果没有找到，进行深度搜索
  if (skills.length === 0) {
    findSkillDirsDeep(searchPath, skills, seenNames, baseDir, 0, 3);
  }

  return skills;
}

/**
 * 深度递归查找 SKILL.md
 */
function findSkillDirsDeep(
  dir: string,
  skills: DiscoveredSkill[],
  seenNames: Set<string>,
  baseDir: string,
  depth: number,
  maxDepth: number
): void {
  if (depth > maxDepth) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.includes(entry.name)) continue;

      const subDir = path.join(dir, entry.name);
      const skillMdPath = path.join(subDir, 'SKILL.md');

      if (fs.existsSync(skillMdPath)) {
        const skill = parseSkillMd(skillMdPath);
        if (skill && !seenNames.has(skill.name)) {
          skill.relativePath = path.relative(baseDir, subDir);
          skills.push(skill);
          seenNames.add(skill.name);
        }
      } else {
        // 继续递归
        findSkillDirsDeep(subDir, skills, seenNames, baseDir, depth + 1, maxDepth);
      }
    }
  } catch {
    // 忽略错误
  }
}

/**
 * 生成 skill slug（基于 name，不带 repo 层级）
 */
function generateSkillSlug(skillName: string): string {
  // 将 name 转换为 slug 格式
  return skillName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveKnownSkillInput(input: string): { source: string; skillName?: string } | null {
  const normalizedInput = generateSkillSlug(input);

  for (const repo of KNOWN_SKILL_REPOS) {
    const repoName = repo.repo.split('/').pop() || repo.repo;
    if (
      generateSkillSlug(repo.repo) === normalizedInput ||
      generateSkillSlug(repoName) === normalizedInput
    ) {
      return { source: repo.repo };
    }

    const skillName = repo.skills.find(
      (skill) => generateSkillSlug(skill) === normalizedInput,
    );
    if (skillName) {
      return { source: repo.repo, skillName };
    }
  }

  return null;
}

export const skillInstallService = {
  /**
   * 发现 Skills：clone 仓库并扫描所有 SKILL.md
   */
  async discover(slugOrUrl: string): Promise<DiscoverResult> {
    console.log(`[skillInstall] Discovering skills from ${slugOrUrl}`);

    // 检查 git 是否可用
    if (!checkGitAvailable()) {
      throw new Error('git is not available. Please install git first.');
    }

    // 解析来源
    const source = parseSource(slugOrUrl);
    const repoSlug = extractSlug(source);

    console.log(`[skillInstall] Source parsed: type=${source.type}, url=${source.url}`);

    // 创建临时目录
    const tempDir = path.join(os.tmpdir(), `skill-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      // 本地路径：直接扫描
      if (source.type === 'local' && source.localPath) {
        console.log(`[skillInstall] Scanning local path: ${source.localPath}`);
        const skills = discoverSkillsInDir(source.localPath, source.subpath);
        return {
          repoSlug,
          version: 'local',
          skills,
          tempDir: source.localPath,
        };
      }

      // git clone
      console.log(`[skillInstall] Cloning ${source.url}...`);
      const cloneArgs = ['clone', '--depth', '1'];
      if (source.ref) {
        cloneArgs.push('--branch', source.ref);
      }
      cloneArgs.push(source.url, tempDir);

      execSync(`git ${cloneArgs.join(' ')}`, {
        encoding: 'utf8',
        timeout: 60000,
      });

      // 获取版本
      const version = getGitCommitHash(tempDir);

      // 扫描 skills
      const skills = discoverSkillsInDir(tempDir, source.subpath);

      console.log(`[skillInstall] Discovered ${skills.length} skills from ${repoSlug}`);

      return {
        repoSlug,
        version,
        skills,
        tempDir,
      };
    } catch (error) {
      // 清理临时目录
      if (fs.existsSync(tempDir) && source.type !== 'local') {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to discover skills: ${message}`);
    }
  },

  /**
   * 安装选中的 Skills
   */
  async installSelected(
    discoverResult: DiscoverResult,
    selectedSkills: DiscoveredSkill[],
    targetDir: string  // targetDir 已经是 skills 目录
  ): Promise<SkillInstallResult[]> {
    console.log(`[skillInstall] Installing ${selectedSkills.length} skills to ${targetDir}`);

    const results: SkillInstallResult[] = [];
    fs.mkdirSync(targetDir, { recursive: true });

    for (const skill of selectedSkills) {
      const slug = generateSkillSlug(skill.name);
      const skillSourceDir = path.join(discoverResult.tempDir, skill.relativePath);
      const skillTargetDir = path.join(targetDir, slug);

      // 如果已存在，先删除
      if (fs.existsSync(skillTargetDir)) {
        console.log(`[skillInstall] Removing existing: ${skillTargetDir}`);
        fs.rmSync(skillTargetDir, { recursive: true, force: true });
      }

      // 确保父目录存在
      const parentDir = path.dirname(skillTargetDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // 复制 skill 目录
      console.log(`[skillInstall] Copying ${skill.name} to ${slug}`);
      fs.cpSync(skillSourceDir, skillTargetDir, {
        recursive: true,
        filter: (src) => {
          // 跳过 .git 目录
          const relative = path.relative(skillSourceDir, src);
          return !relative.startsWith('.git');
        },
      });

      // 写入 origin.json 元数据
      const originDir = path.join(skillTargetDir, '.skills');
      const originPath = path.join(originDir, 'origin.json');
      fs.mkdirSync(originDir, { recursive: true });

      const originData = {
        version: 1,
        source: discoverResult.repoSlug,
        slug,
        installedVersion: discoverResult.version,
        installedAt: Date.now(),
        skillName: skill.name,
        skillDescription: skill.description,
      };

      fs.writeFileSync(originPath, JSON.stringify(originData, null, 2), 'utf8');

      results.push({
        slug,
        version: discoverResult.version,
        installedAt: Date.now(),
        path: skillTargetDir,
      });

      console.log(`[skillInstall] Installed ${slug}@${discoverResult.version}`);
    }

    // 清理临时目录（如果不是本地路径）
    if (discoverResult.version !== 'local' && fs.existsSync(discoverResult.tempDir)) {
      try {
        fs.rmSync(discoverResult.tempDir, { recursive: true, force: true });
      } catch {
        // 忽略清理错误
      }
    }

    return results;
  },

  /**
   * 旧版安装方法（直接 clone 整个仓库，用于简单场景）
   * @deprecated 请使用 discover + installSelected
   */
  async install(slugOrUrl: string, targetDir: string): Promise<SkillInstallResult> {
    const knownSkill = resolveKnownSkillInput(slugOrUrl);
    const discoverResult = await this.discover(knownSkill?.source || slugOrUrl);

    if (knownSkill?.skillName) {
      const selectedSkill = discoverResult.skills.find(
        (skill) =>
          generateSkillSlug(skill.name) === generateSkillSlug(knownSkill.skillName!),
      );

      if (!selectedSkill) {
        throw new Error(`No skill named ${knownSkill.skillName} found in ${discoverResult.repoSlug}`);
      }

      const results = await this.installSelected(discoverResult, [selectedSkill], targetDir);
      return results[0];
    }

    // 如果只有一个 skill，直接安装
    if (discoverResult.skills.length === 1) {
      const results = await this.installSelected(discoverResult, discoverResult.skills, targetDir);
      return results[0];
    }

    // 如果没有找到 skill，抛出错误
    if (discoverResult.skills.length === 0) {
      throw new Error(`No SKILL.md found in ${discoverResult.repoSlug}`);
    }

    // 如果有多个 skill，抛出错误提示用户选择
    throw new Error(
      `Found ${discoverResult.skills.length} skills in ${discoverResult.repoSlug}. ` +
      `Please select which ones to install: ${discoverResult.skills.map(s => s.name).join(', ')}`
    );
  },

  /**
   * 列出已安装的 Skills（targetDir 已经是 skills 目录）
   * 支持两种来源：通过本系统安装的（有 .skills/origin.json）和其他方式安装的（有 SKILL.md）
   */
  listInstalled(targetDir: string): InstalledSkill[] {
    if (!fs.existsSync(targetDir)) {
      return [];
    }

    const results: InstalledSkill[] = [];
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });

    for (const entry of entries) {
      // 跳过隐藏目录
      if (entry.name.startsWith('.')) continue;

      // 检查是否是目录或符号链接（symlink 安装的技能）
      const isDir = entry.isDirectory();
      const isSymlink = entry.isSymbolicLink();
      if (!isDir && !isSymlink) continue;

      const skillDir = path.join(targetDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      const originPath = path.join(skillDir, '.skills', 'origin.json');

      // 必须有 SKILL.md 文件才算有效的 skill
      if (!fs.existsSync(skillMdPath)) continue;

      // 检查是否有 origin.json 元数据
      if (fs.existsSync(originPath)) {
        try {
          const origin = JSON.parse(fs.readFileSync(originPath, 'utf8'));
          results.push({
            slug: origin.slug || entry.name,
            version: origin.installedVersion || null,
            source: origin.source,
          });
        } catch {
          results.push({ slug: entry.name, version: null });
        }
      } else {
        // 没有 origin.json，通过其他方式安装的 skill
        results.push({ slug: entry.name, version: null });
      }
    }

    return results;
  },

  /**
   * 删除已安装的 Skill（targetDir 已经是 skills 目录）
   */
  uninstall(slug: string, targetDir: string): boolean {
    const skillDir = path.join(targetDir, slug);

    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(skillDir);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }

    if (stats.isSymbolicLink() || stats.isFile()) {
      fs.unlinkSync(skillDir);
    } else if (stats.isDirectory()) {
      fs.rmSync(skillDir, { recursive: true, force: true });
    } else {
      return false;
    }

    console.log(`[skillInstall] Removed: ${skillDir}`);

    return true;
  },

  /**
   * 搜索 Skills（搜索预设仓库列表）
   */
  async search(query: string, limit: number = 10): Promise<SkillSearchResult[]> {
    const q = query.toLowerCase().trim();
    if (!q) {
      return [];
    }

    const results: SkillSearchResult[] = [];
    const seenRepos = new Set<string>();

    // 搜索仓库
    for (const repo of KNOWN_SKILL_REPOS) {
      // 匹配仓库名称、描述、关键词
      const matchesRepoName = repo.repo.toLowerCase().includes(q);
      const matchesDescription = repo.description.toLowerCase().includes(q);
      const matchesKeywords = repo.keywords.some(k => k.includes(q));

      if (matchesRepoName || matchesDescription || matchesKeywords) {
        if (!seenRepos.has(repo.repo)) {
          results.push({
            slug: repo.repo,
            displayName: repo.repo.split('/')[1],
            version: 'latest',
            score: matchesRepoName ? 100 : matchesKeywords ? 80 : 60,
          });
          seenRepos.add(repo.repo);
        }
      }

      // 搜索具体 skill 名称
      for (const skill of repo.skills) {
        if (skill.toLowerCase().includes(q)) {
          if (!seenRepos.has(repo.repo)) {
            results.push({
              slug: repo.repo,
              displayName: `${skill} (${repo.repo})`,
              version: 'latest',
              score: 90,
            });
            seenRepos.add(repo.repo);
          }
        }
      }
    }

    // 按分数排序，返回前 limit 个
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  },

  /**
   * 获取 Agent 的 Skills 根目录。
   * builtin 类型按助手 workDir 隔离；未配置 workDir 时使用默认 builtin 目录。
   * ACP 类型使用固定全局目录，再由 ACP executor symlink 到会话工作目录。
   */
  getAgentSkillsDir(agent: Pick<Agent, 'id' | 'type' | 'workDir'>): string {
    if (agent.type === 'acp') {
      return this.getGlobalAgentSkillsDir(agent.id);
    }

    const baseDir = agent.workDir?.trim() || path.join(os.homedir(), '.teamagentx', 'builtin');
    return path.join(baseDir, 'skills', agent.id);
  },

  /**
   * 获取 Skill source 路径列表。
   * 返回包含 SKILL.md 子目录的 skills 根目录，例如 /skills/{agentId}/。
   */
  getSkillsPaths(skillsDir: string): string[] {
    if (!fs.existsSync(skillsDir)) {
      return [];
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue; // 跳过 .git 等隐藏目录

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (fs.existsSync(skillMdPath)) {
        return [skillsDir];
      }
    }

    return [];
  },

  /**
   * 获取 ACP Agent 的全局 Skills 目录路径
   * 用于存储 Skills 的固定位置，不受工作目录变化影响
   * 目录结构：~/.teamagentx/agents/{agentId}/.claude/skills/
   */
  getGlobalAgentSkillsDir(agentId: string): string {
    return path.join(os.homedir(), '.teamagentx', 'agents', agentId, '.claude', 'skills');
  },

  /**
   * 扫描外部 AI 工具目录中的技能
   * 支持 ~/.claude/skills、~/.codex/skills、~/.openclaw/skills、~/.agent/skills
   */
  discoverExternalSkills(): ExternalSkill[] {
    const homeDir = os.homedir();
    const sharedSkillsDir = path.join(homeDir, '.teamagentx', 'skills');
    const results: ExternalSkill[] = [];

    for (const tool of EXTERNAL_SKILL_DIRS) {
      const toolSkillsDir = path.join(homeDir, tool.path);

      if (!fs.existsSync(toolSkillsDir)) {
        continue;
      }

      console.log(`[skillInstall] Scanning external tool directory: ${toolSkillsDir}`);

      try {
        const entries = fs.readdirSync(toolSkillsDir, { withFileTypes: true });

        for (const entry of entries) {
          // 跳过非目录和非软连接
          const isDir = entry.isDirectory();
          const isSymlink = entry.isSymbolicLink();
          if (!isDir && !isSymlink) continue;
          if (entry.name.startsWith('.')) continue;

          const skillDir = path.join(toolSkillsDir, entry.name);
          const skillMdPath = path.join(skillDir, 'SKILL.md');

          if (!fs.existsSync(skillMdPath)) continue;

          // 解析 SKILL.md
          const skill = parseSkillMd(skillMdPath);
          if (!skill) continue;

          // 生成 slug
          const slug = generateSkillSlug(skill.name);

          // 检查是否已存在于共享目录
          const existsInShared = fs.existsSync(path.join(sharedSkillsDir, slug));

          // 提取工具名称（从 path 中提取）
          const sourceTool = tool.path.split('/')[0].replace('.', '');

          results.push({
            name: skill.name,
            description: skill.description,
            slug,
            sourceTool,
            sourcePath: skillDir,
            existsInShared,
          });
        }
      } catch (error) {
        console.error(`[skillInstall] Error scanning ${toolSkillsDir}:`, error);
      }
    }

    console.log(`[skillInstall] Found ${results.length} external skills`);
    return results;
  },

  /**
   * 导入外部技能到共享目录
   * 支持 symlink（自动同步）或 copy（独立管理）两种方式
   * 注意：Windows 不支持 symlink，会自动降级为 copy
   */
  importExternalSkill(
    sourcePath: string,
    method: 'symlink' | 'copy' = 'symlink'
  ): ExternalImportResult {
    const homeDir = os.homedir();
    const sharedSkillsDir = path.join(homeDir, '.teamagentx', 'skills');

    // 确保共享目录存在
    fs.mkdirSync(sharedSkillsDir, { recursive: true });

    // 解析 SKILL.md 获取技能信息
    const skillMdPath = path.join(sourcePath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return {
        slug: '',
        method,
        targetPath: '',
        success: false,
        error: 'SKILL.md not found in source path',
      };
    }

    const skill = parseSkillMd(skillMdPath);
    if (!skill) {
      return {
        slug: '',
        method,
        targetPath: '',
        success: false,
        error: 'Invalid SKILL.md format',
      };
    }

    const slug = generateSkillSlug(skill.name);
    const targetPath = path.join(sharedSkillsDir, slug);

    // 如果已存在，先删除
    if (fs.existsSync(targetPath)) {
      const stats = fs.lstatSync(targetPath);
      if (stats.isSymbolicLink()) {
        fs.unlinkSync(targetPath);
      } else {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }
    }

    // Windows 不支持 symlink，自动降级为 copy
    const isWindows = process.platform === 'win32';
    const actualMethod = isWindows && method === 'symlink' ? 'copy' : method;

    try {
      if (actualMethod === 'symlink') {
        // 创建 symlink
        fs.symlinkSync(sourcePath, targetPath, 'dir');
        console.log(`[skillInstall] Created symlink: ${targetPath} -> ${sourcePath}`);
      } else {
        // 复制目录
        fs.cpSync(sourcePath, targetPath, {
          recursive: true,
          filter: (src) => {
            const relative = path.relative(sourcePath, src);
            return !relative.startsWith('.git');
          },
        });
        console.log(`[skillInstall] Copied skill to: ${targetPath}`);
      }

      // 写入 origin.json 元数据（仅对 copy 方式，symlink 不需要）
      if (method === 'copy') {
        const originDir = path.join(targetPath, '.skills');
        const originPath = path.join(originDir, 'origin.json');
        fs.mkdirSync(originDir, { recursive: true });

        // 尝试读取已有的 origin.json
        let existingOrigin: Record<string, any> = {};
        const existingOriginPath = path.join(sourcePath, '.skills', 'origin.json');
        if (fs.existsSync(existingOriginPath)) {
          try {
            existingOrigin = JSON.parse(fs.readFileSync(existingOriginPath, 'utf8'));
          } catch {
            // 忽略
          }
        }

        const originData = {
          ...existingOrigin,
          version: 1,
          source: `external:${path.basename(sourcePath).split('/')[0]}`,
          sourcePath: sourcePath.replace(homeDir, '~'),
          importMethod: actualMethod,
          slug,
          installedAt: Date.now(),
          skillName: skill.name,
          skillDescription: skill.description,
        };

        fs.writeFileSync(originPath, JSON.stringify(originData, null, 2), 'utf8');
      }

      return {
        slug,
        method: actualMethod,
        targetPath,
        success: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        slug,
        method: actualMethod,
        targetPath,
        success: false,
        error: message,
      };
    }
  },
};
