import { Agent } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { Loader2, Folder, FolderOpen, ChevronDown, ChevronRight, X, Search, Check } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'

interface AddAgentDialogProps {
  open: boolean
  onClose: () => void
  availableAgents: Agent[]
  addingAgentIds: Set<string>
  onAddAgents: (agentIds: string[]) => Promise<void>
}

export function AddAgentDialog({
  open,
  onClose,
  availableAgents,
  addingAgentIds,
  onAddAgents,
}: AddAgentDialogProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const selectableAgents = useMemo(
    () => availableAgents.filter((agent) => agent.agentLevel !== 'system'),
    [availableAgents]
  )

  // 当对话框打开时，重置状态
  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setSelectedAgents(new Set())
      // 从当前 availableAgents 计算所有分类 ID
      const categoryIds = new Set<string>()
      for (const agent of selectableAgents) {
        if (agent.categoryId) {
          categoryIds.add(agent.categoryId)
        }
      }
      categoryIds.add('__uncategorized__')
      setExpandedCategories(categoryIds)
    }
  }, [open, selectableAgents])

  // 根据搜索词过滤助手
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return selectableAgents
    const query = searchQuery.toLowerCase()
    return selectableAgents.filter(agent =>
      agent.name.toLowerCase().includes(query) ||
      agent.description?.toLowerCase().includes(query)
    )
  }, [selectableAgents, searchQuery])

  // 对助手进行分组（基于过滤后的列表）
  const groupedAgents = useMemo(() => {
    const categories = new Map<string, { id: string; name: string; agents: Agent[] }>()
    const uncategorized: Agent[] = []

    for (const agent of filteredAgents) {
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
  }, [filteredAgents])

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

  // 选择/取消选择助手
  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(agentId)) {
        newSet.delete(agentId)
      } else {
        newSet.add(agentId)
      }
      return newSet
    })
  }

  // 批量添加助手
  const handleAddAgents = async () => {
    if (selectedAgents.size === 0) return

    setIsAdding(true)
    try {
      await onAddAgents(Array.from(selectedAgents))
      setSelectedAgents(new Set())
    } finally {
      setIsAdding(false)
    }
  }

  const renderAgent = (agent: Agent) => {
    const isSelected = selectedAgents.has(agent.id)
    const isAddingThis = addingAgentIds.has(agent.id)

    return (
      <button
        key={agent.id}
        className={`flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors ${
          isSelected
            ? 'bg-blue-500/20 ring-2 ring-blue-500'
            : 'hover:bg-accent'
        } ${isAddingThis || isAdding ? 'opacity-50' : ''}`}
        onClick={() => toggleAgent(agent.id)}
        disabled={isAddingThis || isAdding}
      >
        <div className="relative">
          <AgentAvatarImage avatar={agent.avatar} className="size-10" />
          {/* 选中指示器 */}
          {isSelected && !isAddingThis && (
            <div className="absolute -top-1 -right-1 size-5 rounded-full bg-blue-500 flex items-center justify-center">
              <Check className="size-3 text-white" />
            </div>
          )}
          {/* 加载指示器 */}
          {isAddingThis && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30">
              <Loader2 className="size-4 animate-spin text-white" />
            </div>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate w-full text-center">{agent.name}</span>
      </button>
    )
  }

  if (!open) return null

  return (
    <>
      {/* 选择助手弹框 */}
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
        <div className="w-[640px] shrink-0 rounded-2xl bg-card shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">
              添加助手
              {selectedAgents.size > 0 && (
                <span className="ml-2 text-sm text-muted-foreground">
                  (已选 {selectedAgents.size} 个)
                </span>
              )}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Search */}
          <div className="px-6 py-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索助手名称或描述..."
                className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Content */}
          <div className="max-h-[50vh] overflow-y-auto p-6 scrollbar-thin">
            {filteredAgents.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                {searchQuery.trim() ? '未找到匹配的助手' : '暂无可添加的助手'}
              </div>
            ) : searchQuery.trim() ? (
              /* 搜索模式：扁平化网格展示 */
              <div className="grid grid-cols-5 gap-2">
                {filteredAgents.map(renderAgent)}
              </div>
            ) : (
              /* 默认模式：分组展示 */
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

          {/* Footer - 确认按钮 */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <span className="text-sm text-muted-foreground">
              点击助手卡片可多选，默认注入群历史消息
            </span>
            <button
              onClick={handleAddAgents}
              disabled={selectedAgents.size === 0 || isAdding}
              className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAdding && <Loader2 className="size-4 animate-spin" />}
              <span>
                {isAdding ? '添加中...' : `添加 ${selectedAgents.size > 0 ? `(${selectedAgents.size})` : ''}`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
