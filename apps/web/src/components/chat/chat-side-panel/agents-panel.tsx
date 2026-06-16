import { useState } from 'react'
import { ChatRoom, ChatRoomAgent, chatRoomApi, agentApi, Agent, AgentSpeechConfig, type AgentThinkingMode } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { Bot, Crown, Plus, Trash2, Star, AtSign } from 'lucide-react'
import { AddAgentDialog } from '@/components/chat/dialogs/add-agent-dialog'
import { CreateAssistantModal } from '@/components/chat/create-assistant-modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from 'sonner'
import type { AgentStatus } from '@/stores/socket-store'
import { AgentAvatar } from '../agent-avatar'
import { UserAvatar } from '../user-avatar'
import { isStreamViewBlocked } from '@/lib/system-agents'
import { useTranslation } from 'react-i18next'

interface AgentsPanelProps {
  chatRoom: ChatRoom
  agentStatuses?: Map<string, AgentStatus>
  onSelectAgent: (agent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean }) => void
  onAgentSettingsChange?: () => void | Promise<void>
  onInsertMention?: (agentId: string, agentName: string) => void
}

interface AgentInfo {
  id: string
  name: string
  avatar?: string | null
  avatarColor?: string | null
  description?: string | null
  role: string
  type: 'agent' | 'user'
  agentType?: string
  agentLevel?: string
  injectGroupHistory?: boolean
  chatRoomAgentId?: string
}

function getAgentInfo(roomAgent: ChatRoomAgent, t: (key: string) => string): AgentInfo | null {
  // If it's an AI agent
  if (roomAgent.agent) {
    return {
      id: roomAgent.agent.id,
      name: roomAgent.agent.name,
      avatar: roomAgent.agent.avatar,
      avatarColor: roomAgent.agent.avatarColor,
      description: roomAgent.agent.description,
      role: roomAgent.role,
      type: 'agent' as const,
      agentType: roomAgent.agent.type,
      agentLevel: roomAgent.agent.agentLevel,
      injectGroupHistory: roomAgent.injectGroupHistory,
      chatRoomAgentId: roomAgent.id,
    }
  }

  // If it's a human user (like the owner)
  if (roomAgent.user) {
    return {
      id: roomAgent.user.id,
      name: roomAgent.user.username,
      avatar: roomAgent.user.avatar,
      avatarColor: roomAgent.user.avatarColor,
      description: roomAgent.role === 'OWNER' ? t('chat.agentsPanel.ownerRole') : t('chat.agentsPanel.memberRole'),
      role: roomAgent.role,
      type: 'user' as const,
      agentType: undefined,
      agentLevel: undefined,
      injectGroupHistory: false,
      chatRoomAgentId: roomAgent.id,
    }
  }

  return null
}

// Status indicator component
function StatusIndicator({ status, t }: { status: AgentStatus; t: (key: string) => string }) {
  const statusConfig = {
    idle: { color: 'bg-muted-foreground/50', label: t('chat.agentsPanel.idle') },
    executing: { color: 'bg-green-500', label: t('chat.agentsPanel.executing') },
    busy: { color: 'bg-orange-500', label: t('chat.agentsPanel.busy') },
  }

  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-1">
      <div className={cn('size-2 rounded-full', config.color)} />
      <span className="text-xs text-muted-foreground">{config.label}</span>
    </div>
  )
}

