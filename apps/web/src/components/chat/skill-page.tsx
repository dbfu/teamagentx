import { SelectAgentsDialog } from '@/components/chat/dialogs/select-agents-dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Agent, agentApi } from '@/lib/agent-api';
import { AgentAvatarImage } from '@/lib/agent-avatars';
import { ExternalSkill, SharedSkill, skillApi, SkillDetail, SkillFile } from '@/lib/skill-api';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, ChevronRight, Code, Copy, Download, File, FileText, Folder, FolderOpen, Import, Package, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

// 自定义 Tabs 组件
function SimpleTabs({
  tabs,
  defaultTab,
  renderContent,
}: {
  tabs: { key: string; label: string; count: number }[];
  defaultTab: string;
  renderContent: (key: string, searchQuery: string, setSearchQuery: (q: string) => void) => React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab 标签 */}
      <div className="flex items-center gap-6 px-4 pt-3 shrink-0 border-b">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'relative px-2 py-2 text-sm font-medium transition-colors duration-200',
                isActive ? 'text-primary' : 'text-muted-foreground',
                !isActive && 'hover:text-primary',
                // 下划线 - 使用伪元素，比文字宽
                'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary',
                isActive ? 'after:opacity-100' : 'after:opacity-0'
              )}
            >
              {tab.label}
              <span className={cn(
                'ml-1.5 rounded-full bg-muted px-2 py-0.5 text-xs',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
      {/* Tab 内容 */}
      <div className="flex-1 min-h-0 overflow-hidden p-4 flex flex-col">
        {renderContent(activeTab, searchQuery, setSearchQuery)}
      </div>
    </div>
  );
}

// 文件树节点
interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  content?: string;
  children?: FileTreeNode[];
}

// 将扁平文件列表转换为树形结构
function buildFileTree(files: SkillFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const nodeMap = new Map<string, FileTreeNode>();

  // 先创建所有节点
  for (const file of files) {
    nodeMap.set(file.path, {
      name: file.name,
      path: file.path,
      type: file.type,
      size: file.size,
      content: file.content,
      children: file.type === 'directory' ? [] : undefined,
    });
  }

  // 构建树形结构
  for (const file of files) {
    const node = nodeMap.get(file.path)!;
    const parentPath = file.path.split('/').slice(0, -1).join('/');

    if (parentPath === '') {
      // 根节点
      root.push(node);
    } else {
      // 找到父节点
      const parent = nodeMap.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }
  }

  // 排序：目录在前，文件在后，按名称排序
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
}

