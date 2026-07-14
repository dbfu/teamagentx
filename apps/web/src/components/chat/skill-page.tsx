import { SelectAgentsDialog } from '@/components/chat/dialogs/select-agents-dialog';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Agent, agentApi } from '@/lib/agent-api';
import { ExternalSkill, SharedSkill, skillApi, type SkillColor } from '@/lib/skill-api';
import { cn } from '@/lib/utils';
import { Check, Copy, Download, FolderOpen, Import, Package, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { SkillCard } from './skill-card';
import { SkillDetailModal } from './skill-detail-modal';
import { SkillInstalledAgentsModal } from './skill-installed-agents-modal';

// 自定义 Tabs 组件
function SimpleTabs({
  tabs,
  activeTab,
  onActiveTabChange,
  renderContent,
}: {
  tabs: { key: string; label: string; count: number }[];
  activeTab: string;
  onActiveTabChange: (key: string) => void;
  renderContent: (key: string, searchQuery: string, setSearchQuery: (q: string) => void) => React.ReactNode;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const currentTab = tabs.some((tab) => tab.key === activeTab) ? activeTab : tabs[0]?.key ?? '';

  useEffect(() => {
    if (currentTab && currentTab !== activeTab) {
      onActiveTabChange(currentTab);
    }
  }, [activeTab, currentTab, onActiveTabChange]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab 标签 */}
      <div className="flex shrink-0 items-center gap-6 border-b px-5 pt-4">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onActiveTabChange(tab.key)}
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-6">
        {currentTab ? renderContent(currentTab, searchQuery, setSearchQuery) : null}
      </div>
    </div>
  );
}