// Agent item component
function AgentItem({
  info,
  roomAgent,
  agentStatus,
  onSelectAgent,
  onOpenRemove,
  chatRoomId,
  onInsertMention,
  t,
}: {
  info: AgentInfo
  roomAgent: ChatRoomAgent
  agentStatus?: AgentStatus
  onSelectAgent: (agent: AgentInfo & { chatRoomId: string }) => void
  onOpenRemove: (roomAgent: ChatRoomAgent, e: React.MouseEvent) => void
  chatRoomId: string
  onInsertMention?: (agentId: string, agentName: string) => void
  t: (key: string) => string
}) {
  const blocksDetail = info.type === 'agent' && isStreamViewBlocked(info)

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg p-2',
        blocksDetail ? 'cursor-default' : 'cursor-pointer hover:bg-accent'
      )}
      onClick={() => {
        if (blocksDetail) return
        onSelectAgent({
          ...info,
          chatRoomId,
        })
      }}
      onContextMenu={(e) => {
        if (info.type === 'agent') {
          e.preventDefault()
          onInsertMention?.(info.id, info.name)
        }
      }}
    >
      {info.type === 'agent' ? (
        <AgentAvatar
          avatar={info.avatar ?? null}
          avatarColor={info.avatarColor}
          agentLevel={info.agentLevel as 'normal' | 'system' | undefined}
          size="sm"
        />
      ) : (
        <UserAvatar avatar={info.avatar} size="sm" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm font-medium text-foreground truncate">{info.name}</span>
          {info.role === 'OWNER' && (
            <Crown className="size-3 text-yellow-500 shrink-0" />
          )}
          {info.agentLevel === 'system' && (
            <Star className="size-3 text-orange-500 shrink-0 fill-orange-500" />
          )}
        </div>
        {/* Status text for AI agents */}
        {info.type === 'agent' && agentStatus && (
          <StatusIndicator status={agentStatus} t={t} />
        )}
      </div>
      {/* @ 提及按钮 */}
      {info.type === 'agent' && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onInsertMention?.(info.id, info.name)
          }}
          className="rounded p-1 text-primary hover:bg-primary/10 shrink-0"
          title={`@${info.name}`}
        >
          <AtSign className="size-4" />
        </button>
      )}
      {/* Remove button for non-owner agents */}
      {info.type === 'agent' && info.role !== 'OWNER' && info.agentLevel !== 'system' && (
        <button
          onClick={(e) => onOpenRemove(roomAgent, e)}
          className="rounded p-1 text-red-400 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function AgentsPanel({ chatRoom, agentStatuses, onSelectAgent, onAgentSettingsChange, onInsertMention }: AgentsPanelProps) {
  const { t } = useTranslation()
  // Remove dialog state
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [agentToRemove, setAgentToRemove] = useState<{ id: string; name: string; chatRoomAgentId: string } | null>(null)
  const [removeLoading, setRemoveLoading] = useState(false)

  // Add agent dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([])
  const [addingAgentIds, setAddingAgentIds] = useState<Set<string>>(new Set())

  // 分类助手：群主、系统助手、普通助手
  const categorizeAgents = (chatRoomAgents: ChatRoomAgent[] | undefined) => {
    const owners: { info: AgentInfo; roomAgent: ChatRoomAgent }[] = []
    const systemAgents: { info: AgentInfo; roomAgent: ChatRoomAgent }[] = []
    const normalAgents: { info: AgentInfo; roomAgent: ChatRoomAgent }[] = []

    if (!chatRoomAgents) return { owners, systemAgents, normalAgents }

    for (const roomAgent of chatRoomAgents) {
      const info = getAgentInfo(roomAgent, t)
      if (!info) continue

      if (info.type === 'user' && info.role === 'OWNER') {
        owners.push({ info, roomAgent })
      } else if (info.type === 'agent' && info.agentLevel === 'system') {
        systemAgents.push({ info, roomAgent })
      } else {
        normalAgents.push({ info, roomAgent })
      }
    }

    return { owners, systemAgents, normalAgents }
  }

  const { owners, systemAgents, normalAgents } = categorizeAgents(chatRoom.chatRoomAgents)

  // 打开移除确认对话框
  const handleOpenRemove = (roomAgent: ChatRoomAgent, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!roomAgent.agent) return

    const info = getAgentInfo(roomAgent, t)
    if (!info) return

    setAgentToRemove({
      id: roomAgent.agent.id,
      name: info.name,
      chatRoomAgentId: info.chatRoomAgentId!,
    })
    setRemoveDialogOpen(true)
  }

  // 移除助手
  const handleRemoveAgent = async () => {
    if (!agentToRemove) return

    setRemoveLoading(true)
    try {
      const response = await chatRoomApi.removeAgent(chatRoom.id, agentToRemove.chatRoomAgentId)
      if (response.success) {
        toast.success(t('chat.agentsPanel.removedSuccess'))
        onAgentSettingsChange?.()
        setRemoveDialogOpen(false)
        setAgentToRemove(null)
      } else {
        toast.error(t('chat.agentsPanel.removeFailed'))
      }
    } finally {
      setRemoveLoading(false)
    }
  }

  // 打开添加助手对话框
  const handleOpenAddDialog = async () => {
    // 获取所有活跃助手
    const response = await agentApi.getActive()
    if (response.success && response.data) {
      // 过滤掉已经在群里的助手
      const existingAgentIds = new Set(
        chatRoom.chatRoomAgents?.map((ra) => ra.agent?.id).filter(Boolean) as string[]
      )
      const agentsToAdd = response.data.filter((agent) => !existingAgentIds.has(agent.id))
      setAvailableAgents(agentsToAdd)
      setAddDialogOpen(true)
    } else {
      toast.error(t('chat.agentsPanel.getAgentsFailed'))
    }
  }

  // 添加助手
  const handleAddAgents = async (agentIds: string[]) => {
    setAddingAgentIds(new Set(agentIds))
    try {
      for (const agentId of agentIds) {
        const response = await chatRoomApi.addAgent(chatRoom.id, {
          agentId,
          role: 'MEMBER',
        })

        if (!response.success) {
          toast.error(t('chat.agentsPanel.addFailed'))
          return
        }
      }

      toast.success(agentIds.length > 1 ? t('chat.agentsPanel.addedMultiple', { count: agentIds.length }) : t('chat.agentsPanel.addedSingle'))
      await Promise.resolve(onAgentSettingsChange?.())
      setAddDialogOpen(false)
    } finally {
      setAddingAgentIds(new Set())
    }
  }

  const handleOpenCreateAssistant = () => {
    setAddDialogOpen(false)
    setCreateDialogOpen(true)
  }

  const handleCreateAssistant = async (data: {
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
    fallbackLlmProviderIds: string[]
    speechConfig: AgentSpeechConfig | null
    imageGeneration?: { enabled: boolean; llmProviderId: string | null }
  }): Promise<boolean> => {
    const createResponse = await agentApi.create({
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
      categoryId: data.categoryId || undefined,
      llmProviderId: data.llmProviderId || undefined,
      fallbackLlmProviderIds: data.fallbackLlmProviderIds,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })

    if (!createResponse.success || !createResponse.data) {
      toast.error(createResponse.error || t('assistant.createFailed'))
      return false
    }

    const addResponse = await chatRoomApi.addAgent(chatRoom.id, {
      agentId: createResponse.data.id,
      role: 'MEMBER',
    })

    if (addResponse.success) {
      toast.success(t('chat.agentsPanel.createdAndAdded'))
      await Promise.resolve(onAgentSettingsChange?.())
      return true
    }

    toast.error(t('chat.agentsPanel.createdButAddFailed'))
    await Promise.resolve(onAgentSettingsChange?.())
    return true
  }

  // 渲染分组
  const renderGroup = (
    title: string,
    items: { info: AgentInfo; roomAgent: ChatRoomAgent }[],
    icon?: React.ReactNode
  ) => {
    if (items.length === 0) return null

    return (
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2 px-2">
          {icon}
          <span className="text-xs font-medium text-muted-foreground">{title}</span>
          <span className="text-xs text-muted-foreground/60">({items.length})</span>
        </div>
        <div className="space-y-1">
          {items.map(({ info, roomAgent }) => (
            <AgentItem
              key={roomAgent.id}
              info={info}
              roomAgent={roomAgent}
              agentStatus={info.type === 'agent' ? agentStatuses?.get(info.id) : undefined}
              onSelectAgent={onSelectAgent}
              onOpenRemove={handleOpenRemove}
              chatRoomId={chatRoom.id}
              onInsertMention={onInsertMention}
              t={t}
            />
          ))}
        </div>
      </div>
    )
  }

  const totalMembers = owners.length + systemAgents.length + normalAgents.length

  return (
    <>
      {/* 分组展示 */}
      {renderGroup(t('chat.agentsPanel.ownerGroup'), owners, <Crown className="size-3.5 text-yellow-500" />)}
      {renderGroup(t('chat.agentsPanel.normalAgentsGroup'), normalAgents, <Bot className="size-3.5 text-primary" />)}
      {renderGroup(t('chat.agentsPanel.systemAgentsGroup'), systemAgents, <Star className="size-3.5 text-orange-500 fill-orange-500" />)}

      {totalMembers === 0 && (
        <div className="text-sm text-muted-foreground text-center py-4">{t('chat.agentsPanel.noMembers')}</div>
      )}

      <div className="mt-4">
        <button
          onClick={handleOpenAddDialog}
          className="group flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 py-2.5 text-sm font-medium text-white shadow-sm shadow-blue-500/20 transition-all duration-200 hover:-translate-y-0.5 hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/25 active:translate-y-0 active:scale-[0.98] outline-none"
        >
          <Plus className="size-4 transition-transform duration-200 group-hover:rotate-90" />
          <span>{t('chat.agentsPanel.addAssistant')}</span>
        </button>
      </div>

      {/* Remove Confirm Dialog */}
      <ConfirmDialog
        open={removeDialogOpen}
        onOpenChange={setRemoveDialogOpen}
        title={t('chat.agentsPanel.removeAssistant')}
        description={t('chat.agentsPanel.removeConfirmDesc', { name: agentToRemove?.name || '' })}
        confirmText={t('chat.agentsPanel.remove')}
        onConfirm={handleRemoveAgent}
        loading={removeLoading}
      />

      {/* Add Agent Dialog */}
      <AddAgentDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        availableAgents={availableAgents}
        addingAgentIds={addingAgentIds}
        onAddAgents={handleAddAgents}
        onCreateAssistant={handleOpenCreateAssistant}
      />

      <CreateAssistantModal
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreateAssistant}
        submitLabel={t('common.createAndAdd')}
      />
    </>
  )
}
