import type { DispatchRules } from '@/lib/dispatch-rules/schema'

let idSeed = 0

export interface DispatchRulesBuilderAgent {
  name: string
  role: string
  avatar?: string | null
  avatarColor?: string | null
  agentLevel?: string | null
}

export interface DispatchRulesBuilderProps {
  initialData?: DispatchRules
  resetKey: number
  roomAgents: DispatchRulesBuilderAgent[]
  onYamlChange: (yamlText: string) => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

export interface BuilderRouting {
  id: string
  when: string
  workflow: string
}

export interface BuilderBranch {
  id: string
  agent: string
  task: string
  when?: string
  on_pass?: string
  on_fail?: string
}

interface BuilderNodeBase {
  id: string
  x: number
  y: number
  task: string
  when?: string
  on_pass?: string
  on_fail?: string
}

export type BuilderNode =
  | (BuilderNodeBase & { type: 'agent'; agent: string })
  | (BuilderNodeBase & { type: 'parallel'; branches: BuilderBranch[] })
  | (BuilderNodeBase & { type: 'oneOf'; agents: string[] })

export interface BuilderWorkflow {
  id: string
  name: string
  nodes: BuilderNode[]
  edges: BuilderEdge[]
}

export interface BuilderEdge {
  id: string
  source: string
  target: string
}

export interface BuilderDraft {
  agents: DispatchRulesBuilderAgent[]
  routing: BuilderRouting[]
  workflows: BuilderWorkflow[]
  constraintsText: string
}

export function createId(prefix: string) {
  idSeed += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeed}`
}

export function sortWorkflowNodes(nodes: BuilderNode[]) {
  return [...nodes].sort((a, b) => {
    const xDiff = a.x - b.x
    if (Math.abs(xDiff) > 40) return xDiff
    return a.y - b.y
  })
}

export function orderWorkflowNodes(workflow: BuilderWorkflow) {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]))
  const incoming = new Set(workflow.edges.map((edge) => edge.target))
  const outgoing = new Map<string, string[]>()
  for (const edge of workflow.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
  }

  const ordered: BuilderNode[] = []
  const visited = new Set<string>()
  const starts = sortWorkflowNodes(workflow.nodes.filter((node) => !incoming.has(node.id)))

  for (const start of starts) {
    let current: BuilderNode | undefined = start
    while (current && !visited.has(current.id)) {
      ordered.push(current)
      visited.add(current.id)
      const nextId: string | undefined = outgoing.get(current.id)?.find((id) => !visited.has(id))
      current = nextId ? nodesById.get(nextId) : undefined
    }
  }

  for (const node of sortWorkflowNodes(workflow.nodes)) {
    if (!visited.has(node.id)) ordered.push(node)
  }
  return ordered
}