export function SkillPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sharedSkills, setSharedSkills] = useState<SharedSkill[]>([]);
  const [externalSkills, setExternalSkills] = useState<ExternalSkill[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [viewingSkillSlug, setViewingSkillSlug] = useState<string | null>(null);
  // 文件树展开状态
  // 选择助手弹框状态
  const [selectAgentsOpen, setSelectAgentsOpen] = useState(false);
  const [currentSkill, setCurrentSkill] = useState<SharedSkill | null>(null);
  const [batchInstalling, setBatchInstalling] = useState(false);
  const [unlinkingInstallKey, setUnlinkingInstallKey] = useState<string | null>(null);
  const [pendingUnlinkInstall, setPendingUnlinkInstall] = useState<{ skill: SharedSkill; agent: Agent } | null>(null);
  const [viewingInstalledSkillSlug, setViewingInstalledSkillSlug] = useState<string | null>(null);
  const [updatingSkillColorSlug, setUpdatingSkillColorSlug] = useState<string | null>(null);
  // 复制路径状态
  const [copied, setCopied] = useState(false);
  // 打开目录状态
  const [openingFolder, setOpeningFolder] = useState(false);
  // 外部技能导入弹框状态
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [activeImportTab, setActiveImportTab] = useState('local-folder');
  const [importingSkill, setImportingSkill] = useState<string | null>(null);
  // 选中的外部技能
  const [selectedExternalSkills, setSelectedExternalSkills] = useState<Set<string>>(new Set());
  const [selectedLocalFolder, setSelectedLocalFolder] = useState<string | null>(null);
  const [importingLocalFolder, setImportingLocalFolder] = useState(false);
  // 已安装技能搜索
  const [skillSearchQuery, setSkillSearchQuery] = useState('');

  useEffect(() => {
    const search = searchParams.get('search')?.trim();
    if (search) {
      setSkillSearchQuery(search);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('search');
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
  const externalImportCount = externalSkills.filter(s => !s.existsInShared).length;
  const localFolderTabKey = 'local-folder';
  const normalizedSkillSearchQuery = skillSearchQuery.trim().toLowerCase();
  const filteredSharedSkills = sharedSkills.filter((skill) => (
    !normalizedSkillSearchQuery
    || skill.name.toLowerCase().includes(normalizedSkillSearchQuery)
    || skill.description?.toLowerCase().includes(normalizedSkillSearchQuery)
    || skill.slug.toLowerCase().includes(normalizedSkillSearchQuery)
  ));
  const viewingInstalledSkill = viewingInstalledSkillSlug
    ? sharedSkills.find((skill) => skill.slug === viewingInstalledSkillSlug) ?? null
    : null;

  const closeImportModal = () => {
    setImportModalOpen(false);
    setSelectedExternalSkills(new Set());
    setSelectedLocalFolder(null);
  };

  // 打开导入弹框时重新扫描外部技能，避免显示挂载时的旧缓存
  const openImportModal = () => {
    setImportModalOpen(true);
    loadExternalSkills();
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(skillsPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('common.copyFailed'));
    }
  };

  const handleOpenFolder = async () => {
    if (!window.electronAPI?.isElectron) {
      toast.error(t('skill.openFolderOnlyInElectron'));
      return;
    }
    setOpeningFolder(true);
    try {
      const result = await window.electronAPI.openFolder(skillsPath);
      if (!result.success) {
        toast.error(t('skill.openFolderFailed'));
      }
    } catch {
      toast.error(t('skill.openFolderFailed'));
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
      toast.warning(t('skill.pleaseSelectToImport'));
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
      toast.success(t('skill.importSuccessCount', { count: successCount }));
    } else {
      toast.warning(t('skill.importPartialSuccess', { success: successCount, fail: failCount }));
    }

    await loadData();
    await loadExternalSkills();
  };

  const handleSelectLocalFolder = async () => {
    if (!window.electronAPI?.isElectron || !window.electronAPI.selectFolder) {
      toast.error(t('skill.selectFolderOnlyInElectron'));
      return;
    }

    try {
      const result = await window.electronAPI.selectFolder();
      if (result.success && result.path) {
        setSelectedLocalFolder(result.path);
      }
    } catch {
      toast.error(t('skill.selectFolderFailed'));
    }
  };

  const handleImportLocalFolder = async () => {
    if (!selectedLocalFolder) {
      toast.warning(t('skill.pleaseSelectLocalFolder'));
      return;
    }

    setImportingLocalFolder(true);
    try {
      const result = await skillApi.importLocalFolder(selectedLocalFolder);
      if (result.success) {
        toast.success(t('skill.copiedToSkillLibrary'));
        setSelectedLocalFolder(null);
        await loadData();
        await loadExternalSkills();
      } else {
        toast.error(t('skill.importFailed'));
      }
    } catch {
      toast.error(t('toast.importFailed'));
    } finally {
      setImportingLocalFolder(false);
    }
  };

  useEffect(() => {
    loadData();
    loadExternalSkills();
  }, []);

  const handleViewSkill = (slug: string) => {
    setViewingSkillSlug(slug);
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
        toast.success(t('skill.installUpdated', { name: currentSkill.name }));
      } else {
        toast.warning(t('skill.operationPartialSuccess', { success: successCount, fail: failCount }));
      }

      setSelectAgentsOpen(false);
      await loadData();
    } catch (error) {
      toast.error(t('common.operationFailed'));
    } finally {
      setBatchInstalling(false);
    }
  };

  const handleUnlinkInstalledAgent = async (skill: SharedSkill, agent: Agent) => {
    const installKey = `${skill.slug}:${agent.id}`;
    setUnlinkingInstallKey(installKey);
    try {
      const result = await skillApi.unlink(skill.slug, agent.id);
      if (result.success) {
        toast.success(t('skill.removedFromAgent', { agentName: agent.name, skillName: skill.name }));
        setPendingUnlinkInstall(null);
        if (skill.installedAgents.length <= 1) {
          setViewingInstalledSkillSlug(null);
        }
        await loadData();
      } else {
        toast.error(t('skill.removeFailed'));
      }
    } catch {
      toast.error(t('skill.removeFailed'));
    } finally {
      setUnlinkingInstallKey(null);
    }
  };

  const handleSkillColorChange = async (skill: SharedSkill, color: SkillColor) => {
    if (skill.color === color || updatingSkillColorSlug) return;

    const previousColor = skill.color;
    setUpdatingSkillColorSlug(skill.slug);
    setSharedSkills((currentSkills) => currentSkills.map((currentSkill) => (
      currentSkill.slug === skill.slug ? { ...currentSkill, color } : currentSkill
    )));

    try {
      const result = await skillApi.setColor(skill.slug, color);
      if (!result.success) {
        setSharedSkills((currentSkills) => currentSkills.map((currentSkill) => (
          currentSkill.slug === skill.slug ? { ...currentSkill, color: previousColor } : currentSkill
        )));
        toast.error(t('skill.colorUpdateFailed'));
      }
    } catch {
      setSharedSkills((currentSkills) => currentSkills.map((currentSkill) => (
        currentSkill.slug === skill.slug ? { ...currentSkill, color: previousColor } : currentSkill
      )));
      toast.error(t('skill.colorUpdateFailed'));
    } finally {
      setUpdatingSkillColorSlug(null);
    }
  };


  return (
    <>
      <div className="flex flex-1 flex-col bg-[var(--surface)]">
        {/* Header */}
        <div
          className="flex h-[52px] items-center border-b border-border px-4 shrink-0 bg-[var(--surface-raised)]"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <div className="flex items-center gap-2">
            <Package className="size-4 text-primary" />
            <span className="text-base font-semibold text-foreground">{t('nav.skills')}</span>
          </div>
          <div
            className="ml-auto flex min-w-0 items-center gap-1.5"
            style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            <div className="ta-search-shell h-8 min-w-0 max-w-44 flex-1">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={skillSearchQuery}
                onChange={(e) => setSkillSearchQuery(e.target.value)}
                placeholder={t('skill.searchPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {skillSearchQuery && (
                <button
                  type="button"
                  onClick={() => setSkillSearchQuery('')}
                  className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={t('common.clear')}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            {window.electronAPI?.isElectron && (
              <button
                onClick={handleOpenFolder}
                disabled={openingFolder}
                className="ta-icon-button"
                title={t('skill.openFolder')}
              >
                <FolderOpen className="size-4" />
              </button>
            )}
            <button
              onClick={handleCopyPath}
              className="ta-icon-button"
              title={skillsPath}
            >
              {copied ? (
                <Check className="size-4 text-green-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
            <button
              onClick={openImportModal}
              className="ta-button-primary size-8 shrink-0 px-0 text-xs xl:w-auto xl:px-3"
              title={externalImportCount > 0 ? t('skill.importSkillWithCount', { count: externalImportCount }) : t('skill.importSkill')}
            >
              <Import className="size-4" />
              <span className="hidden xl:inline">
                {externalImportCount > 0 ? t('skill.importSkillWithCount', { count: externalImportCount }) : t('skill.importSkill')}
              </span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="ta-button-secondary size-8 shrink-0 px-0 text-xs xl:w-auto xl:px-3"
              title={t('common.refresh')}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              <span className="hidden xl:inline">{t('common.refresh')}</span>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
            </div>
          ) : sharedSkills.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
              <Package className="mb-3 size-12" />
              <p>{t('skill.noSkills')}</p>
              <p className="mt-1 text-sm">{t('skill.createInChatroom')}</p>
              <button
                onClick={openImportModal}
                className="ta-button-primary mt-4"
              >
                <Import className="size-4" />
                {externalImportCount > 0 ? t('skill.importSkillWithCount', { count: externalImportCount }) : t('skill.importSkill')}
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 pb-6 pt-6">
                {filteredSharedSkills.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Search className="mb-2 size-12" />
                    <p>{t('skill.noMatchingSkills')}</p>
                  </div>
                ) : (
                  <div
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(max(280px, calc((100% - 4rem) / 5)), 1fr))',
                    }}
                  >
                    {filteredSharedSkills.map((skill) => (
                      <SkillCard
                        key={skill.slug}
                        skill={skill}
                        updatingColor={updatingSkillColorSlug === skill.slug}
                        onView={handleViewSkill}
                        onInstall={handleOpenInstallDialog}
                        onViewInstalledAgents={(selectedSkill) => setViewingInstalledSkillSlug(selectedSkill.slug)}
                        onColorChange={handleSkillColorChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 选择助手弹框 */}
      <SelectAgentsDialog
        open={selectAgentsOpen}
        onClose={() => setSelectAgentsOpen(false)}
        agents={agents}
        selectedAgentIds={currentSkill ? getInstalledAgentIds(currentSkill) : []}
        onConfirm={handleBatchInstall}
        title={t('skill.installToAgents', { name: currentSkill?.name || '' })}
        loading={batchInstalling}
      />

      <SkillInstalledAgentsModal
        skill={viewingInstalledSkill}
        agents={agents}
        unlinkingInstallKey={unlinkingInstallKey}
        onClose={() => setViewingInstalledSkillSlug(null)}
        onRequestUnlink={(skill, agent) => setPendingUnlinkInstall({ skill, agent })}
      />

      <ConfirmDialog
        open={!!pendingUnlinkInstall}
        onOpenChange={(open) => !open && setPendingUnlinkInstall(null)}
        title={t('skill.removeSkill')}
        description={t('skill.removeSkillConfirm', { agentName: pendingUnlinkInstall?.agent.name ?? '', skillName: pendingUnlinkInstall?.skill.name ?? '' })}
        confirmText={t('skill.remove')}
        onConfirm={async () => {
          if (!pendingUnlinkInstall) return;
          await handleUnlinkInstalledAgent(pendingUnlinkInstall.skill, pendingUnlinkInstall.agent);
        }}
        loading={
          !!pendingUnlinkInstall &&
          unlinkingInstallKey === `${pendingUnlinkInstall.skill.slug}:${pendingUnlinkInstall.agent.id}`
        }
        icon={X}
      />

      <SkillDetailModal
        slug={viewingSkillSlug}
        onClose={() => setViewingSkillSlug(null)}
      />

      {/* 导入外部技能弹框 */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeImportModal}
          />
          {/* Modal */}
          <div className="relative z-10 flex max-h-[85vh] w-[900px] flex-col rounded-[var(--radius-panel)] bg-card shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{t('skill.importSkill')}</h3>
              </div>
              <button
                onClick={closeImportModal}
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
                  {t('skill.scanningExternalSkills')}
                </div>
              ) : (
                <SimpleTabs
                  tabs={[
                    ...Object.entries(groupedExternalSkills).map(([tool, skills]) => ({
                      key: tool,
                      label: getToolInfo(tool).name,
                      count: skills.filter(s => !s.existsInShared).length,
                    })),
                    {
                      key: localFolderTabKey,
                      label: t('skill.localFolder'),
                      count: selectedLocalFolder ? 1 : 0,
                    },
                  ]}
                  activeTab={activeImportTab}
                  onActiveTabChange={setActiveImportTab}
                  renderContent={(activeKey, searchQuery, setSearchQuery) => {
                    if (activeKey === localFolderTabKey) {
                      return (
                        <div className="flex min-h-0 flex-1 flex-col">
                          <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
                            <FolderOpen className="mb-3 size-10 text-primary" />
                            <div className="text-sm font-medium text-foreground">{t('skill.selectLocalFolder')}</div>
                            <div className="mt-1 max-w-md text-xs text-muted-foreground">
                              {t('skill.localFolderHint')}
                            </div>
                            <button
                              onClick={handleSelectLocalFolder}
                              className="ta-button-primary mt-5"
                            >
                              <FolderOpen className="size-4" />
                              {t('skill.selectFolder')}
                            </button>
                          </div>

                          {selectedLocalFolder && (
                            <div className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
                              <div className="text-xs text-muted-foreground">{t('skill.selected')}</div>
                              <div className="mt-1 truncate text-sm text-foreground">{selectedLocalFolder}</div>
                            </div>
                          )}
                        </div>
                      );
                    }

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
                          <div className="relative max-w-72 flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder={t('skill.searchPlaceholder')}
                              className="ta-input w-full pl-9"
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
                            className="ta-button-secondary h-8 shrink-0 px-3 text-xs"
                          >
                            {filteredSkills.filter(s => !s.existsInShared).every(s => selectedExternalSkills.has(s.sourcePath))
                              ? t('common.clear')
                              : t('common.selectAll')}
                          </button>
                        </div>
                        {/* 技能列表 - 可滚动 */}
                        {filteredSkills.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground text-sm">
                            {t('skill.noMatchingSkills')}
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
                                  className="size-4 rounded border-gray-300 text-primary outline-none"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-foreground text-sm truncate">{skill.name}</span>
                                    {skill.collection && (
                                      <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                                        {t('skill.fromCollection', { name: skill.collection })}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                                    {skill.description || t('skill.noDescription')}
                                  </div>
                                </div>
                                {skill.existsInShared && (
                                  <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs text-green-600 font-medium">
                                    {t('skill.alreadyImported')}
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
                {activeImportTab === localFolderTabKey
                  ? selectedLocalFolder ? t('skill.selectedFolderCount') : t('skill.pleaseSelectSkillFolder')
                  : t('skill.selectedSkillCount', { count: selectedExternalSkills.size })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={closeImportModal}
                  className="ta-button-secondary"
                >
                  {t('common.cancel')}
                </button>
                {activeImportTab === localFolderTabKey ? (
                  <button
                    onClick={handleImportLocalFolder}
                    disabled={!selectedLocalFolder || importingLocalFolder}
                    className="ta-button-primary"
                  >
                    {importingLocalFolder ? (
                      <RefreshCw className="size-3 animate-spin" />
                    ) : (
                      <Download className="size-3" />
                    )}
                    {t('skill.copyToSkillLibrary')}
                  </button>
                ) : (
                  <>
                    {!isWindows && (
                      <HoverCard openDelay={200}>
                        <HoverCardTrigger asChild>
                          <button
                            onClick={() => handleBatchImport('symlink')}
                            disabled={selectedExternalSkills.size === 0 || importingSkill !== null}
                            className="ta-button-secondary border-primary text-primary hover:bg-primary/10"
                          >
                            <Import className="size-3" />
                            {t('skill.symlink')}
                          </button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-72" side="top">
                          <div className="space-y-2">
                            <h4 className="font-medium text-sm">{t('skill.symlinkImport')}</h4>
                            <p className="text-xs text-muted-foreground">
                              {t('skill.symlinkImportHint')}
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
                        className="ta-button-primary"
                      >
                        <Download className="size-3" />
                        {isWindows ? t('common.import') : t('common.copy')}
                      </button>
                    </HoverCardTrigger>
                    <HoverCardContent className="w-72" side="top">
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm">{t('skill.copyImport')}</h4>
                        <p className="text-xs text-muted-foreground">
                          {t('skill.copyImportHint')}
                        </p>
                      </div>
                    </HoverCardContent>
                  </HoverCard>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
