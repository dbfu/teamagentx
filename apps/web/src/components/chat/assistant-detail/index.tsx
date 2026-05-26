import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Agent, AgentSpeechConfig, agentApi, type AgentThinkingMode } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'
import { useAuthStore, useChatRoomStore } from '@/stores'
import {
  ArrowLeft,
  Bot,
  Cpu,
  Download,
  Globe,
  History,
  Pencil,
  Power,
  PowerOff,
  Settings,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EditAssistantModal } from '../edit-assistant-modal'
import { AgentAvatar } from '../agent-avatar'
import { InstallSkillModal } from '../install-skill-modal'
import { QuickChatStartDialog } from '../quick-chat-start-dialog'
import { AssistantConfigTab } from './assistant-config-tab'
import { AssistantHistoryTab } from './assistant-history-tab'
import { AssistantSkillsTab } from './assistant-skills-tab'
import { AssistantVoiceTab } from './assistant-voice-tab'
import { useAssistantDetail } from './hooks/use-assistant-detail'

// 加载骨架屏
function LoadingSkeleton() {
  return (
    <div className="flex flex-1 flex-col bg-muted">
      <div className="px-8 py-6">
        <Skeleton className="h-4 w-16 mb-6" />
        <div className="flex items-start gap-6">
          <Skeleton className="h-20 w-20 rounded-2xl" />
          <div className="flex-1">
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-64 mb-4" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 px-8">
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

// 错误状态
function ErrorState({ error, onBack }: { error: string; onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-muted">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Bot className="size-8 text-muted-foreground" />
      </div>
      <p className="text-muted-foreground mb-4">{error}</p>
      <Button variant="outline" onClick={onBack} className="gap-2">
        <ArrowLeft className="size-4" />
        返回助手列表
      </Button>
    </div>
  )
}

// 头部信息区域
function AssistantHeader({
  agent,
  onQuickChat,
  onEdit,
  onUpdateStatus,
  onInstallSkill,
  isToggling,
}: {
  agent: Agent
  onQuickChat?: () => void
  onEdit?: () => void
  onUpdateStatus?: (isActive: boolean) => void
  onInstallSkill?: () => void
  isToggling: boolean
}) {
  const isSystemAgent = agent.agentLevel === 'system'

  return (
    <div className="px-8 py-6">
      {/* 返回按钮 */}
      <button
        onClick={() => window.history.back()}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        <ArrowLeft className="size-4" />
        返回助手列表
      </button>

      {/* 主信息区 */}
      <div className="flex items-start gap-6">
        {/* 大头像 */}
        <AgentAvatar
          avatar={agent.avatar}
          avatarColor={agent.avatarColor}
          agentLevel={agent.agentLevel}
          size="xl"
          className={cn(!agent.isActive && 'opacity-50')}
        />

        {/* 名称和描述 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-foreground">{agent.name}</h1>
            {!agent.isActive && (
              <Badge variant="secondary" className="bg-muted text-muted-foreground">
                已停用
              </Badge>
            )}
          </div>

          {agent.description && (
            <p className="text-muted-foreground mb-4 line-clamp-2">{agent.description}</p>
          )}

          {/* 标签信息 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Badge
              variant="outline"
              className="gap-1.5 bg-primary/5 text-primary border-primary/20"
            >
              {agent.type === 'builtin' ? (
                <Sparkles className="size-3" />
              ) : (
                <Cpu className="size-3" />
              )}
              {agent.type === 'builtin' ? '原生助手' : '外部工具'}
            </Badge>

            {agent.type === 'acp' && agent.acpTool && (
              <Badge variant="outline" className="gap-1.5">
                <Globe className="size-3" />
                {agent.acpTool}
              </Badge>
            )}

            {agent.llmProvider && (
              <Badge variant="outline" className="gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200">
                {agent.llmProvider.name}
              </Badge>
            )}

            {agent.category && (
              <Badge variant="outline" className="bg-muted">
                {agent.category.name}
              </Badge>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-3">
            {agent.isActive && onQuickChat && (
              <Button
                onClick={onQuickChat}
                className="gap-2 bg-purple-500 hover:bg-purple-600 text-white"
              >
                <Zap className="size-4" />
                快速对话
              </Button>
            )}

            {!isSystemAgent && onInstallSkill && (
              <Button variant="outline" onClick={onInstallSkill} className="gap-2 border-primary/20 text-primary hover:bg-primary/5">
                <Download className="size-4" />
                安装 Skill
              </Button>
            )}

            {!isSystemAgent && onEdit && (
              <Button variant="outline" onClick={onEdit} className="gap-2">
                <Pencil className="size-4" />
                编辑
              </Button>
            )}

            {/* 状态切换 */}
            {!isSystemAgent && onUpdateStatus && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onUpdateStatus(!agent.isActive)}
                disabled={isToggling}
                className={cn(
                  'gap-1.5',
                  agent.isActive
                    ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {agent.isActive ? (
                  <PowerOff className="size-4" />
                ) : (
                  <Power className="size-4" />
                )}
                {agent.isActive ? '停用' : '启用'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function AssistantDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()
  const loadChatRooms = useChatRoomStore((s) => s.loadChatRooms)
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const [quickChatDialogOpen, setQuickChatDialogOpen] = useState(false)
  const [creatingQuickChat, setCreatingQuickChat] = useState(false)

  const {
    agent,
    skills,
    loading,
    error,
    refreshAgent,
    refreshSkills,
    uninstallSkill,
    updateStatus,
  } = useAssistantDetail(id!)

  // 返回助手列表
  const handleBack = () => {
    navigate('/assistant')
  }

  // 快速对话 - 和助手列表页一样
  const handleQuickChat = () => {
    setQuickChatDialogOpen(true)
  }

  const handleCreateQuickChat = async (workDir?: string) => {
    if (!currentUser?.id) {
      toast.error('请先登录')
      return
    }
    if (!agent) return

    setCreatingQuickChat(true)
    try {
      const response = await agentApi.createQuickChat(agent.id, currentUser.id, workDir)
      if (response.success && response.data) {
        setQuickChatDialogOpen(false)
        // 先刷新群聊列表，确保新创建的群聊已加载
        await loadChatRooms()
        // 选中该群聊
        selectRoom(response.data.id)
        // 导航到消息页
        navigate('/')
      } else {
        toast.error(response.error || '创建快速对话失败')
      }
    } finally {
      setCreatingQuickChat(false)
    }
  }

  // 编辑配置 - 打开编辑模态框
  const handleEdit = () => {
    setIsEditModalOpen(true)
  }

  // 更新助手
  const handleUpdateAssistant = async (data: {
    name: string
    avatar: string
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    proxyConfig?: string | null
    codexModel?: string | null
    codexFastMode?: boolean
    claudeModel?: string | null
    thinkingMode?: AgentThinkingMode | null
    categoryId: string | null
    llmProviderId: string | null
    speechConfig: AgentSpeechConfig | null
    imageGeneration?: { enabled: boolean; llmProviderId: string | null }
  }): Promise<boolean> => {
    if (!agent) return false
    const response = await agentApi.update(agent.id, {
      name: data.name,
      avatar: data.avatar,
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      proxyConfig: data.proxyConfig || null,
      codexModel: data.codexModel || null,
      codexFastMode: Boolean(data.codexFastMode),
      claudeModel: data.claudeModel || null,
      thinkingMode: data.thinkingMode || 'high',
      categoryId: data.categoryId,
      llmProviderId: data.llmProviderId,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      await refreshAgent()
      await loadChatRooms()
      setIsEditModalOpen(false)
      return true
    } else {
      toast.error(response.error || '更新失败')
      return false
    }
  }

  // 卸载 Skill
  const handleUninstallSkill = async (slug: string) => {
    const success = await uninstallSkill(slug)
    if (success) {
      toast.success('已卸载')
    } else {
      toast.error('卸载失败')
    }
  }

  // 更新状态
  const handleUpdateStatus = async (isActive: boolean) => {
    setIsToggling(true)
    const success = await updateStatus(isActive)
    if (success) {
      toast.success(isActive ? '已启用' : '已停用')
    } else {
      toast.error('状态更新失败')
    }
    setIsToggling(false)
  }

  if (loading) {
    return <LoadingSkeleton />
  }

  if (error || !agent) {
    return <ErrorState error={error || '助手不存在'} onBack={handleBack} />
  }

  if (isSystemAssistantDetailBlocked(agent)) {
    return <ErrorState error="系统群助手不支持查看详情" onBack={handleBack} />
  }

  const showVoiceSettings = agent.agentLevel !== 'system'

  return (
    <div className="flex flex-1 flex-col bg-muted overflow-hidden">
      {/* 头部信息区域 */}
      <AssistantHeader
        agent={agent}
        onQuickChat={handleQuickChat}
        onEdit={handleEdit}
        onUpdateStatus={handleUpdateStatus}
        onInstallSkill={() => setIsInstallModalOpen(true)}
        isToggling={isToggling}
      />

      {/* Tab 内容区域 */}
      <div className="flex-1 overflow-hidden border-t border-border bg-card">
        <Tabs defaultValue="config" className="flex flex-1 flex-col h-full mt-2">
          <TabsList className="px-8 pt-6 pb-4 justify-start gap-2">
            <TabsTrigger value="config" className="gap-2">
              <Settings className="size-4" />
              配置信息
            </TabsTrigger>
            {showVoiceSettings && (
              <TabsTrigger value="voice" className="gap-2">
                <Volume2 className="size-4" />
                语音
              </TabsTrigger>
            )}
            <TabsTrigger value="skills" className="gap-2">
              <Bot className="size-4" />
              Skills
              {skills.length > 0 && (
                <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                  {skills.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="size-4" />
              会话记录
            </TabsTrigger>
          </TabsList>

          {/* 分隔线 */}
          <div className="border-b border-border p-1" />

          <TabsContent value="config" className="flex-1 overflow-y-auto p-4 m-0">
            <AssistantConfigTab agent={agent} onUpdate={refreshAgent} />
          </TabsContent>

          {showVoiceSettings && (
            <TabsContent value="voice" className="flex-1 overflow-y-auto p-4 m-0">
              <AssistantVoiceTab agent={agent} onUpdate={refreshAgent} />
            </TabsContent>
          )}

          <TabsContent value="skills" className="flex-1 overflow-y-auto p-8 m-0">
            <AssistantSkillsTab
              agentId={agent.id}
              agentName={agent.name}
              skills={skills}
              onUninstall={handleUninstallSkill}
              onRefresh={refreshSkills}
            />
          </TabsContent>

          <TabsContent value="history" className="flex-1 overflow-y-auto p-8 m-0">
            <AssistantHistoryTab agentId={agent.id} />
          </TabsContent>
        </Tabs>
      </div>

      {/* 安装 Skill Modal */}
      {isInstallModalOpen && (
        <InstallSkillModal
          isOpen={isInstallModalOpen}
          onClose={() => setIsInstallModalOpen(false)}
          onSuccess={() => {
            setIsInstallModalOpen(false)
            refreshSkills()
          }}
          agentId={agent.id}
          agentName={agent.name}
        />
      )}

      <QuickChatStartDialog
        open={quickChatDialogOpen}
        onOpenChange={setQuickChatDialogOpen}
        agent={agent}
        onConfirm={handleCreateQuickChat}
        loading={creatingQuickChat}
      />

      {/* 编辑助手 Modal */}
      <EditAssistantModal
        key={agent.id}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSubmit={handleUpdateAssistant}
        assistant={agent}
        mode="edit"
      />
    </div>
  )
}
