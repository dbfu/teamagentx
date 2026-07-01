import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stringify } from 'yaml'
import {
  type DispatchRules,
  type DispatchRulesStep,
  isOneOfStep,
  isParallelStep,
} from '@/lib/dispatch-rules/schema'
import { cn } from '@/lib/utils'
import { FlowCanvas } from './dispatch-rules-builder-parts'
import { NodeInspector } from './dispatch-rules-node-inspector'
import {
  createId,
  orderWorkflowNodes,
  type BuilderBranch,
  type BuilderDraft,
  type BuilderNode,
  type BuilderWorkflow,
  type DispatchRulesBuilderAgent,
  type DispatchRulesBuilderProps,
} from './dispatch-rules-builder-model'

const WORKFLOW_NODE_CENTER_Y = 260
const WORKFLOW_NODE_START_X = 210
const WORKFLOW_NODE_SPACING = 340

function clean(value?: string) {
  const trimmed = (value ?? '').trim()
  return trimmed || undefined
}

function withCommon<T extends Record<string, unknown>>(base: T, source: Pick<BuilderBranch, 'task' | 'when' | 'on_pass' | 'on_fail'>) {
  return {
    ...base,
    task: source.task.trim(),
    ...(clean(source.when) ? { when: clean(source.when) } : {}),
    ...(clean(source.on_pass) ? { on_pass: clean(source.on_pass) } : {}),
    ...(clean(source.on_fail) ? { on_fail: clean(source.on_fail) } : {}),
  }
}

function mergeAgents(initialData: DispatchRules | undefined, roomAgents: DispatchRulesBuilderAgent[]) {
  const merged = new Map<string, DispatchRulesBuilderAgent>()
  for (const agent of initialData?.agents ?? []) {
    const name = agent.name.trim()
    if (name) merged.set(name, { name, role: agent.role.trim() || 'assistant' })
  }
  for (const agent of roomAgents) {
    const name = agent.name.trim()
    if (name && !merged.has(name)) merged.set(name, { name, role: agent.role.trim() || 'assistant' })
  }
  return [...merged.values()]
}

function toBuilderNode(step: DispatchRulesStep, index: number): BuilderNode {
  const position = { x: WORKFLOW_NODE_START_X + index * WORKFLOW_NODE_SPACING, y: WORKFLOW_NODE_CENTER_Y }
  if (isParallelStep(step)) {
    return {
      id: createId('parallel'),
      type: 'parallel',
      ...position,
      task: step.parallel[0]?.task ?? '',
      branches: step.parallel.map((branch) => ({
        id: createId('branch'),
        agent: branch.agent,
        task: branch.task,
        when: branch.when,
        on_pass: branch.on_pass,
        on_fail: branch.on_fail,
      })),
    }
  }

  if (isOneOfStep(step)) {
    return {
      id: createId('one-of'),
      type: 'oneOf',
      ...position,
      agents: step.oneOf,
      task: step.task,
      when: step.when,
      on_pass: step.on_pass,
      on_fail: step.on_fail,
    }
  }

  return {
    id: createId('agent'),
    type: 'agent',
    ...position,
    agent: step.agent,
    task: step.task,
    when: step.when,
    on_pass: step.on_pass,
    on_fail: step.on_fail,
  }
}

function createDraft(initialData: DispatchRules | undefined, roomAgents: DispatchRulesBuilderAgent[], defaultWorkflowName: string): BuilderDraft {
  const workflows = initialData?.workflows?.length
    ? initialData.workflows.map((workflow) => {
        const nodes = workflow.steps.map(toBuilderNode)
        return {
          id: createId('workflow'),
          name: workflow.name,
          nodes,
          edges: nodes.slice(0, -1).map((node, index) => ({
            id: createId('edge'),
            source: node.id,
            target: nodes[index + 1].id,
          })),
        }
      })
    : [{ id: createId('workflow'), name: defaultWorkflowName, nodes: [], edges: [] }]

  return {
    agents: mergeAgents(initialData, roomAgents),
    routing: (initialData?.routing ?? []).map((route) => ({
      id: createId('route'),
      when: route.when,
      workflow: route.workflow,
    })),
    workflows,
    constraintsText: (initialData?.constraints ?? []).join('\n'),
  }
}

