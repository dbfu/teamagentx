import { Agent } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

interface SelectAgentsDialogProps {
  open: boolean
  onClose: () => void
  agents: Agent[]
  selectedAgentIds: string[]
  onConfirm: (agentIds: string[]) => Promise<void>
  title?: string
  loading?: boolean
}

export function SelectAgentsDialog({
  open,
  onClose,
  agents,
  selectedAgentIds,
  onConfirm,
  title = '选择助手',
  loading = false,
}: SelectAgentsDialogProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set())

  // 当对话框打开时，重置并展开所有分类
  useEffect(() => {
    if (open) {
      // 从当前 agents 计算所有分类 ID
      const categoryIds = new Set<string>()
      for (const agent of agents) {
        if (agent.categoryId) {
          categoryIds.add(agent.categoryId)
        }
      }
      categoryIds.add('__uncategorized__')
      setExpandedCategories(categoryIds)
      // 初始化已选中的助手
      setLocalSelectedIds(new Set(selectedAgentIds))
    } else {
      // 关闭时清空选中状态
      setLocalSelectedIds(new Set())
    }
  }, [open, agents, selectedAgentIds])

  // 对助手进行分组
  const groupedAgents = useMemo(() => {
    const categories = new Map<string, { id: string; name: string; agents: Agent[] }>()
    const uncategorized: Agent[] = []

    for (const agent of agents) {
      if (agent.categoryId && agent.category) {
        const existing = categories.get(agent.categoryId)
        if (existing) {
          existing.agents.push(agent)
        } else {
          categories.set(agent.categoryId, {
            id: agent.categoryId,
            name: agent.category.name,
            agents: [agent],
          })
        }
      } else {
        uncategorized.push(agent)
      }
    }

    return {
      categories: Array.from(categories.values()),
      uncategorized,
    }
  }, [agents])

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId)
      } else {
        newSet.add(categoryId)
      }
      return newSet
    })
  }

  const toggleAgent = (agentId: string) => {
    setLocalSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(agentId)) {
        newSet.delete(agentId)
      } else {
        newSet.add(agentId)
      }
      return newSet
    })
  }

  const handleConfirm = async () => {
    await onConfirm(Array.from(localSelectedIds))
  }

  const renderAgent = (agent: Agent) => {
    const isSelected = localSelectedIds.has(agent.id)

    return (
      <button
        key={agent.id}
        className="flex flex-col items-center gap-1.5 rounded-lg p-2 hover:bg-accent transition-colors relative"
        onClick={() => toggleAgent(agent.id)}
      >
        <div className="relative">
          <AgentAvatarImage avatar={agent.avatar} className="size-10" />
          {/* 选中标记 */}
          {isSelected && (
            <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-white">
              <Check className="size-3" />
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate w-14 text-center">{agent.name}</span>
      </button>
    )
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-96 shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-80 overflow-y-auto p-6 scrollbar-thin">
          {agents.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">暂无助手</div>
          ) : (
            <div className="space-y-3">
              {/* 分类助手 */}
              {groupedAgents.categories.map((category) => (
                <div key={category.id}>
                  <button
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className="w-full flex items-center gap-2 px-1 py-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    {expandedCategories.has(category.id) ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                    {expandedCategories.has(category.id) ? (
                      <FolderOpen className="size-4 text-primary" />
                    ) : (
                      <Folder className="size-4 text-muted-foreground" />
                    )}
                    <span>{category.name}</span>
                    <span className="text-muted-foreground text-xs">({category.agents.length})</span>
                  </button>
                  {expandedCategories.has(category.id) && (
                    <div className="grid grid-cols-5 gap-1 mt-1">{category.agents.map(renderAgent)}</div>
                  )}
                </div>
              ))}

              {/* 未分类助手 */}
              {groupedAgents.uncategorized.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => toggleCategory('__uncategorized__')}
                    className="w-full flex items-center gap-2 px-1 py-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    {expandedCategories.has('__uncategorized__') ? (
                      <ChevronDown className="size-4" />
                    ) : (
                      <ChevronRight className="size-4" />
                    )}
                    {expandedCategories.has('__uncategorized__') ? (
                      <FolderOpen className="size-4 text-primary" />
                    ) : (
                      <Folder className="size-4 text-muted-foreground" />
                    )}
                    <span>未分类</span>
                    <span className="text-muted-foreground text-xs">({groupedAgents.uncategorized.length})</span>
                  </button>
                  {expandedCategories.has('__uncategorized__') && (
                    <div className="grid grid-cols-5 gap-1 mt-1">{groupedAgents.uncategorized.map(renderAgent)}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <span className="text-sm text-muted-foreground">
            已选择 {localSelectedIds.size} 个助手
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || localSelectedIds.size === 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              确认安装
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
