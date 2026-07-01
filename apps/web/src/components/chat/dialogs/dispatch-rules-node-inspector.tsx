import { Plus, Trash2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { cn } from '@/lib/utils'
import {
  createId,
  type BuilderBranch,
  type BuilderNode,
  type DispatchRulesBuilderAgent,
} from './dispatch-rules-builder-model'

export function NodeInspector({
  node,
  agents,
  onChange,
  onClose,
  onDelete,
}: {
  node?: BuilderNode
  agents: DispatchRulesBuilderAgent[]
  onChange: (updater: (node: BuilderNode) => BuilderNode) => void
  onClose: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  if (!node) {
    return null
  }

  const updateCommon = (patch: Partial<BuilderBranch>) => onChange((current) => ({ ...current, ...patch } as BuilderNode))
  const nodeTypeLabel = node.type === 'agent'
    ? '助手'
    : node.type === 'parallel'
      ? t('chat.dispatchRules.builderParallelStep')
      : t('chat.dispatchRules.builderOneOfStep')

  return (
    <aside className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{t('chat.dispatchRules.builderInspector')}</div>
          <div className="text-xs text-muted-foreground">{nodeTypeLabel}</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onDelete} aria-label="删除节点" className="rounded-md p-1.5 text-red-500 hover:bg-red-50">
            <Trash2 className="size-4" />
          </button>
          <button type="button" onClick={onClose} aria-label="关闭节点配置" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        {node.type === 'agent' && (
          <AgentSelect value={node.agent} agents={agents} onChange={(agent) => updateCommon({ agent })} />
        )}
        {node.type === 'oneOf' && (
          <AgentMultiSelect
            value={node.agents}
            agents={agents}
            onChange={(agents) => onChange((current) => current.type === 'oneOf' ? { ...current, agents } : current)}
          />
        )}
        {node.type === 'parallel' && (
          <ParallelBranches
            branches={node.branches}
            agents={agents}
            onChange={(branches) => onChange((current) => current.type === 'parallel' ? { ...current, branches } : current)}
          />
        )}
        {node.type !== 'parallel' && <CommonFields value={node} onChange={updateCommon} />}
      </div>
    </aside>
  )
}

function AgentSelect({ value, agents, onChange }: { value: string; agents: DispatchRulesBuilderAgent[]; onChange: (agent: string) => void }) {
  const { t } = useTranslation()
  const selectedAgent = agents.find((agent) => agent.name === value)
  const hasValue = Boolean(value.trim())
  const hasSelectedOption = Boolean(selectedAgent)
  const selectValue = hasValue ? value : '__none__'

  return (
    <Select value={selectValue} onValueChange={(nextValue) => nextValue !== '__none__' && onChange(nextValue)}>
      <SelectTrigger className="h-9 w-full rounded-lg border-border bg-background px-2 text-sm">
        {hasSelectedOption ? (
          <AgentSelectDisplay agent={selectedAgent!} showRole={false} />
        ) : hasValue ? (
          <span className="min-w-0 flex-1 truncate text-left text-foreground">{value}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{t('assistant.selectAgent')}</span>
        )}
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {!hasValue && agents.length === 0 && (
          <SelectItem value="__none__" disabled>{t('chat.dispatchRules.builderNoAgents')}</SelectItem>
        )}
        {hasValue && !hasSelectedOption && (
          <SelectItem value={value}>
            <span className="min-w-0 flex-1 truncate">{value}</span>
          </SelectItem>
        )}
        {agents.map((agent) => (
          <SelectItem key={agent.name} value={agent.name} className="py-2">
            <AgentSelectDisplay agent={agent} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AgentSelectDisplay({ agent, showRole = true }: { agent: DispatchRulesBuilderAgent; showRole?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
      <AgentAvatarImage
        avatar={agent.avatar ?? null}
        agentName={agent.name}
        agentLevel={agent.agentLevel}
        className="size-5"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{agent.name}</span>
        {showRole && agent.role && <span className="block truncate text-[11px] leading-3 text-muted-foreground">{agent.role}</span>}
      </span>
    </span>
  )
}

function AgentMultiSelect({ value, agents, onChange }: { value: string[]; agents: DispatchRulesBuilderAgent[]; onChange: (agents: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {agents.map((agent) => {
        const active = value.includes(agent.name)
        return (
          <button
            key={agent.name}
            type="button"
            onClick={() => onChange(active ? value.filter((item) => item !== agent.name) : [...value, agent.name])}
            className={cn(
              'inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-xs',
              active ? 'border-blue-200 bg-blue-50 text-blue-600' : 'border-border text-muted-foreground hover:bg-accent',
            )}
          >
            <AgentAvatarImage
              avatar={agent.avatar ?? null}
              agentName={agent.name}
              agentLevel={agent.agentLevel}
              className="size-4"
            />
            <span className="max-w-32 truncate">{agent.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function ParallelBranches({
  branches,
  agents,
  onChange,
}: {
  branches: BuilderBranch[]
  agents: DispatchRulesBuilderAgent[]
  onChange: (branches: BuilderBranch[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('chat.dispatchRules.builderBranches')}</span>
        <button
          type="button"
          onClick={() => onChange([...branches, { id: createId('branch'), agent: agents[0]?.name ?? '', task: t('chat.dispatchRules.builderDefaultTask') }])}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Plus className="size-3" />
          {t('chat.dispatchRules.builderAddBranch')}
        </button>
      </div>
      {branches.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {t('chat.dispatchRules.builderAddBranch')}
        </div>
      )}
      {branches.map((branch) => (
        <div key={branch.id} className="space-y-2 rounded-lg border border-border bg-muted/30 p-2">
          <div className="flex items-center gap-2">
            <AgentSelect
              value={branch.agent}
              agents={agents}
              onChange={(agent) => onChange(branches.map((item) => item.id === branch.id ? { ...item, agent } : item))}
            />
            <button
              type="button"
              onClick={() => onChange(branches.filter((item) => item.id !== branch.id))}
              className="rounded-md p-1 text-red-500 hover:bg-red-50"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <textarea
            value={branch.task}
            onChange={(event) => onChange(branches.map((item) => item.id === branch.id ? { ...item, task: event.target.value } : item))}
            placeholder={t('chat.dispatchRules.builderTaskPlaceholder')}
            className="h-16 w-full resize-none rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <input
            value={branch.when ?? ''}
            onChange={(event) => onChange(branches.map((item) => item.id === branch.id ? { ...item, when: event.target.value } : item))}
            placeholder={t('chat.dispatchRules.builderWhenPlaceholder')}
            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <input
            value={branch.on_pass ?? ''}
            onChange={(event) => onChange(branches.map((item) => item.id === branch.id ? { ...item, on_pass: event.target.value } : item))}
            placeholder={t('chat.dispatchRules.builderOnPassPlaceholder')}
            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <input
            value={branch.on_fail ?? ''}
            onChange={(event) => onChange(branches.map((item) => item.id === branch.id ? { ...item, on_fail: event.target.value } : item))}
            placeholder={t('chat.dispatchRules.builderOnFailPlaceholder')}
            className="h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      ))}
    </div>
  )
}

function CommonFields({
  value,
  onChange,
}: {
  value: Pick<BuilderBranch, 'task' | 'when' | 'on_pass' | 'on_fail'>
  onChange: (patch: Partial<BuilderBranch>) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <textarea
        value={value.task}
        onChange={(event) => onChange({ task: event.target.value })}
        placeholder={t('chat.dispatchRules.builderTaskPlaceholder')}
        className="h-24 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <input
        value={value.when ?? ''}
        onChange={(event) => onChange({ when: event.target.value })}
        placeholder={t('chat.dispatchRules.builderWhenPlaceholder')}
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <input
        value={value.on_pass ?? ''}
        onChange={(event) => onChange({ on_pass: event.target.value })}
        placeholder={t('chat.dispatchRules.builderOnPassPlaceholder')}
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
      <input
        value={value.on_fail ?? ''}
        onChange={(event) => onChange({ on_fail: event.target.value })}
        placeholder={t('chat.dispatchRules.builderOnFailPlaceholder')}
        className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </div>
  )
}