function buildYaml(draft: BuilderDraft, defaultWorkflowName: string) {
  const workflows = draft.workflows
    .map((workflow, index) => ({
      name: workflow.name.trim() || (index === 0 ? defaultWorkflowName : `${defaultWorkflowName} ${index + 1}`),
      steps: orderWorkflowNodes(workflow).map((node) => {
        if (node.type === 'parallel') {
          return {
            parallel: node.branches.map((branch) => withCommon({ agent: branch.agent.trim() }, branch)),
          }
        }
        if (node.type === 'oneOf') {
          return withCommon({ oneOf: node.agents.map((name) => name.trim()).filter(Boolean) }, node)
        }
        return withCommon({ agent: node.agent.trim() }, node)
      }),
    }))
    .filter((workflow) => workflow.steps.length > 0)

  if (workflows.length === 0) return ''

  const workflowNames = new Set(workflows.map((workflow) => workflow.name))
  const routing = draft.routing
    .map((route) => ({ when: route.when.trim(), workflow: route.workflow.trim() }))
    .filter((route) => route.when && workflowNames.has(route.workflow))
  const constraints = draft.constraintsText.split('\n').map((line) => line.trim()).filter(Boolean)

  return stringify(
    {
      version: 1,
      agents: draft.agents.map((agent) => ({ name: agent.name.trim(), role: agent.role.trim() })),
      ...(routing.length > 0 ? { routing } : {}),
      workflows,
      ...(constraints.length > 0 ? { constraints } : {}),
    },
    { lineWidth: 0 },
  )
}

function layoutWorkflow(workflow: BuilderWorkflow): BuilderWorkflow {
  return {
    ...workflow,
    nodes: orderWorkflowNodes(workflow).map((node, index) => ({
      ...node,
      x: WORKFLOW_NODE_START_X + index * WORKFLOW_NODE_SPACING,
      y: WORKFLOW_NODE_CENTER_Y,
    })),
  }
}

