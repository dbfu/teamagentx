import { Agent } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { SharedSkill } from '@/lib/skill-api'
import { RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SkillInstalledAgentsModalProps {
  skill: SharedSkill | null
  agents: Agent[]
  unlinkingInstallKey: string | null
  onClose: () => void
  onRequestUnlink: (skill: SharedSkill, agent: Agent) => void
}

export function SkillInstalledAgentsModal({
  skill,
  agents,
  unlinkingInstallKey,
  onClose,
  onRequestUnlink,
}: SkillInstalledAgentsModalProps) {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    setSearchQuery('')
  }, [skill?.slug])

  const installedAgents = useMemo(() => {
    if (!skill) return []
    return skill.installedAgents.map((name) => ({
      name,
      agent: agents.find((agent) => agent.name === name),
    }))
  }, [agents, skill])

  const filteredAgents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return installedAgents

    return installedAgents.filter(({ name, agent }) => (
      name.toLowerCase().includes(query)
      || agent?.description?.toLowerCase().includes(query)
      || agent?.category?.name.toLowerCase().includes(query)
    ))
  }, [installedAgents, searchQuery])

  if (!skill) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-foreground">
              {skill.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('skill.installedTo')} · {installedAgents.length} {t('skill.agentCount')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ta-icon-button shrink-0"
            title={t('common.close')}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border px-6 py-4">
          <div className="ta-search-shell">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('chat.searchAssistantPlaceholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                title={t('common.clear')}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Search className="mb-2 size-10" />
              <p className="text-sm">{t('chat.noMatchingAssistants')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {filteredAgents.map(({ name, agent }) => {
                const installKey = agent ? `${skill.slug}:${agent.id}` : null
                const isUnlinking = installKey === unlinkingInstallKey

                return (
                  <div
                    key={name}
                    className="group relative flex min-w-0 items-center gap-3 rounded-lg border border-border bg-[var(--surface-raised)] p-3 transition-colors hover:border-blue-500/40 hover:bg-blue-500/5"
                  >
                    <AgentAvatarImage
                      avatar={agent?.avatar ?? null}
                      agentId={agent?.id}
                      agentName={agent?.name ?? name}
                      agentLevel={agent?.agentLevel}
                      className="size-10 shrink-0"
                    />
                    <div className="min-w-0 flex-1 pr-6">
                      <div className="truncate text-sm font-medium text-foreground">
                        {name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {agent?.category?.name || t('assistant.uncategorized')}
                      </div>
                    </div>
                    {agent && (
                      <button
                        type="button"
                        onClick={() => onRequestUnlink(skill, agent)}
                        disabled={isUnlinking}
                        className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 group-hover:opacity-100"
                        title={t('skill.removeFromAgent')}
                      >
                        {isUnlinking ? (
                          <RefreshCw className="size-3.5 animate-spin" />
                        ) : (
                          <X className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
