import { cn } from '@/lib/utils'
import { Bot, Eye, History, Loader2, Trash2, ExternalLink, List, Brain, Save, RotateCcw, X } from 'lucide-react'
import type { AgentStatus } from '@/stores/socket-store'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '@/stores/chat-store'
import { chatRoomApi, agentApi } from '@/lib/agent-api'
import { toast } from 'sonner'
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
  const [isSavingHistoryAccess, setIsSavingHistoryAccess] = useState(false)

  // 群记忆弹窗相关状态
  const [memoryModalOpen, setMemoryModalOpen] = useState(false)
  const [memoryContent, setMemoryContent] = useState('')
  const [memoryOriginal, setMemoryOriginal] = useState('')
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memorySaving, setMemorySaving] = useState(false)

  const loadRoomMemory = useCallback(async () => {
    if (!selectedRoomAgent?.id) return
    setMemoryLoading(true)
    try {
      const res = await agentApi.getRoomMemory(selectedRoomAgent.id, chatRoomId)
      if (res.success && res.data) {
        setMemoryContent(res.data.content)
        setMemoryOriginal(res.data.content)
      }
    } catch {
      // ignore
    } finally {
      setMemoryLoading(false)
    }
  }, [selectedRoomAgent?.id, chatRoomId])

  useEffect(() => {
    if (memoryModalOpen) {
      loadRoomMemory()
    }
  }, [memoryModalOpen, loadRoomMemory])

  const saveRoomMemory = async () => {
    if (!selectedRoomAgent?.id) return
    setMemorySaving(true)
    try {
      const res = await agentApi.updateRoomMemory(selectedRoomAgent.id, chatRoomId, memoryContent)
      if (res.success) {
        setMemoryOriginal(memoryContent)
        toast.success('群记忆已保存')
      } else {
        toast.error(res.error || '保存失败')
      }
    } finally {
      setMemorySaving(false)
    }
  }

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
        toast.success(result.data.injectGroupHistory ? '已开启群历史访问' : '已关闭群历史访问')
      } else {
        toast.error(result.error || '保存失败')
      }
    } catch (error) {
      toast.error('保存群历史访问设置失败')
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

      {canConfigureHistoryAccess && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">群历史访问</div>
              <div className="mt-0.5 text-xs text-muted-foreground">注入消息索引并允许查询群消息</div>
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

        {/* 群记忆 */}
        {selectedRoomAgent?.id && (
          <button
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
            onClick={() => setMemoryModalOpen(true)}
          >
            <Brain className="size-4" />
            群记忆
          </button>
        )}

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

      {/* 群记忆弹窗 */}
      {memoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMemoryModalOpen(false)} />
          <div className="relative bg-background rounded-xl shadow-xl flex flex-col w-full max-w-lg mx-4" style={{ maxHeight: '80vh' }}>
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Brain className="size-4 text-primary" />
                <span className="font-semibold text-foreground">群记忆</span>
                <span className="text-xs text-muted-foreground">— {selectedRoomAgent?.name}</span>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setMemoryModalOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 min-h-0">
              <p className="text-xs text-muted-foreground">
                助手在本群的长期记忆，仅在当前群生效。助手可在对话中自动写入，也可在此手动编辑。
              </p>
              {memoryLoading ? (
                <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">加载中...</span>
                </div>
              ) : (
                <textarea
                  value={memoryContent}
                  onChange={(e) => setMemoryContent(e.target.value)}
                  placeholder="暂无群记忆，助手可在对话中写入..."
                  className="w-full flex-1 min-h-[240px] resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none bg-muted/30 placeholder:text-muted-foreground/50"
                />
              )}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent rounded-lg transition-colors border border-gray-200"
                onClick={() => setMemoryContent(memoryOriginal)}
                disabled={memoryLoading || memorySaving}
              >
                <RotateCcw className="size-3.5" />
                重置
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
                onClick={saveRoomMemory}
                disabled={memoryLoading || memorySaving}
              >
                {memorySaving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