// 文件树组件
function FileTree({
  nodes,
  selectedFile,
  onSelectFile,
  expandedDirs,
  onToggleDir,
  level = 0,
}: {
  nodes: FileTreeNode[];
  selectedFile: SkillFile | null;
  onSelectFile: (file: SkillFile) => void;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  level?: number;
}) {
  const getFileIcon = (node: FileTreeNode) => {
    if (node.type === 'directory') {
      return expandedDirs.has(node.path) ? (
        <FolderOpen className="size-4 text-amber-500" />
      ) : (
        <Folder className="size-4 text-amber-500" />
      );
    }
    const ext = node.name.split('.').pop()?.toLowerCase();
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java'].includes(ext || '')) {
      return <Code className="size-4 text-blue-500" />;
    }
    if (ext === 'md') return <FileText className="size-4 text-muted-foreground" />;
    return <File className="size-4 text-muted-foreground" />;
  };

  return (
    <>
      {nodes.map((node) => (
        <div key={node.path}>
          <button
            onClick={() => {
              if (node.type === 'directory') {
                onToggleDir(node.path);
              } else {
                onSelectFile(node);
              }
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              node.type === 'file' && selectedFile?.path === node.path
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent',
            )}
            style={{ paddingLeft: `${level * 12 + 8}px` }}
          >
            {node.type === 'directory' && (
              expandedDirs.has(node.path)
                ? <ChevronDown className="size-4 text-muted-foreground" />
                : <ChevronRight className="size-4 text-muted-foreground" />
            )}
            {node.type === 'file' && <span className="w-3" />}
            {getFileIcon(node)}
            <span className="truncate">{node.name}</span>
          </button>
          {node.type === 'directory' && node.children && expandedDirs.has(node.path) && (
            <FileTree
              nodes={node.children}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </>
  );
}

export function SkillPage() {
  const [sharedSkills, setSharedSkills] = useState<SharedSkill[]>([]);
  const [externalSkills, setExternalSkills] = useState<ExternalSkill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [viewingSkill, setViewingSkill] = useState<SkillDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SkillFile | null>(null);
  // 文件树展开状态
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  // 选择助手弹框状态
  const [selectAgentsOpen, setSelectAgentsOpen] = useState(false);
  const [currentSkill, setCurrentSkill] = useState<SharedSkill | null>(null);
  const [batchInstalling, setBatchInstalling] = useState(false);
  // 复制路径状态
  const [copied, setCopied] = useState(false);
  // 打开目录状态
  const [openingFolder, setOpeningFolder] = useState(false);
  // 外部技能导入弹框状态
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importingSkill, setImportingSkill] = useState<string | null>(null);
  // 选中的外部技能
  const [selectedExternalSkills, setSelectedExternalSkills] = useState<Set<string>>(new Set());
  // 已安装技能搜索
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  const skillsPath = '~/.teamagentx/skills';

  // 检测是否为 Windows 系统
  const isWindows = typeof navigator !== 'undefined' &&
    (navigator.platform.toLowerCase().includes('win') ||
     navigator.userAgent.toLowerCase().includes('windows'));

  // 获取外部工具图标和名称
  const getToolInfo = (tool: string) => {
    const toolMap: Record<string, { name: string; color: string; bgColor: string; borderColor: string }> = {
      claude: { name: 'Claude Code', color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' },
      codex: { name: 'Codex', color: 'text-blue-600', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
      openclaw: { name: 'OpenClaw', color: 'text-green-600', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
      agents: { name: 'Agents', color: 'text-purple-600', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
      agent: { name: 'Agent', color: 'text-pink-600', bgColor: 'bg-pink-50', borderColor: 'border-pink-200' },
    };
    return toolMap[tool] || { name: tool, color: 'text-gray-600', bgColor: 'bg-gray-50', borderColor: 'border-gray-200' };
  };

  // 按工具分组外部技能
  const groupedExternalSkills = externalSkills.reduce((acc, skill) => {
    const tool = skill.sourceTool;
    if (!acc[tool]) {
      acc[tool] = [];
    }
    acc[tool].push(skill);
    return acc;
  }, {} as Record<string, ExternalSkill[]>);

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(skillsPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('复制失败');
    }
  };

  const handleOpenFolder = async () => {
    if (!window.electronAPI?.isElectron) {
      toast.error('仅在 Electron 客户端中支持打开目录');
      return;
    }
    setOpeningFolder(true);
    try {
      const result = await window.electronAPI.openFolder(skillsPath);
      if (!result.success) {
        toast.error('打开目录失败');
      }
    } catch {
      toast.error('打开目录失败');
    } finally {
      setOpeningFolder(false);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [skillsRes, agentsRes] = await Promise.all([
        skillApi.getShared(),
        agentApi.getAll(),
      ]);

      if (skillsRes.success && skillsRes.data) {
        setSharedSkills(skillsRes.data);
      }

      if (agentsRes.success && agentsRes.data) {
        setAgents(agentsRes.data.filter(a => a.isActive));
      }
    } catch (error) {
      console.error('Failed to load skills:', error);
    } finally {
      setLoading(false);
    }
  };

  // 加载外部技能
  const loadExternalSkills = async () => {
    setLoadingExternal(true);
    try {
      const result = await skillApi.getExternal();
      if (result.success && result.data) {
        setExternalSkills(result.data);
      }
    } catch (error) {
      console.error('Failed to load external skills:', error);
    } finally {
      setLoadingExternal(false);
    }
  };

  // 批量导入选中的外部技能
  const handleBatchImport = async (method: 'symlink' | 'copy') => {
    const skillsToImport = externalSkills.filter(s => selectedExternalSkills.has(s.sourcePath) && !s.existsInShared);
    if (skillsToImport.length === 0) {
      toast.warning('请选择要导入的技能');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const skill of skillsToImport) {
      setImportingSkill(skill.slug);
      try {
        const result = await skillApi.importExternal(skill.sourcePath, method);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    setImportingSkill(null);
    setSelectedExternalSkills(new Set());

    if (failCount === 0) {
      toast.success(`成功导入 ${successCount} 个技能`);
    } else {
      toast.warning(`导入完成，成功 ${successCount} 个，失败 ${failCount} 个`);
    }

    await loadData();
    await loadExternalSkills();
  };

  useEffect(() => {
    loadData();
    loadExternalSkills();
  }, []);

  const handleViewSkill = async (slug: string) => {
    setLoadingDetail(true);
    setSelectedFile(null);
    setExpandedDirs(new Set()); // 重置展开状态
    try {
      const result = await skillApi.getDetail(slug);
      if (result.success && result.data) {
        setViewingSkill(result.data);
        // 默认选中 SKILL.md 或第一个有内容的文件
        const skillMd = result.data.files.find(f => f.name === 'SKILL.md');
        if (skillMd) {
          setSelectedFile(skillMd);
        } else if (result.data.files.length > 0) {
          const firstFileWithContent = result.data.files.find(f => f.type === 'file' && f.content);
          if (firstFileWithContent) {
            setSelectedFile(firstFileWithContent);
          }
        }
      } else {
        toast.error(result.error || '获取技能内容失败');
      }
    } catch (error) {
      toast.error('获取技能内容失败');
    } finally {
      setLoadingDetail(false);
    }
  };

  // 打开选择助手弹框
  const handleOpenInstallDialog = (skill: SharedSkill) => {
    setCurrentSkill(skill);
    setSelectAgentsOpen(true);
  };

  // 获取当前技能已安装的助手ID列表
  const getInstalledAgentIds = (skill: SharedSkill): string[] => {
    return agents
      .filter(agent => skill.installedAgents.includes(agent.name))
      .map(agent => agent.id);
  };

  // 批量安装技能到选中的助手
  const handleBatchInstall = async (agentIds: string[]) => {
    if (!currentSkill) return;

    setBatchInstalling(true);
    try {
      // 获取当前已安装的助手
      const installedIds = getInstalledAgentIds(currentSkill);
      // 需要新安装的助手（在选中列表但不在已安装列表）
      const toInstall = agentIds.filter(id => !installedIds.includes(id));
      // 需要卸载的助手（在已安装列表但不在选中列表）
      const toUninstall = installedIds.filter(id => !agentIds.includes(id));

      let successCount = 0;
      let failCount = 0;

      // 执行安装
      for (const agentId of toInstall) {
        const result = await skillApi.symlink(currentSkill.slug, agentId);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      // 执行卸载
      for (const agentId of toUninstall) {
        const result = await skillApi.unlink(currentSkill.slug, agentId);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      if (failCount === 0) {
        toast.success(`已更新「${currentSkill.name}」的安装`);
      } else {
        toast.warning(`部分操作失败，成功 ${successCount} 个，失败 ${failCount} 个`);
      }

      setSelectAgentsOpen(false);
      await loadData();
    } catch (error) {
      toast.error('操作失败');
    } finally {
      setBatchInstalling(false);
    }
  };


  return (
    <>
      <div className="flex flex-1 flex-col bg-background">
        {/* Header */}
        <div
          className="mb-6 flex items-center justify-between border-b border-border px-6 h-14"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <div className="flex items-center gap-3">
            <Package className="size-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold text-foreground">技能</h2>
          </div>
          <div
            className="flex items-center gap-3"
            style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            {externalSkills.filter(s => !s.existsInShared).length > 0 && (
              <button
                onClick={() => setImportModalOpen(true)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90"
              >
                <Import className="size-4" />
                导入外部技能 ({externalSkills.filter(s => !s.existsInShared).length})
              </button>
            )}
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              刷新
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              加载中...
            </div>
          ) : sharedSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <Package className="size-16 mb-3 opacity-50" />
              <p className="text-lg">暂无技能</p>
              <p className="text-sm mt-2">在群聊中 @技能管理 创建技能</p>
              {externalSkills.filter(s => !s.existsInShared).length > 0 && (
                <button
                  onClick={() => setImportModalOpen(true)}
                  className="mt-4 flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
                >
                  <Import className="size-4" />
                  导入外部技能 ({externalSkills.filter(s => !s.existsInShared).length})
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 共享技能列表 */}
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  {/* 搜索框 */}
                  <div className="relative flex-1 max-w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={skillSearchQuery}
                      onChange={(e) => setSkillSearchQuery(e.target.value)}
                      placeholder="搜索技能..."
                      className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                    {skillSearchQuery && (
                      <button
                        onClick={() => setSkillSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {window.electronAPI?.isElectron && (
                      <button
                        onClick={handleOpenFolder}
                        disabled={openingFolder}
                        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        <FolderOpen className="size-3.5" />
                        <span>打开目录</span>
                      </button>
                    )}
                    <button
                      onClick={handleCopyPath}
                      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <FolderOpen className="size-3.5" />
                      <span>{skillsPath}</span>
                      {copied ? (
                        <Check className="size-3 text-green-500" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>
                </div>
                {/* 过滤技能 */}
                {(() => {
                  const filteredSkills = sharedSkills.filter(skill => {
                    if (!skillSearchQuery) return true;
                    const query = skillSearchQuery.toLowerCase();
                    return (
                      skill.name.toLowerCase().includes(query) ||
                      skill.description?.toLowerCase().includes(query)
                    );
                  });
                  return filteredSkills.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      未找到匹配的技能
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredSkills.map((skill) => (
                    <div key={skill.slug} className="rounded-lg gap-2 border bg-muted/30">
                      {/* 技能标题 */}
                      <div className="flex w-full items-center justify-between px-4 py-3 hover:bg-accent transition-colors">
                        <button
                          onClick={() => {
                            setExpandedSkills(prev => {
                              const next = new Set(prev);
                              if (next.has(skill.slug)) {
                                next.delete(skill.slug);
                              } else {
                                next.add(skill.slug);
                              }
                              return next;
                            });
                          }}
                          className="flex items-center gap-3 text-left flex-1"
                        >
                          {expandedSkills.has(skill.slug) ? (
                            <ChevronDown className="size-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-4 text-muted-foreground" />
                          )}
                          <div className="flex-1 w-0">
                            <div className="font-medium text-foreground">{skill.name}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {skill.description || '无描述'}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-2 ml-5">
                          <span className="text-xs text-muted-foreground">
                            <span className="rounded bg-muted px-2 py-0.5">
                              {skill.source === 'user-created' ? '用户创建' : skill.source.startsWith('external:') ? '外部导入' : '外部'}
                            </span>
                          </span>
                          { (
                            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              {skill.installedAgents.length} 助手
                            </span>
                          )}
                          {/* 查看内容按钮 */}
                          <button
                            onClick={() => handleViewSkill(skill.slug)}
                            disabled={loadingDetail}
                            className="flex items-center gap-1 rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
                          >
                            <FileText className="size-3" />
                            查看
                          </button>
                          {/* 安装按钮 */}
                          <button
                            onClick={() => handleOpenInstallDialog(skill)}
                            className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs text-white hover:bg-primary/90"
                          >
                            <Download className="size-3" />
                            安装
                          </button>
                        </div>
                      </div>

                      {/* 展开的详情 */}
                      {expandedSkills.has(skill.slug) && (
                        <div className="border-t px-4 py-3">
                          {/* 已安装到 */}
                          {skill.installedAgents.length > 0 && (
                            <div>
                              <div className="text-xs font-medium text-muted-foreground mb-2">已安装到:</div>
                              <div className="flex flex-wrap gap-2">
                                {skill.installedAgents.map((name) => {
                                  const agent = agents.find(a => a.name === name);
                                  return (
                                    <span
                                      key={name}
                                      className="flex items-center gap-1.5 rounded bg-primary/10 px-3 py-1 text-sm text-primary"
                                    >
                                      <AgentAvatarImage avatar={agent?.avatar ?? null} className="size-4" />
                                      {name}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 text-sm text-muted-foreground">
          在群聊中 @技能管理 创建新技能
        </div>
      </div>

      {/* 选择助手弹框 */}
      <SelectAgentsDialog
        open={selectAgentsOpen}
        onClose={() => setSelectAgentsOpen(false)}
        agents={agents}
        selectedAgentIds={currentSkill ? getInstalledAgentIds(currentSkill) : []}
        onConfirm={handleBatchInstall}
        title={`安装「${currentSkill?.name || ''}」到助手`}
        loading={batchInstalling}
      />

      {/* 技能内容查看模态框 */}
      {viewingSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setViewingSkill(null)}
          />
          {/* Modal */}
          <div className="relative z-10 flex max-h-[85vh] w-225 flex-col rounded-lg bg-card shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{viewingSkill.name}</h3>
                <p className="text-sm text-muted-foreground">{viewingSkill.description}</p>
              </div>
              <button
                onClick={() => setViewingSkill(null)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            {/* Content */}
            <div className="flex flex-1 overflow-hidden">
              {/* 文件列表 */}
              <div className="w-56 shrink-0 border-r bg-muted/30 overflow-y-auto">
                <div className="p-2">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1">文件列表</div>
                  <FileTree
                    nodes={buildFileTree(viewingSkill.files)}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                    expandedDirs={expandedDirs}
                    onToggleDir={(path) => {
                      setExpandedDirs(prev => {
                        const next = new Set(prev);
                        if (next.has(path)) {
                          next.delete(path);
                        } else {
                          next.add(path);
                        }
                        return next;
                      });
                    }}
                  />
                </div>
              </div>
              {/* 文件内容 */}
              <div className="flex-1 overflow-y-auto p-4">
                {selectedFile ? (
                  selectedFile.content ? (
                    <div>
                      <div className="mb-2 text-xs text-muted-foreground">
                        {selectedFile.path}
                        {selectedFile.size && ` (${(selectedFile.size / 1024).toFixed(1)} KB)`}
                      </div>
                      <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm text-foreground font-mono overflow-x-auto border max-h-[60vh] overflow-y-auto">
                        <code>{selectedFile.content}</code>
                      </pre>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <File className="size-12 mb-2 opacity-50" />
                      <p>无法预览此文件</p>
                      {selectedFile.size && (
                        <p className="text-xs mt-1">文件大小: {(selectedFile.size / 1024).toFixed(1)} KB</p>
                      )}
                    </div>
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <FileText className="size-12 mb-2 opacity-50" />
                    <p>选择文件查看内容</p>
                  </div>
                )}
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between border-t px-6 py-3">
              <div className="text-xs text-muted-foreground">
                来源: {viewingSkill.source === 'user-created' ? '用户创建' : '外部'}
                {' · '}
                {viewingSkill.files.length} 个文件
              </div>
              <button
                onClick={() => setViewingSkill(null)}
                className="rounded bg-muted px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入外部技能弹框 */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => {
              setImportModalOpen(false);
              setSelectedExternalSkills(new Set());
            }}
          />
          {/* Modal */}
          <div className="relative z-10 flex max-h-[85vh] w-[900px] flex-col rounded-lg bg-card shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">导入外部技能</h3>
              </div>
              <button
                onClick={() => {
                  setImportModalOpen(false);
                  setSelectedExternalSkills(new Set());
                }}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Content - Tabs */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {loadingExternal ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <RefreshCw className="size-5 animate-spin mr-2" />
                  扫描外部技能...
                </div>
              ) : (
                <SimpleTabs
                  tabs={Object.entries(groupedExternalSkills).map(([tool, skills]) => ({
                    key: tool,
                    label: getToolInfo(tool).name,
                    count: skills.filter(s => !s.existsInShared).length,
                  }))}
                  defaultTab={Object.keys(groupedExternalSkills)[0]}
                  renderContent={(activeKey, searchQuery, setSearchQuery) => {
                    const skills = groupedExternalSkills[activeKey] || [];
                    // 过滤并排序技能（未导入的在前，已导入的在后）
                    const filteredSkills = skills.filter(skill => {
                      if (!searchQuery) return true;
                      const query = searchQuery.toLowerCase();
                      return (
                        skill.name.toLowerCase().includes(query) ||
                        skill.description.toLowerCase().includes(query)
                      );
                    }).sort((a, b) => {
                      if (a.existsInShared === b.existsInShared) return 0;
                      return a.existsInShared ? 1 : -1;
                    });
                    return (
                      <div className="flex flex-col flex-1 min-h-0">
                        {/* 搜索框和全选按钮 - 固定 */}
                        <div className="flex items-center justify-between gap-3 shrink-0 pb-3">
                          <div className="relative flex-1 max-w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="搜索技能..."
                              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                            />
                            {searchQuery && (
                              <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X className="size-4" />
                              </button>
                            )}
                          </div>
                          <button
                            onClick={() => {
                              const notImportedSkills = filteredSkills.filter(s => !s.existsInShared);
                              const allSelected = notImportedSkills.every(s => selectedExternalSkills.has(s.sourcePath));
                              setSelectedExternalSkills(prev => {
                                const next = new Set(prev);
                                if (allSelected) {
                                  notImportedSkills.forEach(s => next.delete(s.sourcePath));
                                } else {
                                  notImportedSkills.forEach(s => next.add(s.sourcePath));
                                }
                                return next;
                              });
                            }}
                            className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors shrink-0"
                          >
                            {filteredSkills.filter(s => !s.existsInShared).every(s => selectedExternalSkills.has(s.sourcePath))
                              ? '取消全选'
                              : '全选'}
                          </button>
                        </div>
                        {/* 技能列表 - 可滚动 */}
                        {filteredSkills.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            未找到匹配的技能
                          </div>
                        ) : (
                          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
                            {filteredSkills.map((skill) => (
                              <label
                                key={skill.sourcePath}
                                className={cn(
                                  'flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer border transition-colors',
                                  skill.existsInShared
                                    ? 'border-green-500/30 bg-green-500/10 opacity-60'
                                    : 'border-border hover:bg-primary/10 hover:border-primary/30'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedExternalSkills.has(skill.sourcePath)}
                                  disabled={skill.existsInShared}
                                  onChange={(e) => {
                                    setSelectedExternalSkills(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) {
                                        next.add(skill.sourcePath);
                                      } else {
                                        next.delete(skill.sourcePath);
                                      }
                                      return next;
                                    });
                                  }}
                                  className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-foreground text-sm">{skill.name}</div>
                                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                                    {skill.description || '无描述'}
                                  </div>
                                </div>
                                {skill.existsInShared && (
                                  <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-600 font-medium">
                                    已导入
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t px-6 py-3">
              <div className="text-xs text-muted-foreground">
                已选择 {selectedExternalSkills.size} 个技能
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setImportModalOpen(false);
                    setSelectedExternalSkills(new Set());
                  }}
                  className="rounded border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                >
                  取消
                </button>
                {!isWindows && (
                  <HoverCard openDelay={200}>
                    <HoverCardTrigger asChild>
                      <button
                        onClick={() => handleBatchImport('symlink')}
                        disabled={selectedExternalSkills.size === 0 || importingSkill !== null}
                        className="flex items-center gap-1 rounded border border-primary px-4 py-1.5 text-sm text-primary hover:bg-primary/10 disabled:opacity-50"
                      >
                        <Import className="size-3" />
                        软连接
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-72" side="top">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">软连接导入</h4>
                        <p className="text-xs text-muted-foreground">
                          创建符号链接指向外部技能目录，外部技能更新后自动同步，节省磁盘空间。
                        </p>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                )}
                <HoverCard openDelay={200}>
                  <HoverCardTrigger asChild>
                    <button
                      onClick={() => handleBatchImport('copy')}
                      disabled={selectedExternalSkills.size === 0 || importingSkill !== null}
                      className="flex items-center gap-1 rounded bg-primary px-4 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                      <Download className="size-3" />
                      {isWindows ? '导入' : '复制'}
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-72" side="top">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">复制导入</h4>
                      <p className="text-xs text-muted-foreground">
                        完全复制技能文件到本地，独立管理，不受外部更新影响。
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
