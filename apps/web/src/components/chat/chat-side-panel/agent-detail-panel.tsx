import { cn } from '@/lib/utils'
import { Bot, Eye, History, Loader2, Trash2, ExternalLink, List, Send } from 'lucide-react'
import type { AgentStatus } from '@/stores/socket-store'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chat-store'
import { chatRoomApi } from '@/lib/agent-api'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { AgentAvatar } from '../agent-avatar'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'

// 稳定的空数组（避免每次渲染创建新数组）
const EMPTY_TASKS: { id: string; agentId: string; agentName: string; messageId: string; messageContent: string; status: string; createdAt: string }[] = []

interface AgentDetailPanelProps {
  chatRoomId: string
  selectedRoomAgent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null
  agentStatus?: AgentStatus
  hasExecutionRecords?: boolean
  onViewHistory: () => void
  onViewStream?: () => void
  onViewTaskQueue?: () => void
  onAgentSettingsChange?: (settings: { injectGroupHistory: boolean }) => void
  variant?: 'default' | 'warm' // warm 用于 3D 办公室的黄色主题
  onAssignTask?: () => void // 分配任务回调（用于 3D 办公室）
}

// 状态配置
function getStatusConfig(status: AgentStatus, t: (key: string) => string) {
  return {
    idle: { color: 'bg-muted-foreground/50', textColor: 'text-muted-foreground', label: t('agentStatus.idle') },
    executing: { color: 'bg-green-500', textColor: 'text-green-600', label: t('taskQueue.executingLabel') },
    busy: { color: 'bg-orange-500', textColor: 'text-orange-600', label: t('taskQueue.busyLabel') },
  }[status]
}

