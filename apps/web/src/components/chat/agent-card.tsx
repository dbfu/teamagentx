import { MoreHorizontal, Pencil, Trash2, Power, PowerOff, Copy, Zap, Download, Settings, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Agent } from '@/lib/agent-api'
import { AgentAvatar } from './agent-avatar'
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '@/lib/system-agents'
import { FloatingMenu } from '@/components/ui/floating-menu'
import { useTranslation } from 'react-i18next'

interface AgentCardProps {
  assistant: Agent
  openMenuId: string | null
  contextMenuPosition: { x: number; y: number } | null
  onContextMenu: (e: React.MouseEvent, assistant: Agent) => void
  onToggleMenu: (id: string, pos?: { x: number; y: number } | null) => void
  onEdit: (assistant: Agent) => void
  onCopy: (assistant: Agent) => void
  onToggleStatus: (id: string, currentStatus: boolean) => void
  onDelete: (assistant: Agent) => void
  onStartQuickChat?: (agent: Agent) => void
  onInstallSkill?: (agent: Agent) => void
  onCoordinatorLogs?: (agent: Agent) => void
  onClick?: (assistant: Agent) => void // 点击跳转详情页
  isDragging?: boolean // 是否正在被拖拽
}

// 菜单内容组件（复用于右键菜单和下拉菜单）
function MenuContent({
  assistant,
  onEdit,
  onCopy,
  onToggleStatus,
  onDelete,
  onStartQuickChat,
  onInstallSkill,
  onCoordinatorLogs,
}: {
  assistant: Agent
  onEdit: (assistant: Agent) => void
  onCopy: (assistant: Agent) => void
  onToggleStatus: (id: string, currentStatus: boolean) => void
  onDelete: (assistant: Agent) => void
  onStartQuickChat?: (agent: Agent) => void
  onInstallSkill?: (agent: Agent) => void
  onCoordinatorLogs?: (agent: Agent) => void
}) {
  const { t } = useTranslation()
  const isSystemAgent = assistant.agentLevel === 'system'
  const isGroupAssistant = assistant.id === GROUP_ASSISTANT_ID || assistant.name === '群助手'
  const isGroupCoordinator = assistant.id === GROUP_COORDINATOR_ID || assistant.name === '群调度助手'
  const canConfigureSystemModel = isSystemAgent && (isGroupAssistant || isGroupCoordinator)
  const canStartQuickChat = assistant.isActive && onStartQuickChat && (!isSystemAgent || isGroupAssistant)
  const hasTopActions = canStartQuickChat || (!isSystemAgent && onInstallSkill) || (isGroupCoordinator && onCoordinatorLogs)
  const hasEditActions = !isSystemAgent || canConfigureSystemModel

  return (
    <>
      {/* 快速对话 - 仅对活跃助手显示 */}
      {canStartQuickChat && (
        <button
          onClick={() => onStartQuickChat(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/50"
        >
          <Zap className="size-3.5" />
          {t('assistant.quickChat')}
        </button>
      )}

      {/* 安装 Skills */}
      {!isSystemAgent && onInstallSkill && (
        <button
          onClick={() => onInstallSkill(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/5"
        >
          <Download className="size-3.5" />
          {t('assistant.installSkill')}
        </button>
      )}

      {/* 调度日志 - 仅对群调度助手显示 */}
      {isGroupCoordinator && onCoordinatorLogs && (
        <button
          onClick={() => onCoordinatorLogs(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50"
        >
          <History className="size-3.5" />
          {t('workbench.coordinatorLogs')}
        </button>
      )}

      {/* 分隔线 - 仅在有上下两组菜单时显示 */}
      {hasTopActions && hasEditActions && (
        <div className="my-1 border-t border-border" />
      )}

      {canConfigureSystemModel && (
        <button
          onClick={() => onEdit(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          <Settings className="size-3.5" />
          {t('common.edit')}
        </button>
      )}
      {!isSystemAgent && (
        <button
          onClick={() => onEdit(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          <Pencil className="size-3.5" />
          {t('common.edit')}
        </button>
      )}
      {!isSystemAgent && (
        <button
          onClick={() => onCopy(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          <Copy className="size-3.5" />
          {t('common.copy')}
        </button>
      )}
      {!isSystemAgent && (
        <button
          onClick={() => onToggleStatus(assistant.id, assistant.isActive)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          {assistant.isActive ? (
            <>
              <PowerOff className="size-3.5" />
              {t('common.deactivate')}
            </>
          ) : (
            <>
              <Power className="size-3.5" />
              {t('common.enable')}
            </>
          )}
        </button>
      )}
      {/* 系统助手不允许删除 */}
      {assistant.agentLevel !== 'system' && (
        <button
          onClick={() => onDelete(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="size-3.5" />
          {t('common.delete')}
        </button>
      )}
    </>
  )
}

// ACP 工具与能力标签的展示名（卡片副标题/标签的近似映射）
const ACP_TOOL_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

// 副标题：使用的 agent（ACP 工具名 / 模型提供方名）
function getAgentSubtitle(assistant: Agent, t: (key: string) => string): string {
  if (assistant.type === 'acp' && assistant.acpTool) {
    return ACP_TOOL_LABELS[assistant.acpTool] || assistant.acpTool
  }
  return assistant.llmProvider?.name || t('assistant.builtinAgent')
}

// 使用的模型
function getAgentModel(assistant: Agent): string | null {
  if (assistant.type === 'acp') {
    if (assistant.acpTool === 'claude') return assistant.claudeModel
    if (assistant.acpTool === 'codex') return assistant.codexModel
    return null
  }
  return assistant.llmProvider?.model || null
}

export function AgentCard({
  assistant,
  openMenuId,
  contextMenuPosition,
  onContextMenu,
  onToggleMenu,
  onEdit,
  onCopy,
  onToggleStatus,
  onDelete,
  onStartQuickChat,
  onInstallSkill,
  onCoordinatorLogs,
  onClick,
  isDragging,
}: AgentCardProps) {
  const { t } = useTranslation()
  const isGroupAssistant = assistant.id === GROUP_ASSISTANT_ID || assistant.name === '群助手'
  const isSystemChatDisabled = assistant.agentLevel === 'system' && !isGroupAssistant
  const isSystemAgent = assistant.agentLevel === 'system'
  const subtitle = getAgentSubtitle(assistant, t)
  const model = getAgentModel(assistant)
  const thinkingLabels: Record<string, string> = {
    high: t('assistant.thinkingHigh'),
    medium: t('assistant.thinkingMedium'),
    low: t('assistant.thinkingLow'),
    off: t('assistant.thinkingOff'),
  }
  const thinkingLabel = thinkingLabels[assistant.thinkingMode] || assistant.thinkingMode

  return (
    <div
      className={cn(
        'group relative flex h-[180px] w-full max-w-[360px] flex-col gap-3 overflow-hidden rounded-2xl bg-card p-5 shadow-sm transition-all duration-200 hover:shadow-md cursor-pointer',
        isDragging && 'opacity-40 scale-95',
        !assistant.isActive && 'opacity-60',
        assistant.agentLevel === 'system' && (!assistant.isActive || !onStartQuickChat || isSystemChatDisabled) && 'cursor-default'
      )}
      onContextMenu={(e) => onContextMenu(e, assistant)}
      onClick={() => {
        if (openMenuId) {
          return
        }
        if (assistant.agentLevel === 'system') {
          if (assistant.isActive && isGroupAssistant) {
            onStartQuickChat?.(assistant)
          }
          return
        }
        onClick?.(assistant)
      }}
    >
      {/* More menu button */}
      <div className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleMenu(assistant.id, null)
          }}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      {/* Context Menu - Right click */}
      {openMenuId === assistant.id && contextMenuPosition && (
        <FloatingMenu
          open
          x={contextMenuPosition.x}
          y={contextMenuPosition.y}
          onClose={() => onToggleMenu(assistant.id)}
          className="min-w-32 p-1"
        >
          <MenuContent
            assistant={assistant}
            onEdit={onEdit}
            onCopy={onCopy}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
            onStartQuickChat={onStartQuickChat}
            onInstallSkill={onInstallSkill}
            onCoordinatorLogs={onCoordinatorLogs}
          />
        </FloatingMenu>
      )}

      {/* Context Menu - Dropdown */}
      {openMenuId === assistant.id && !contextMenuPosition && (
        <div className="absolute right-3 top-10 z-10 min-w-32 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <MenuContent
            assistant={assistant}
            onEdit={onEdit}
            onCopy={onCopy}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
            onStartQuickChat={onStartQuickChat}
            onInstallSkill={onInstallSkill}
            onCoordinatorLogs={onCoordinatorLogs}
          />
        </div>
      )}

      {/* Header: avatar + name + subtitle */}
      <div className="flex items-start gap-3">
        <AgentAvatar
          avatar={assistant.avatar}
          avatarColor={assistant.avatarColor}
          agentLevel={assistant.agentLevel}
          size="lg"
          className={cn(!assistant.isActive && '[&>div]:opacity-50')}
        />
        <div className="min-w-0 flex-1 pr-6">
          <div className="flex items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-foreground">
              {assistant.name}
            </span>
            {isSystemAgent && (
              <span className="inline-flex shrink-0 items-center rounded-md bg-orange-500/10 px-1.5 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
                {t('assistant.systemBadge', { defaultValue: '系统' })}
              </span>
            )}
          </div>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {subtitle}
          </span>
        </div>
      </div>

      {/* Description（无描述时显示占位） */}
      <p
        className={cn(
          'line-clamp-2 min-h-[2.5rem] text-sm',
          assistant.description ? 'text-muted-foreground' : 'text-muted-foreground/50'
        )}
      >
        {assistant.description || t('assistant.noDescription', { defaultValue: '暂无描述' })}
      </p>

      {/* 状态 / 思考模式 / 模型 */}
      <div className="mt-auto flex items-center gap-2">
        {/* 状态 */}
        <span
          className={cn(
            'shrink-0 rounded-md px-2.5 py-1 text-xs',
            assistant.isActive
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {assistant.isActive
            ? t('assistant.enabled', { defaultValue: '已启用' })
            : t('assistant.disabled')}
        </span>

        {/* 思考模式 */}
        <span className="shrink-0 rounded-md bg-violet-500/10 px-2.5 py-1 text-xs text-violet-600 dark:text-violet-400">
          {t('assistant.thinkingModeShort', { defaultValue: '思考' })} · {thinkingLabel}
        </span>

        {/* 模型（未配置时显示使用默认模型配置） */}
        <span className="min-w-0 truncate rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          {model || t('assistant.defaultModelConfig', { defaultValue: '默认模型配置' })}
        </span>
      </div>
    </div>
  )
}
