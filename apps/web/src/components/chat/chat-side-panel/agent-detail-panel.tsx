import { cn } from '@/lib/utils'
import { Bot, Eye, History, Loader2, Trash2, ExternalLink, List } from 'lucide-react'
import type { AgentStatus } from '@/stores/socket-store'
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chat-store'
import { chatRoomApi } from '@/lib/agent-api'
import { toast } from 'sonner'
import { AgentAvatar } from '../agent-avatar'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'

// 稳定的空数组（避免每次渲染创建新数组）
const EMPTY_TASKS: { id: string; agentId: string; agentName: string; messageId: string; messageContent: string; status: string; createdAt: string }[] = []

interface AgentDetailPanelProps {
  chatRoomId: string
  selectedRoomAgent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null
  setSelectedRoomAgent: (agent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null) => void
  agentStatus?: AgentStatus
  hasExecutionRecords?: boolean
  onViewHistory: () => void
  onViewStream?: () => void
  onViewTaskQueue?: () => void
  onAgentSettingsChange?: () => void
}

// 状态配置
function getStatusConfig(status: AgentStatus) {
  return {
    idle: { color: 'bg-muted-foreground/50', textColor: 'text-muted-foreground', label: '空闲' },
    executing: { color: 'bg-green-500', textColor: 'text-green-600', label: '正在执行' },
    busy: { color: 'bg-orange-500', textColor: 'text-orange-600', label: '繁忙' },
  }[status]
}

export function AgentDetailPanel({
  chatRoomId,
  selectedRoomAgent,
  setSelectedRoomAgent,
  agentStatus,
  hasExecutionRecords,
  onViewHistory,
  onViewStream,
  onViewTaskQueue,
  onAgentSettingsChange,
}: AgentDetailPanelProps) {
  const navigate = useNavigate()
  const isActive = agentStatus === 'executing' || agentStatus === 'busy'
  const statusConfig = agentStatus ? getStatusConfig(agentStatus) : null

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

  const [savingSettings, setSavingSettings] = useState(false)

  // 是否是可以清空上下文的助手（原生助手和 ACP 助手都支持）
  const canClearContext = selectedRoomAgent?.agentType === 'builtin' || selectedRoomAgent?.agentType === 'acp'

  // 切换注入群历史
  const handleToggleInjectHistory = async () => {
    if (!selectedRoomAgent?.id || !selectedRoomAgent?.chatRoomAgentId) return

    const newValue = !selectedRoomAgent?.injectGroupHistory
    setSavingSettings(true)
    try {
      const response = await chatRoomApi.updateAgentSettings(chatRoomId, selectedRoomAgent.id, {
        injectGroupHistory: newValue,
      })
      if (response.success) {
        toast.success(newValue ? '已开启注入群历史' : '已关闭注入群历史')
        // 更新本地状态
        setSelectedRoomAgent({
          ...selectedRoomAgent,
          injectGroupHistory: newValue,
        })
        onAgentSettingsChange?.()
      } else {
        toast.error(response.error || '保存失败')
      }
    } finally {
      setSavingSettings(false)
    }
  }

  // 清空上下文
  const handleClearContext = async () => {
    if (!selectedRoomAgent?.chatRoomAgentId) return

    setIsClearing(true)
    try {
      const result = await chatRoomApi.clearAgentContext(chatRoomId, selectedRoomAgent.chatRoomAgentId)
      if (result.success) {
        toast.success(result.data?.message || '已清空对话上下文')
        setShowConfirm(false)
      } else {
        toast.error(result.error || '清空失败')
      }
    } catch (error) {
      toast.error('清空上下文失败')
    } finally {
      setIsClearing(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 助手头像和名称 */}
      <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
        <div className="relative">
          <AgentAvatar
            avatar={selectedRoomAgent?.avatar ?? null}
            avatarColor={selectedRoomAgent?.avatarColor}
            size="lg"
          />
          {/* 状态指示器 */}
          {statusConfig && (
            <div className={cn('absolute -bottom-1 -right-1 size-4 rounded-full border-2 border-background', statusConfig.color)} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-foreground">{selectedRoomAgent?.name ?? '未知助手'}</div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Bot className="size-3" />
              <span>AI 助手</span>
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
        <div className="text-xs text-muted-foreground mb-1">描述</div>
        <div className="text-sm text-foreground">{selectedRoomAgent?.description || '暂无描述'}</div>
      </div>

      {/* 注入群历史 */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">注入群历史</div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            开启后助手可以查看群聊历史消息
          </span>
          <button
            onClick={handleToggleInjectHistory}
            disabled={savingSettings}
            className={cn(
              'relative h-5 w-10 rounded-full transition-colors',
              selectedRoomAgent?.injectGroupHistory ? 'bg-primary' : 'bg-muted'
            )}
          >
            <div
              className={cn(
                'absolute top-0.5 size-4 rounded-full bg-background transition-transform',
                selectedRoomAgent?.injectGroupHistory ? 'translate-x-5.5 left-0.5' : 'translate-x-0.5 left-0.5'
              )}
            />
            {savingSettings && (
              <Loader2 className="absolute inset-0 m-auto size-3 animate-spin text-white" />
            )}
          </button>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="space-y-2 pt-2">
        {/* 主要操作：正在执行时显示查看执行 */}
        {onViewStream && isActive && (
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-600 transition-colors"
            onClick={onViewStream}
          >
            <Eye className="size-4" />
            查看当前执行任务
          </button>
        )}

        {/* 任务队列 */}
        {onViewTaskQueue && (
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            onClick={onViewTaskQueue}
          >
            <List className="size-4" />
            任务队列{totalTaskCount > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">{totalTaskCount}</span>}
          </button>
        )}

        {/* 次要操作：历史和详情放一行 */}
        <div className="flex gap-2">
          <button
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            onClick={onViewHistory}
          >
            <History className="size-3.5" />
            {!isActive && hasExecutionRecords ? '最近执行' : '执行历史'}
          </button>
          {!blocksAssistantDetail && (
            <button
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onClick={() => navigate(`/assistant/${selectedRoomAgent?.id}`)}
            >
              <ExternalLink className="size-3.5" />
              助手详情
            </button>
          )}
        </div>

        {/* 清空上下文 */}
        {canClearContext && selectedRoomAgent?.chatRoomAgentId && (
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors"
            onClick={() => setShowConfirm(true)}
          >
            <Trash2 className="size-3.5" />
            清空上下文
          </button>
        )}
      </div>

      {/* 确认对话框 */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-background rounded-xl shadow-xl p-4 max-w-sm w-full mx-4">
            <h4 className="text-base font-semibold text-foreground mb-2">确认清空上下文</h4>
            <p className="text-sm text-muted-foreground mb-4">
              确定要清空助手「{selectedRoomAgent?.name}」在本群的对话上下文吗？清空后助手将无法延续之前的对话。
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-lg transition-colors"
                onClick={() => setShowConfirm(false)}
                disabled={isClearing}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-sm bg-red-500 text-white hover:bg-red-600 rounded-lg transition-colors disabled:opacity-50"
                onClick={handleClearContext}
                disabled={isClearing}
              >
                {isClearing ? '清空中...' : '确认清空'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