export function AgentDetailPanel({
  chatRoomId,
  selectedRoomAgent,
  agentStatus,
  hasExecutionRecords,
  onViewHistory,
  onViewStream,
  onViewTaskQueue,
  onAgentSettingsChange,
  variant = 'default',
  onAssignTask,
}: AgentDetailPanelProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isActive = agentStatus === 'executing' || agentStatus === 'busy'
  const statusConfig = agentStatus ? getStatusConfig(agentStatus, t) : null

  // 从 store 获取队列数量（pending）
  const agentQueueCounts = useChatStore((s) => s.agentQueueCounts)
  const pendingCount = selectedRoomAgent?.id ? agentQueueCounts.get(selectedRoomAgent.id) ?? 0 : 0

  // 从 store 获取 inactive tasks（interrupted + cancelled）- 使用稳定引用
  const inactiveTasksMap = useChatStore((s) => s.inactiveTasks)
  const inactiveTasks = useMemo(() => {
    return inactiveTasksMap.get(chatRoomId) ?? EMPTY_TASKS
  }, [inactiveTasksMap, chatRoomId])
  const inactiveCount = inactiveTasks.filter(t => t.agentId === selectedRoomAgent?.id).length

  // 总任务数量
  const totalTaskCount = pendingCount + inactiveCount
  const blocksAssistantDetail = isSystemAssistantDetailBlocked(selectedRoomAgent)

  // 清空上下文相关状态
  const [isClearing, setIsClearing] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [isSavingHistoryAccess, setIsSavingHistoryAccess] = useState(false)

  // 是否是可以清空上下文的助手（原生助手和 ACP 助手都支持）
  const canClearContext = selectedRoomAgent?.agentType === 'builtin' || selectedRoomAgent?.agentType === 'acp'
  const canConfigureHistoryAccess = Boolean(selectedRoomAgent?.id && selectedRoomAgent?.chatRoomAgentId)

  const handleToggleHistoryAccess = async () => {
    if (!selectedRoomAgent?.id || isSavingHistoryAccess) return

    const nextValue = !selectedRoomAgent.injectGroupHistory
    setIsSavingHistoryAccess(true)
    try {
      const result = await chatRoomApi.updateAgentSettings(chatRoomId, selectedRoomAgent.id, {
        injectGroupHistory: nextValue,
      })

      if (result.success && result.data) {
        onAgentSettingsChange?.({ injectGroupHistory: result.data.injectGroupHistory })
        toast.success(result.data.injectGroupHistory ? t('chat.agentDetail.historyAccessEnabled') : t('chat.agentDetail.historyAccessDisabled'))
      } else {
        toast.error(t('common.saveFailed'))
      }
    } catch (error) {
      toast.error(t('chat.agentDetail.historyAccessSaveFailed'))
    } finally {
      setIsSavingHistoryAccess(false)
    }
  }

  // 清空上下文
  const handleClearContext = async () => {
    if (!selectedRoomAgent?.chatRoomAgentId) return

    setIsClearing(true)
    try {
      const result = await chatRoomApi.clearAgentContext(chatRoomId, selectedRoomAgent.chatRoomAgentId)
      if (result.success) {
        toast.success(result.data?.message || t('chat.agentDetail.clearContextSuccess'))
        setShowConfirm(false)
      } else {
        toast.error(t('chat.agentDetail.clearContextFailed'))
      }
    } catch (error) {
      toast.error(t('chat.agentDetail.clearContextFailed'))
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 助手头像和名称 */}
      <div className={cn(
        "flex items-center gap-3 p-4 rounded-lg",
        variant === 'warm' ? "bg-transparent" : "bg-muted"
      )}>
        <div className="relative">
          <AgentAvatar
            avatar={selectedRoomAgent?.avatar ?? null}
            agentId={selectedRoomAgent?.id}
            agentName={selectedRoomAgent?.name}
            avatarColor={selectedRoomAgent?.avatarColor}
            agentLevel={selectedRoomAgent?.agentLevel as 'normal' | 'system' | undefined}
            size="lg"
          />
          {/* 状态指示器 */}
          {statusConfig && (
            <div className={cn('absolute -bottom-1 -right-1 size-4 rounded-full border-2',
              variant === 'warm' ? 'border-amber-50' : 'border-background',
              statusConfig.color
            )} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn("text-lg font-semibold", variant === 'warm' ? "text-amber-900" : "text-foreground")}>{selectedRoomAgent?.name ?? t('chat.agentDetail.unknownAssistant')}</div>
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-1 text-xs", variant === 'warm' ? "text-amber-700" : "text-muted-foreground")}>
              <Bot className="size-3" />
              <span>{t('chat.agentDetail.aiAssistant')}</span>
            </div>
            {statusConfig && (
              <div className={cn('flex items-center gap-1 text-xs', statusConfig.textColor)}>
                {isActive && <Loader2 className="size-3 animate-spin" />}
                <span>{statusConfig.label}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 描述 */}
      <div>
        <div className={cn("text-xs mb-1", variant === 'warm' ? "text-amber-600" : "text-muted-foreground")}>{t('chat.agentDetail.descriptionLabel')}</div>
        <div className={cn("text-sm", variant === 'warm' ? "text-amber-800" : "text-foreground")}>{selectedRoomAgent?.description || t('chat.agentDetail.noDescription')}</div>
      </div>

      {canConfigureHistoryAccess && (
        <div className={cn(
          "rounded-lg border p-3",
          variant === 'warm' ? "border-amber-200 bg-transparent" : "border-border bg-background"
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className={cn("text-sm font-medium", variant === 'warm' ? "text-amber-800" : "text-foreground")}>{t('chat.agentDetail.groupHistoryAccess')}</div>
              <div className={cn("mt-0.5 text-xs", variant === 'warm' ? "text-amber-600" : "text-muted-foreground")}>{t('chat.agentDetail.groupHistoryAccessHint')}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(selectedRoomAgent?.injectGroupHistory)}
              disabled={isSavingHistoryAccess}
              onClick={handleToggleHistoryAccess}
              className={cn(
                'relative h-5 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                selectedRoomAgent?.injectGroupHistory ? 'bg-blue-500' : 'bg-gray-200'
              )}
            >
              <span
                className={cn(
                  'absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform',
                  selectedRoomAgent?.injectGroupHistory ? 'translate-x-5' : 'translate-x-0'
                )}
              />
            </button>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="space-y-2 pt-2">
        {/* 3D办公室：分配任务按钮 */}
        {onAssignTask && (
          <button
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
              variant === 'warm'
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-blue-500 text-white hover:bg-blue-600"
            )}
            onClick={onAssignTask}
          >
            <Send className="size-4" />
            {t('chat.agentDetail.assignTask')}
          </button>
        )}

        {/* 主要操作：正在执行时显示查看执行 */}
        {onViewStream && isActive && (
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-600 transition-colors"
            onClick={onViewStream}
          >
            <Eye className="size-4" />
            {t('chat.agentDetail.viewCurrentTask')}
          </button>
        )}

        {/* 任务队列 */}
        {onViewTaskQueue && (
          <button
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
              variant === 'warm'
                ? "border-amber-200 bg-transparent text-amber-800 hover:bg-amber-100"
                : "border-border bg-background text-foreground hover:bg-accent"
            )}
            onClick={onViewTaskQueue}
          >
            <List className="size-4" />
            {t('chat.agentDetail.taskQueueLabel')}{totalTaskCount > 0 && <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-xs", variant === 'warm' ? "bg-amber-200/50 text-amber-700" : "bg-primary/10 text-primary")}>{totalTaskCount}</span>}
          </button>
        )}

        {/* 次要操作：历史和详情放一行 */}
        <div className="flex gap-2">
          <button
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
              variant === 'warm'
                ? "border-amber-200 bg-transparent text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={onViewHistory}
          >
            <History className="size-3.5" />
            {!isActive && hasExecutionRecords ? t('chat.agentDetail.recentExecution') : t('chat.agentDetail.executionHistory')}
          </button>
          {!blocksAssistantDetail && (
            <button
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors",
                variant === 'warm'
                  ? "border-amber-200 bg-transparent text-amber-700 hover:bg-amber-100 hover:text-amber-800"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              onClick={() => navigate(`/assistant/${selectedRoomAgent?.id}`)}
            >
              <ExternalLink className="size-3.5" />
              {t('chat.agentDetail.assistantDetails')}
            </button>
          )}
        </div>

        {/* 清空上下文 */}
        {canClearContext && selectedRoomAgent?.chatRoomAgentId && (
          <button
            className={cn(
              "w-full flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-xs transition-colors",
              variant === 'warm'
                ? "border-amber-200 text-red-500 hover:bg-amber-100"
                : "border-red-200 text-red-500 hover:bg-red-50"
            )}
            onClick={() => setShowConfirm(true)}
          >
            <Trash2 className="size-3.5" />
            {t('chat.agentDetail.clearContext')}
          </button>
        )}
      </div>

      {/* 确认对话框 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-background rounded-xl shadow-xl p-4 max-w-sm w-full mx-4">
            <h4 className="text-base font-semibold text-foreground mb-2">{t('chat.agentDetail.confirmClearContext')}</h4>
            <p className="text-sm text-muted-foreground mb-4">
              {t('chat.agentDetail.confirmClearContextDesc', { name: selectedRoomAgent?.name })}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-lg transition-colors"
                onClick={() => setShowConfirm(false)}
                disabled={isClearing}
              >
                {t('common.cancel')}
              </button>
              <button
                className="px-3 py-1.5 text-sm bg-red-500 text-white hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
                onClick={handleClearContext}
                disabled={isClearing}
              >
                {isClearing ? t('chat.agentDetail.clearing') : t('chat.agentDetail.confirmClear')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
