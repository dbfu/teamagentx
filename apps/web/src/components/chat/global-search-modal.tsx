import { Agent, ChatRoom, agentApi } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { LlmProvider, llmProviderApi } from '@/lib/llm-provider-api'
import { SharedSkill, skillApi } from '@/lib/skill-api'
import { cn } from '@/lib/utils'
import { Bot, Cpu, Loader2, Package, Search, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

interface GlobalSearchModalProps {
  open: boolean
  onClose: () => void
  chatRooms: ChatRoom[]
}

type SearchTab = 'rooms' | 'agents' | 'skills' | 'models'

const tabs: Array<{ key: SearchTab; labelKey: string }> = [
  { key: 'rooms', labelKey: 'globalSearch.chatRooms' },
  { key: 'agents', labelKey: 'globalSearch.agents' },
  { key: 'skills', labelKey: 'globalSearch.skills' },
  { key: 'models', labelKey: 'globalSearch.models' },
]

function normalizeText(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function matchesQuery(query: string, values: Array<string | null | undefined>) {
  const normalizedQuery = normalizeText(query)
  if (!normalizedQuery) return true
  return values.some((value) => normalizeText(value).includes(normalizedQuery))
}

function resultLimit<T>(items: T[], query: string, limit = 24) {
  return query.trim() ? items.slice(0, limit) : items.slice(0, 10)
}

export function GlobalSearchModal({ open, onClose, chatRooms }: GlobalSearchModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<SearchTab>('rooms')
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<SharedSkill[]>([])
  const [models, setModels] = useState<LlmProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('teamagentx.globalSearch.recentQueries') || '[]')
    } catch {
      return []
    }
  })

  const roomResults = useMemo(() => {
    const filtered = chatRooms.filter((room) => (
      matchesQuery(query, [room.name, room.description, room.lastMessage?.content])
    ))
    return resultLimit(filtered, query)
  }, [chatRooms, query])

  const agentResults = useMemo(() => {
    const filtered = agents.filter((agent) => (
      matchesQuery(query, [
        agent.name,
        agent.description,
        agent.type,
        agent.acpTool,
        agent.category?.name,
        agent.llmProvider?.name,
        agent.llmProvider?.model,
      ])
    ))
    return resultLimit(filtered, query)
  }, [agents, query])

  const skillResults = useMemo(() => {
    const filtered = skills.filter((skill) => (
      matchesQuery(query, [skill.name, skill.slug, skill.description, skill.source])
    ))
    return resultLimit(filtered, query)
  }, [query, skills])

  const modelResults = useMemo(() => {
    const filtered = models.filter((model) => (
      matchesQuery(query, [
        model.name,
        model.model,
        model.modelType,
        model.apiProtocol,
        model.apiUrl,
        model.imageProvider,
      ])
    ))
    return resultLimit(filtered, query)
  }, [models, query])

  const activeCount = {
    rooms: roomResults.length,
    agents: agentResults.length,
    skills: skillResults.length,
    models: modelResults.length,
  }[activeTab]

  useEffect(() => {
    if (!open) return
    setActiveTab('rooms')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, open])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    Promise.all([
      agentApi.getAll(),
      skillApi.getShared(),
      llmProviderApi.getAll(),
    ])
      .then(([agentsResponse, skillsResponse, modelsResponse]) => {
        if (cancelled) return
        setAgents(agentsResponse.success ? agentsResponse.data ?? [] : [])
        setSkills(skillsResponse.success ? skillsResponse.data ?? [] : [])
        setModels(modelsResponse.success ? modelsResponse.data ?? [] : [])
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t('globalSearch.searchFailed'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, t])

  if (!open) return null

  const saveRecentQuery = (value: string) => {
    const normalized = value.trim()
    if (!normalized) return
    const nextQueries = [normalized, ...recentQueries.filter((item) => item !== normalized)].slice(0, 10)
    setRecentQueries(nextQueries)
    localStorage.setItem('teamagentx.globalSearch.recentQueries', JSON.stringify(nextQueries))
  }

  const closeAfterNavigate = () => {
    saveRecentQuery(query)
    onClose()
  }

  const openRoom = (roomId: string) => {
    navigate(`/?room=${roomId}`)
    closeAfterNavigate()
  }

  const openAgent = (agentId: string) => {
    navigate(`/assistant/${agentId}`)
    closeAfterNavigate()
  }

  const openSkill = (name: string) => {
    const params = new URLSearchParams({ search: name })
    navigate(`/skill?${params.toString()}`)
    closeAfterNavigate()
  }

  const openModel = (name: string) => {
    const params = new URLSearchParams({ search: name })
    navigate(`/model?${params.toString()}`)
    closeAfterNavigate()
  }

  const clearRecentQueries = () => {
    setRecentQueries([])
    localStorage.removeItem('teamagentx.globalSearch.recentQueries')
  }

  const isEmpty = query.trim().length > 0 && !loading && activeCount === 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[7vh]" onMouseDown={onClose}>
      <div
        className="flex h-[min(760px,86vh)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('globalSearch.placeholder')}
            className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
          {query && (
            <button
              onClick={() => setQuery('')}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              title={t('common.clear')}
            >
              <X className="size-4" />
            </button>
          )}
          <button
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            title={t('common.close')}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm transition-colors',
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div className="scrollbar-hover flex-1 overflow-y-auto px-5 py-4">
          {query.trim().length === 0 && recentQueries.length > 0 && (
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-muted-foreground">{t('globalSearch.history')}</h3>
                <button
                  onClick={clearRecentQueries}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Trash2 className="size-3.5" />
                  {t('common.clear')}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentQueries.map((item) => (
                  <button
                    key={item}
                    onClick={() => setQuery(item)}
                    className="rounded-full bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'rooms' && (
            <SearchSection
              title={t('globalSearch.chatRooms')}
              empty={isEmpty}
              emptyText={t('globalSearch.noChatRoomResults')}
            >
              {roomResults.map((room) => (
                <button
                  key={room.id}
                  onClick={() => openRoom(room.id)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                >
                  {room.isQuickChatRoom ? (
                    <AgentAvatarImage avatar={room.avatar ?? null} className="size-10 rounded-full" />
                  ) : (
                    <GroupAvatarImage avatar={room.avatar ?? null} className="size-10 rounded-full" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{room.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {room.description || room.lastMessage?.content || t('chat.noMessages')}
                    </div>
                  </div>
                  <Users className="size-4 text-muted-foreground" />
                </button>
              ))}
            </SearchSection>
          )}

          {activeTab === 'agents' && (
            <SearchSection
              title={t('globalSearch.agents')}
              empty={isEmpty}
              emptyText={t('globalSearch.noAgentResults')}
            >
              {agentResults.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => openAgent(agent.id)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                >
                  <AgentAvatarImage avatar={agent.avatar ?? null} className="size-10 rounded-full" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{agent.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {agent.description || agent.llmProvider?.name || agent.acpTool || t('assistant.noDescription')}
                    </div>
                  </div>
                  <Bot className="size-4 text-muted-foreground" />
                </button>
              ))}
            </SearchSection>
          )}

          {activeTab === 'skills' && (
            <SearchSection
              title={t('globalSearch.skills')}
              empty={isEmpty}
              emptyText={t('globalSearch.noSkillResults')}
            >
              {skillResults.map((skill) => (
                <button
                  key={skill.slug}
                  onClick={() => openSkill(skill.name || skill.slug)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600">
                    <Package className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{skill.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {skill.description || skill.slug}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {skill.installedAgents.length}
                  </span>
                </button>
              ))}
            </SearchSection>
          )}

          {activeTab === 'models' && (
            <SearchSection
              title={t('globalSearch.models')}
              empty={isEmpty}
              emptyText={t('globalSearch.noModelResults')}
            >
              {modelResults.map((model) => (
                <button
                  key={model.id}
                  onClick={() => openModel(model.name || model.model)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Cpu className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{model.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {model.model} · {model.modelType || 'text'} · {model.apiProtocol}
                    </div>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-xs',
                    model.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
                  )}>
                    {model.isActive ? t('common.active') : t('common.inactive')}
                  </span>
                </button>
              ))}
            </SearchSection>
          )}
        </div>

        <div className="flex justify-end gap-5 border-t border-border px-5 py-2 text-xs text-muted-foreground">
          <span>{t('globalSearch.shortcutExit')}</span>
        </div>
      </div>
    </div>
  )
}

function SearchSection({
  title,
  empty,
  emptyText,
  children,
}: {
  title: string
  empty: boolean
  emptyText: string
  children: ReactNode
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h3>
      {empty ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </section>
  )
}
