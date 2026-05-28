import { getApiBaseUrl } from './config';

// API 响应格式
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// 已安装的 Skill
export interface InstalledSkill {
  slug: string;
  version: string | null;
  installedAt?: number;
  registry?: string;
}

// Skill 搜索结果
export interface SkillSearchResult {
  slug: string;
  displayName?: string;
  version?: string;
  score: number;
}

// Skill 安装结果
export interface SkillInstallResult {
  slug: string;
  version: string;
  installedAt: number;
  path: string;
}

// 发现的 Skill
export interface DiscoveredSkill {
  name: string;
  description: string;
  relativePath: string;
}

// 发现结果
export interface DiscoverResult {
  sessionId: string;
  repoSlug: string;
  version: string;
  skills: DiscoveredSkill[];
}

// 共享技能
export interface SharedSkill {
  name: string;
  slug: string;
  description: string;
  source: string;
  installedAgents: string[];
}

// 创建技能参数
export interface CreateSkillParams {
  skillName: string;
  description: string;
  content: string;
}

// 创建技能结果
export interface CreateSkillResult {
  skillPath: string;
}

// Symlink 结果
export interface SymlinkSkillResult {
  symlinkPath: string;
}

// 技能文件
export interface SkillFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  content?: string;
}

// 技能详情
export interface SkillDetail {
  slug: string;
  name: string;
  description: string;
  source: string;
  frontmatter: Record<string, string>;
  content: string;
  rawContent: string;
  files: SkillFile[];
}

// 外部技能
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

// 统一的请求函数
async function request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const baseUrl = await getApiBaseUrl();
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...options?.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // 先检查响应状态
    if (!response.ok) {
      // 尝试解析错误信息
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.error) {
          errorMsg = errorData.error;
        }
      } catch {
        // 无法解析 JSON，使用默认错误信息
      }
      return {
        success: false,
        error: errorMsg,
      };
    }

    const data = await response.json();
    return data as ApiResponse<T>;
  } catch (error) {
    console.error('API request failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export const skillApi = {
  /**
   * 搜索 Skills
   */
  async search(query: string, limit: number = 10): Promise<ApiResponse<SkillSearchResult[]>> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    return request<SkillSearchResult[]>(`/skills/search?${params}`);
  },

  /**
   * 获取 Agent 已安装的 Skills
   */
  async getInstalled(agentId: string): Promise<ApiResponse<InstalledSkill[]>> {
    return request<InstalledSkill[]>(`/agents/${agentId}/skills`);
  },

  /**
   * 发现仓库中的 Skills（clone 并扫描）
   */
  async discover(agentId: string, slugOrUrl: string): Promise<ApiResponse<DiscoverResult>> {
    return request<DiscoverResult>(`/agents/${agentId}/skills/discover`, {
      method: 'POST',
      body: JSON.stringify({ slug: slugOrUrl }),
    });
  },

  /**
   * 安装选中的 Skills
   */
  async installSelected(
    agentId: string,
    sessionId: string,
    selectedIndices: number[]
  ): Promise<ApiResponse<SkillInstallResult[]>> {
    return request<SkillInstallResult[]>(`/agents/${agentId}/skills/install-selected`, {
      method: 'POST',
      body: JSON.stringify({ sessionId, selectedIndices }),
    });
  },

  /**
   * 安装 Skill（旧版，直接安装单个）
   */
  async install(agentId: string, slugOrUrl: string): Promise<ApiResponse<SkillInstallResult>> {
    return request<SkillInstallResult>(`/agents/${agentId}/skills/install`, {
      method: 'POST',
      body: JSON.stringify({ slug: slugOrUrl }),
    });
  },

  /**
   * 删除 Agent 的 Skill
   */
  async uninstall(agentId: string, slug: string): Promise<ApiResponse<void>> {
    return request<void>(`/agents/${agentId}/skills/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    });
  },

  /**
   * 获取共享技能列表
   */
  async getShared(): Promise<ApiResponse<SharedSkill[]>> {
    const result = await request<{ skills: SharedSkill[] }>('/skills/shared');
    if (result.success && result.data) {
      return { success: true, data: result.data.skills };
    }
    return { success: false, error: result.error };
  },

  /**
   * 创建技能到共享目录
   */
  async create(params: CreateSkillParams): Promise<ApiResponse<CreateSkillResult>> {
    return request<CreateSkillResult>('/skills/create', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /**
   * Symlink 安装技能到指定助手
   */
  async symlink(skillName: string, targetAgentId: string): Promise<ApiResponse<SymlinkSkillResult>> {
    return request<SymlinkSkillResult>('/skills/symlink', {
      method: 'POST',
      body: JSON.stringify({ skillName, targetAgentId }),
    });
  },

  /**
   * 删除 Symlink
   */
  async unlink(skillName: string, targetAgentId: string): Promise<ApiResponse<void>> {
    return request<void>('/skills/symlink', {
      method: 'DELETE',
      body: JSON.stringify({ skillName, targetAgentId }),
    });
  },

  /**
   * 获取技能详情（完整内容）
   */
  async getDetail(slug: string): Promise<ApiResponse<SkillDetail>> {
    return request<SkillDetail>(`/skills/${encodeURIComponent(slug)}`);
  },

  /**
   * 扫描外部 AI 工具目录中的技能
   */
  async getExternal(): Promise<ApiResponse<ExternalSkill[]>> {
    const result = await request<{ skills: ExternalSkill[] }>('/skills/external');
    if (result.success && result.data) {
      return { success: true, data: result.data.skills };
    }
    return { success: false, error: result.error };
  },

  /**
   * 导入外部技能到共享目录
   */
  async importExternal(
    sourcePath: string,
    method: 'symlink' | 'copy' = 'symlink'
  ): Promise<ApiResponse<ExternalImportResult>> {
    return request<ExternalImportResult>('/skills/import-external', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, method }),
    });
  },

  /**
   * 复制本地技能文件夹到共享目录
   */
  async importLocalFolder(sourcePath: string): Promise<ApiResponse<ExternalImportResult>> {
    return request<ExternalImportResult>('/skills/import-local-folder', {
      method: 'POST',
      body: JSON.stringify({ sourcePath }),
    });
  },
};
