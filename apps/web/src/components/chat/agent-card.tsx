import { MoreHorizontal, Pencil, Trash2, Power, PowerOff, Copy, Zap, Download, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Agent } from '@/lib/agent-api'
import { AgentAvatar } from './agent-avatar'
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '@/lib/system-agents'

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
}: {
  assistant: Agent
  onEdit: (assistant: Agent) => void
  onCopy: (assistant: Agent) => void
  onToggleStatus: (id: string, currentStatus: boolean) => void
  onDelete: (assistant: Agent) => void
  onStartQuickChat?: (agent: Agent) => void
  onInstallSkill?: (agent: Agent) => void
}) {
  const isSystemAgent = assistant.agentLevel === 'system'
  const isGroupAssistant = assistant.id === GROUP_ASSISTANT_ID || assistant.name === '群助手'
  const isGroupCoordinator = assistant.id === GROUP_COORDINATOR_ID || assistant.name === '群调度助手'
  const canConfigureSystemModel = isSystemAgent && (isGroupAssistant || isGroupCoordinator)
  const canStartQuickChat = assistant.isActive && onStartQuickChat && (!isSystemAgent || isGroupAssistant)
  const hasTopActions = canStartQuickChat || (!isSystemAgent && onInstallSkill)
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
          快速对话
        </button>
      )}

      {/* 安装 Skills */}
      {!isSystemAgent && onInstallSkill && (
        <button
          onClick={() => onInstallSkill(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary hover:bg-primary/5"
        >
          <Download className="size-3.5" />
          安装 Skills
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
          编辑
        </button>
      )}
      {!isSystemAgent && (
        <button
          onClick={() => onEdit(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          <Pencil className="size-3.5" />
          编辑
        </button>
      )}
      {!isSystemAgent && (
        <button
          onClick={() => onCopy(assistant)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
        >
          <Copy className="size-3.5" />
          复制
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
              停用
            </>
          ) : (
            <>
              <Power className="size-3.5" />
              启用
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
          删除
        </button>
      )}
    </>
  )
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
  onClick,
  isDragging,
}: AgentCardProps) {
  const isGroupAssistant = assistant.id === GROUP_ASSISTANT_ID || assistant.name === '群助手'
  const isSystemChatDisabled = assistant.agentLevel === 'system' && !isGroupAssistant

  return (
    <div
      className={cn(
        'group relative flex flex-col items-center gap-2 rounded-lg p-3 transition-all duration-200 hover:bg-accent cursor-pointer',
        isDragging && 'opacity-40 scale-95',
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
      {/* Status indicator */}
      {!assistant.isActive && (
        <div className="absolute left-2 top-2">
          <div className="size-2 rounded-full bg-muted-foreground" title="已停用" />
        </div>
      )}

      {/* More menu button */}
      <div className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleMenu(assistant.id, null)
          }}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      {/* Context Menu - Right click */}
      {openMenuId === assistant.id && contextMenuPosition && (
        <div
          className="fixed z-50 min-w-32 rounded-lg border border-border bg-popover p-1 shadow-lg"
          style={{ left: contextMenuPosition.x, top: contextMenuPosition.y }}
        >
          <MenuContent
            assistant={assistant}
            onEdit={onEdit}
            onCopy={onCopy}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
            onStartQuickChat={onStartQuickChat}
            onInstallSkill={onInstallSkill}
          />
        </div>
      )}

      {/* Context Menu - Dropdown */}
      {openMenuId === assistant.id && !contextMenuPosition && (
        <div className="absolute right-0 top-6 z-10 min-w-32 rounded-lg border border-border bg-popover p-1 shadow-lg">
          <MenuContent
            assistant={assistant}
            onEdit={onEdit}
            onCopy={onCopy}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
            onStartQuickChat={onStartQuickChat}
            onInstallSkill={onInstallSkill}
          />
        </div>
      )}

      {/* Avatar */}
      <AgentAvatar
        avatar={assistant.avatar}
        avatarColor={assistant.avatarColor}
        agentLevel={assistant.agentLevel}
        size="md"
        className={cn(!assistant.isActive && '[&>div]:opacity-50')}
      />

      {/* Name */}
      <span className={cn(
        'text-xs text-muted-foreground',
        !assistant.isActive && 'text-muted-foreground/50'
      )}>
        {assistant.name}
      </span>
    </div>
  )
}