export function DispatchRulesBuilder({
  initialData,
  resetKey,
  roomAgents,
  onYamlChange,
  isFullscreen,
  onToggleFullscreen,
}: DispatchRulesBuilderProps) {
  const { t } = useTranslation()
  const defaultTask = t('chat.dispatchRules.builderDefaultTask')
  const defaultWorkflowName = t('chat.dispatchRules.builderDefaultWorkflow')
  const initialDataRef = useRef(initialData)
  const roomAgentSignature = useMemo(() => roomAgents.map((agent) => `${agent.name}:${agent.role}`).join('|'), [roomAgents])
  const [draft, setDraft] = useState(() => createDraft(initialData, roomAgents, defaultWorkflowName))
  const [activeWorkflowId, setActiveWorkflowId] = useState(draft.workflows[0]?.id ?? '')
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>()
  const agentNames = draft.agents.map((agent) => agent.name)
  const agentsByName = useMemo(() => new Map(draft.agents.map((agent) => [agent.name, agent])), [draft.agents])
  const activeWorkflow = draft.workflows.find((workflow) => workflow.id === activeWorkflowId) ?? draft.workflows[0]
  const selectedNode = activeWorkflow?.nodes.find((node) => node.id === selectedNodeId)

  useEffect(() => {
    initialDataRef.current = initialData
  }, [initialData])

  useEffect(() => {
    const nextDraft = createDraft(initialDataRef.current, roomAgents, defaultWorkflowName)
    setDraft(nextDraft)
    setActiveWorkflowId(nextDraft.workflows[0]?.id ?? '')
    setSelectedNodeId(undefined)
  }, [resetKey, roomAgentSignature, roomAgents, defaultWorkflowName])

  useEffect(() => {
    onYamlChange(buildYaml(draft, defaultWorkflowName))
  }, [draft, defaultWorkflowName, onYamlChange])

  const updateActiveWorkflow = (updater: (workflow: BuilderWorkflow) => BuilderWorkflow) => {
    if (!activeWorkflow) return
    setDraft((current) => ({
      ...current,
      workflows: current.workflows.map((workflow) => workflow.id === activeWorkflow.id ? updater(workflow) : workflow),
    }))
  }

  const createNode = (type: BuilderNode['type'], position?: { x: number; y: number }, agentName?: string): BuilderNode => {
    const nextPosition = {
      x: position?.x ?? WORKFLOW_NODE_START_X + (activeWorkflow?.nodes.length ?? 0) * WORKFLOW_NODE_SPACING,
      y: WORKFLOW_NODE_CENTER_Y,
    }
    if (type === 'parallel') {
      return {
        id: createId('parallel'),
        type,
        ...nextPosition,
        task: defaultTask,
        branches: [],
      }
    }
    if (type === 'oneOf') {
      return { id: createId('one-of'), type, ...nextPosition, agents: agentNames.slice(0, 2), task: defaultTask }
    }
    return { id: createId('agent'), type, ...nextPosition, agent: agentName ?? agentNames[0] ?? '', task: defaultTask }
  }

  const addNode = (node: BuilderNode) => {
    updateActiveWorkflow((workflow) => {
      const previous = orderWorkflowNodes(workflow).at(-1)
      return {
        ...workflow,
        nodes: [...workflow.nodes, node],
        edges: previous ? [...workflow.edges, { id: createId('edge'), source: previous.id, target: node.id }] : workflow.edges,
      }
    })
    setSelectedNodeId(node.id)
  }

  const addWorkflow = () => {
    const workflow = { id: createId('workflow'), name: `${defaultWorkflowName} ${draft.workflows.length + 1}`, nodes: [] as BuilderNode[], edges: [] }
    setDraft((current) => ({ ...current, workflows: [...current.workflows, workflow] }))
    setActiveWorkflowId(workflow.id)
    setSelectedNodeId(undefined)
  }

  const removeWorkflow = (workflowId: string) => {
    setDraft((current) => {
      if (current.workflows.length <= 1) return current
      const workflows = current.workflows.filter((workflow) => workflow.id !== workflowId)
      if (activeWorkflowId === workflowId) setActiveWorkflowId(workflows[0]?.id ?? '')
      return { ...current, workflows }
    })
    setSelectedNodeId(undefined)
  }

  const connectNodes = (sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) {
      return
    }
    updateActiveWorkflow((workflow) => ({
      ...workflow,
      edges: [
        ...workflow.edges.filter((edge) => edge.source !== sourceId && edge.target !== targetId),
        { id: createId('edge'), source: sourceId, target: targetId },
      ],
    }))
  }

  const insertNodeBetween = (sourceId: string, targetId: string, data: { kind: BuilderNode['type']; agentName?: string }) => {
    const newNodeId = createId(data.kind === 'oneOf' ? 'one-of' : data.kind)
    updateActiveWorkflow((workflow) => {
      const sourceNode = workflow.nodes.find((node) => node.id === sourceId)
      const targetNode = workflow.nodes.find((node) => node.id === targetId)
      const nextPosition = {
        x: sourceNode && targetNode
          ? Math.round(((sourceNode.x + targetNode.x) / 2) / 10) * 10
          : sourceNode
            ? sourceNode.x + WORKFLOW_NODE_SPACING
            : targetNode
              ? Math.max(WORKFLOW_NODE_START_X, targetNode.x - WORKFLOW_NODE_SPACING)
              : WORKFLOW_NODE_START_X,
        y: WORKFLOW_NODE_CENTER_Y,
      }
      const insertedNode = {
        ...createNode(data.kind, nextPosition, data.agentName),
        id: newNodeId,
      }
      const nextEdges = workflow.edges.filter((edge) => !(edge.source === sourceId && edge.target === targetId))
      if (sourceNode) {
        nextEdges.push({ id: createId('edge'), source: sourceNode.id, target: insertedNode.id })
      }
      if (targetNode) {
        nextEdges.push({ id: createId('edge'), source: insertedNode.id, target: targetNode.id })
      }

      return layoutWorkflow({
        ...workflow,
        nodes: [...workflow.nodes, insertedNode],
        edges: nextEdges,
      })
    })
    setSelectedNodeId(newNodeId)
  }

  return (
    <div className="flex h-full min-h-[560px] min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-background">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-card px-3 py-2">
          {draft.workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => {
                setActiveWorkflowId(workflow.id)
                setSelectedNodeId(undefined)
              }}
              className={cn('rounded-lg px-3 py-1 text-xs font-medium transition-colors', workflow.id === activeWorkflow?.id ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground')}
            >
              {workflow.name || defaultWorkflowName}
            </button>
          ))}
          <button type="button" onClick={addWorkflow} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent">
            <Plus className="size-3.5" />
            {t('chat.dispatchRules.builderAddWorkflow')}
          </button>
          {activeWorkflow && draft.workflows.length > 1 && (
            <button type="button" onClick={() => removeWorkflow(activeWorkflow.id)} className="ml-auto rounded-lg border border-red-200 px-2 py-1 text-red-500 hover:bg-red-50">
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>

        {activeWorkflow && (
          <>
            <div className="min-h-0 min-w-0 flex flex-1">
              <FlowCanvas
                workflow={activeWorkflow}
                agents={draft.agents}
                agentsByName={agentsByName}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
                onMoveNode={(nodeId, position) => updateActiveWorkflow((workflow) => ({
                  ...workflow,
                  nodes: workflow.nodes.map((node) => node.id === nodeId ? { ...node, ...position } : node),
                }))}
                onDropNode={(data, position) => {
                  if (data.kind === 'agent') addNode(createNode('agent', position, data.agent))
                  if (data.kind === 'parallel') addNode(createNode('parallel', position))
                  if (data.kind === 'oneOf') addNode(createNode('oneOf', position))
                }}
                onConnectNodes={connectNodes}
                onInsertNodeBetween={insertNodeBetween}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                onAutoLayout={() => updateActiveWorkflow(layoutWorkflow)}
              />
              <NodeInspector
                node={selectedNode}
                agents={draft.agents}
                onChange={(updater) => updateActiveWorkflow((workflow) => ({
                  ...workflow,
                  nodes: workflow.nodes.map((node) => node.id === selectedNode?.id ? updater(node) : node),
                }))}
                onClose={() => setSelectedNodeId(undefined)}
                onDelete={() => {
                  updateActiveWorkflow((workflow) => layoutWorkflow({
                    ...workflow,
                    nodes: workflow.nodes.filter((node) => node.id !== selectedNode?.id),
                    edges: workflow.edges.filter((edge) => edge.source !== selectedNode?.id && edge.target !== selectedNode?.id),
                  }))
                  setSelectedNodeId(undefined)
                }}
              />
            </div>
          </>
        )}

      </section>
    </div>
  )
}
