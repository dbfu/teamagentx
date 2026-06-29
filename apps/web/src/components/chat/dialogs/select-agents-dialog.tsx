import { Agent } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Loader2, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  title,
  loading = false,
}: SelectAgentsDialogProps) {
  const { t } = useTranslation()
  const dialogTitle = title || t('chat.selectAgentsDialogTitle')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

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
      setSearchQuery('')
    } else {
      // 关闭时清空选中状态
      setLocalSelectedIds(new Set())
      setSearchQuery('')
    }
  }, [open, agents, selectedAgentIds])

  const filteredAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return agents

    return agents.filter((agent) => {
      return [
        agent.name,
        agent.description,
        agent.category?.name,
      ].some((value) => value?.toLowerCase().includes(query))
    })
  }, [agents, searchQuery])

  // 对助手进行分组
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
          <AgentAvatarImage
            avatar={agent.avatar}
            agentId={agent.id}
            agentName={agent.name}
            agentLevel={agent.agentLevel}
            className="size-10"
          />
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl sm:max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="min-w-0 truncate text-lg font-semibold text-foreground">{dialogTitle}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Search */}
        {agents.length > 0 && (
          <div className="shrink-0 border-b border-border px-6 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('chat.searchAssistantPlaceholder')}
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {agents.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{t('assistant.noAssistants')}</div>
          ) : filteredAgents.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{t('chat.noMatchingAssistants')}</div>
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
                    <div className="grid grid-cols-3 gap-2 mt-1 sm:grid-cols-5 md:grid-cols-7">{category.agents.map(renderAgent)}</div>
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
                    <span>{t('assistant.uncategorized')}</span>
                    <span className="text-muted-foreground text-xs">({groupedAgents.uncategorized.length})</span>
                  </button>
                  {expandedCategories.has('__uncategorized__') && (
                    <div className="grid grid-cols-3 gap-2 mt-1 sm:grid-cols-5 md:grid-cols-7">{groupedAgents.uncategorized.map(renderAgent)}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
          <span className="text-sm text-muted-foreground">
            {t('chat.selectedAgentsCount', { count: localSelectedIds.size })}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || localSelectedIds.size === 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t('chat.confirmInstall')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
