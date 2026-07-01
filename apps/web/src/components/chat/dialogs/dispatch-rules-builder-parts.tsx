import { Bot, CheckCircle2, GitBranch, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Plus, RefreshCcw, Wand2, XCircle } from 'lucide-react'
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area'
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeOrigin,
  type NodeProps,
} from '@xyflow/react'
import { memo, useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import '@xyflow/react/dist/style.css'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { cn } from '@/lib/utils'
import {
  orderWorkflowNodes,
  type BuilderNode,
  type BuilderWorkflow,
  type DispatchRulesBuilderAgent,
} from './dispatch-rules-builder-model'

type NodeDropData =
  | { kind: 'agent'; agent: string }
  | { kind: 'parallel' }
  | { kind: 'oneOf' }

type DispatchNodeData = Record<string, unknown> & {
  node: BuilderNode
  index: number
  agent?: DispatchRulesBuilderAgent
  branchAgents?: DispatchRulesBuilderAgent[]
}

type FixedNodeData = Record<string, unknown> & {
  label: string
  tone: 'start' | 'end'
}

type DispatchFlowNode = Node<DispatchNodeData, 'dispatchNode'>
type FixedFlowNode = Node<FixedNodeData, 'fixedNode'>
type CanvasNode = DispatchFlowNode | FixedFlowNode

type InsertAgentEdgeData = Record<string, unknown> & {
  agents: DispatchRulesBuilderAgent[]
  onInsertNode: (sourceId: string, targetId: string, data: { kind: BuilderNode['type']; agentName?: string }) => void
}

type InsertAgentEdge = Edge<InsertAgentEdgeData, 'insertAgent'>
type CanvasEdge = Edge | InsertAgentEdge

const VIRTUAL_START_ID = '__dispatch-start'
const VIRTUAL_END_ID = '__dispatch-end'
const FLOW_SNAP_GRID: [number, number] = [10, 10]
const FLOW_NODE_CENTER_Y = 260
const FLOW_NODE_ORIGIN: NodeOrigin = [0, 0.5]
const FLOW_END_PADDING_X = 360

export function NodePalette({
  agents,
  collapsed,
  onToggleCollapsed,
  onAddAgent,
  onAddParallel,
  onAddOneOf,
}: {
  agents: DispatchRulesBuilderAgent[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onAddAgent: (agentName: string) => void
  onAddParallel: () => void
  onAddOneOf: () => void
}) {
  const { t } = useTranslation()
  const startDrag = (event: DragEvent, data: NodeDropData) => {
    event.dataTransfer.setData('application/teamagentx-dispatch-node', JSON.stringify(data))
    event.dataTransfer.effectAllowed = 'copy'
  }

  if (collapsed) {
    return (
      <aside className="flex min-h-0 w-12 shrink-0 flex-col items-center border-r border-border bg-muted/30 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('chat.dispatchRules.builderExpandNodeLibrary')}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex min-h-0 w-64 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{t('chat.dispatchRules.builderNodeLibrary')}</div>
          <div className="text-xs text-muted-foreground">{t('chat.dispatchRules.builderNodeLibraryHint')}</div>
        </div>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={t('chat.dispatchRules.builderCollapseNodeLibrary')}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <PaletteScrollArea>
        <div className="space-y-3 p-3">
          <div className="space-y-2">
            <PaletteButton
              icon={<RefreshCcw className="size-4 text-amber-600" />}
              title={t('chat.dispatchRules.builderParallelStep')}
              description={t('chat.dispatchRules.builderParallelHint')}
              onClick={onAddParallel}
              onDragStart={(event) => startDrag(event, { kind: 'parallel' })}
            />
            <PaletteButton
              icon={<GitBranch className="size-4 text-violet-600" />}
              title={t('chat.dispatchRules.builderOneOfStep')}
              description={t('chat.dispatchRules.builderOneOfHint')}
              onClick={onAddOneOf}
              onDragStart={(event) => startDrag(event, { kind: 'oneOf' })}
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">{t('chat.dispatchRules.builderAgents')}</div>
            <div className="space-y-2">
              {agents.length > 0 ? agents.map((agent) => (
                <PaletteButton
                  key={agent.name}
                  icon={<AgentAvatarImage avatar={agent.avatar ?? null} agentName={agent.name} agentLevel={agent.agentLevel} className="size-8" />}
                  title={agent.name}
                  description={agent.role}
                  compact
                  onClick={() => onAddAgent(agent.name)}
                  onDragStart={(event) => startDrag(event, { kind: 'agent', agent: agent.name })}
                />
              )) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('chat.dispatchRules.builderNoAgents')}
                </div>
              )}
            </div>
          </div>
        </div>
      </PaletteScrollArea>
    </aside>
  )
}

function PaletteScrollArea({ children }: { children: ReactNode }) {
  return (
    <ScrollAreaPrimitive.Root type="hover" className="relative min-h-0 flex-1 overflow-hidden">
      <ScrollAreaPrimitive.Viewport className="h-full w-full [&>div]:!block">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        orientation="vertical"
        className="absolute right-0 top-0 z-10 flex h-full w-1.5 touch-none select-none p-px transition-opacity data-[state=hidden]:opacity-0 data-[state=visible]:opacity-100"
      >
        <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border/80" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function PaletteButton({
  icon,
  title,
  description,
  compact = false,
  onClick,
  onDragStart,
}: {
  icon: ReactNode
  title: string
  description: string
  compact?: boolean
  onClick: () => void
  onDragStart: (event: DragEvent) => void
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'flex w-full cursor-grab items-start rounded-lg border border-border bg-background py-2 text-left shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/50 active:cursor-grabbing',
        compact ? 'gap-2 px-2.5' : 'gap-1.5 px-3',
      )}
    >
      <span className="flex self-stretch items-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

interface FlowCanvasProps {
  workflow: BuilderWorkflow
  agents: DispatchRulesBuilderAgent[]
  agentsByName: Map<string, DispatchRulesBuilderAgent>
  selectedNodeId?: string
  onSelectNode: (nodeId: string | undefined) => void
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void
  onDropNode: (data: NodeDropData, position: { x: number; y: number }) => void
  onAutoLayout: () => void
  onConnectNodes: (sourceId: string, targetId: string) => void
  onInsertNodeBetween: (sourceId: string, targetId: string, data: { kind: BuilderNode['type']; agentName?: string }) => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function FlowCanvasInner({
  workflow,
  agents,
  agentsByName,
  selectedNodeId,
  onSelectNode,
  onMoveNode,
  onDropNode,
  onAutoLayout,
  onConnectNodes,
  onInsertNodeBetween,
  isFullscreen,
  onToggleFullscreen,
}: FlowCanvasProps) {
  const { t } = useTranslation()
  const { screenToFlowPosition } = useReactFlow()
  const orderedNodes = useMemo(() => orderWorkflowNodes(workflow), [workflow])
  const endX = Math.max(420, ...orderedNodes.map((node) => node.x + FLOW_END_PADDING_X))
  const incoming = useMemo(() => new Set(workflow.edges.map((edge) => edge.target)), [workflow.edges])
  const outgoing = useMemo(() => new Set(workflow.edges.map((edge) => edge.source)), [workflow.edges])

  const nodes = useMemo<CanvasNode[]>(() => [
    {
      id: VIRTUAL_START_ID,
      type: 'fixedNode',
      position: { x: 42, y: FLOW_NODE_CENTER_Y },
      data: { label: t('chat.dispatchRules.builderStart'), tone: 'start' },
      draggable: false,
      selectable: false,
    },
    ...orderedNodes.map((node, index): DispatchFlowNode => ({
      id: node.id,
      type: 'dispatchNode',
      position: { x: node.x, y: node.y },
      draggable: false,
      data: {
        node,
        index,
        agent: node.type === 'agent' ? agentsByName.get(node.agent) : undefined,
        branchAgents: node.type === 'parallel'
          ? node.branches
              .map((branch) => agentsByName.get(branch.agent))
              .filter((agent): agent is DispatchRulesBuilderAgent => Boolean(agent))
          : undefined,
      },
      selected: selectedNodeId === node.id,
    })),
    {
      id: VIRTUAL_END_ID,
      type: 'fixedNode',
      position: { x: endX, y: FLOW_NODE_CENTER_Y },
      data: { label: t('chat.dispatchRules.builderEnd'), tone: 'end' },
      draggable: false,
      selectable: false,
    },
  ], [agentsByName, endX, orderedNodes, selectedNodeId, t])
  const [flowNodes, setFlowNodes] = useState<CanvasNode[]>(nodes)

  useEffect(() => {
    setFlowNodes(nodes)
  }, [nodes])

  const edges = useMemo<CanvasEdge[]>(() => {
    const startTargets = orderedNodes.filter((node) => !incoming.has(node.id))
    const terminalNodes = orderedNodes.filter((node) => !outgoing.has(node.id))
    const baseEdge = {
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'rgb(148 163 184)', strokeWidth: 2 },
    }
    const insertEdgeData = {
      agents,
      onInsertNode: onInsertNodeBetween,
    }

    return [
      ...(orderedNodes.length === 0 ? [{
        id: 'start-end',
        source: VIRTUAL_START_ID,
        target: VIRTUAL_END_ID,
        ...baseEdge,
        type: 'insertAgent',
        data: insertEdgeData,
      }] : []),
      ...startTargets.map((node) => ({
        id: `start-${node.id}`,
        source: VIRTUAL_START_ID,
        target: node.id,
        ...baseEdge,
        type: 'insertAgent',
        data: insertEdgeData,
      })),
      ...workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...baseEdge,
        type: 'insertAgent',
        data: insertEdgeData,
      })),
      ...terminalNodes.map((node) => ({
        id: `end-${node.id}`,
        source: node.id,
        target: VIRTUAL_END_ID,
        ...baseEdge,
        type: 'insertAgent',
        data: insertEdgeData,
      })),
    ]
  }, [agents, incoming, onInsertNodeBetween, orderedNodes, outgoing, workflow.edges])

  const handleNodesChange = (changes: NodeChange[]) => {
    setFlowNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as CanvasNode[])
  }

  const commitNodePosition = (node: CanvasNode) => {
    if (isVirtualNodeId(node.id)) return
    onMoveNode(node.id, {
      x: Math.max(140, Math.round(node.position.x / 10) * 10),
      y: FLOW_NODE_CENTER_Y,
    })
  }

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return
    if (isVirtualNodeId(connection.source) || isVirtualNodeId(connection.target)) return
    onConnectNodes(connection.source, connection.target)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const raw = event.dataTransfer.getData('application/teamagentx-dispatch-node')
    if (!raw) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    onDropNode(JSON.parse(raw) as NodeDropData, {
      x: Math.max(140, Math.round(position.x / 10) * 10),
      y: FLOW_NODE_CENTER_Y,
    })
  }

  const fullscreenLabel = isFullscreen
    ? t('chat.dispatchRules.builderExitFullscreen', { defaultValue: '退出全屏' })
    : t('chat.dispatchRules.builderFullscreen', { defaultValue: '全屏' })
  const FullscreenIcon = isFullscreen ? Minimize2 : Maximize2

  return (
    <section
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-background',
      )}
    >
      <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-lg border border-border bg-card/95 p-1 shadow-sm">
        <button
          type="button"
          onClick={onAutoLayout}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Wand2 className="size-3.5" />
          {t('chat.dispatchRules.builderAutoLayout')}
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          title={fullscreenLabel}
          aria-label={fullscreenLabel}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FullscreenIcon className="size-3.5" />
          {fullscreenLabel}
        </button>
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={(_, node) => commitNodePosition(node)}
        nodesDraggable={false}
        onConnect={handleConnect}
        onNodeClick={(_, node) => !isVirtualNodeId(node.id) && onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(undefined)}
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        deleteKeyCode={null}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        nodeOrigin={FLOW_NODE_ORIGIN}
        snapToGrid
        snapGrid={FLOW_SNAP_GRID}
        minZoom={0.45}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        className="h-full min-h-[560px]"
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="rgb(203 213 225 / 0.75)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  )
}

function isVirtualNodeId(id: string) {
  return id === VIRTUAL_START_ID || id === VIRTUAL_END_ID
}

const nodeTypes = {
  dispatchNode: memo(DispatchFlowNodeComponent),
  fixedNode: memo(FixedFlowNodeComponent),
}

const edgeTypes = {
  insertAgent: memo(InsertAgentEdgeComponent),
}

function InsertAgentEdgeComponent({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<InsertAgentEdge>) {
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const agents = data?.agents ?? []
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const isVisible = isHovered || isMenuOpen

  const handleInsertNode = (insertData: { kind: BuilderNode['type']; agentName?: string }) => {
    data?.onInsertNode(source, target, insertData)
    setIsMenuOpen(false)
    setIsHovered(false)
  }
  const stopCanvasEvent = (event: React.SyntheticEvent) => {
    event.stopPropagation()
  }

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={32}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => !isMenuOpen && setIsHovered(false)}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan nowheel absolute z-20"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onPointerDown={stopCanvasEvent}
          onPointerMove={stopCanvasEvent}
          onClick={stopCanvasEvent}
          onWheel={stopCanvasEvent}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            if (!isMenuOpen) setIsHovered(false)
          }}
        >
          <div className={cn('relative transition-opacity', isVisible ? 'opacity-100' : 'opacity-0')}>
            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              title={t('chat.dispatchRules.builderInsertAgent', { defaultValue: '添加助手' })}
              aria-label={t('chat.dispatchRules.builderInsertAgent', { defaultValue: '添加助手' })}
              className="flex size-7 items-center justify-center rounded-full border border-blue-200 bg-background text-blue-600 shadow-sm hover:bg-blue-50"
            >
              <Plus className="size-4" />
            </button>
            {isMenuOpen && (
              <div
                className="nodrag nopan nowheel absolute left-1/2 top-8 max-h-64 w-52 -translate-x-1/2 overflow-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
                onPointerDown={stopCanvasEvent}
                onPointerMove={stopCanvasEvent}
                onClick={stopCanvasEvent}
                onWheel={stopCanvasEvent}
              >
                <button
                  type="button"
                  onClick={() => handleInsertNode({ kind: 'parallel' })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                >
                  <RefreshCcw className="size-4 text-amber-600" />
                  <span className="min-w-0 flex-1 truncate">{t('chat.dispatchRules.builderParallelStep')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleInsertNode({ kind: 'oneOf' })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                >
                  <GitBranch className="size-4 text-violet-600" />
                  <span className="min-w-0 flex-1 truncate">{t('chat.dispatchRules.builderOneOfStep')}</span>
                </button>
                <div className="my-1 h-px bg-border" />
                {agents.length > 0 ? agents.map((agent) => (
                  <button
                    key={agent.name}
                    type="button"
                    onClick={() => handleInsertNode({ kind: 'agent', agentName: agent.name })}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-accent"
                  >
                    <AgentAvatarImage
                      avatar={agent.avatar ?? null}
                      agentName={agent.name}
                      agentLevel={agent.agentLevel}
                      className="size-5"
                    />
                    <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                  </button>
                )) : (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    {t('chat.dispatchRules.builderNoAgents')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

function DispatchFlowNodeComponent({ data, selected }: NodeProps<DispatchFlowNode>) {
  const { t } = useTranslation()
  const node = data.node
  const branchAgents = data.branchAgents ?? []
  const visibleBranchAgents = branchAgents.slice(0, 4)
  const hiddenBranchAgentCount = Math.max(0, branchAgents.length - visibleBranchAgents.length)
  const branchPassCount = node.type === 'parallel' ? node.branches.filter((branch) => branch.on_pass?.trim()).length : 0
  const branchFailCount = node.type === 'parallel' ? node.branches.filter((branch) => branch.on_fail?.trim()).length : 0
  const Icon = node.type === 'parallel' ? RefreshCcw : node.type === 'oneOf' ? GitBranch : Bot
  const title = node.type === 'agent'
    ? node.agent
    : node.type === 'parallel'
      ? t('chat.dispatchRules.builderParallelStep')
      : t('chat.dispatchRules.builderOneOfStep')

  return (
    <div
      className={cn(
        'w-[210px] rounded-lg border bg-card text-left shadow-sm transition-shadow',
        node.type === 'parallel' ? 'min-h-[112px]' : 'min-h-24',
        selected ? 'border-blue-400 shadow-md shadow-blue-500/10 ring-2 ring-blue-500/10' : 'border-border hover:border-blue-200',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3 !border-2 !border-white !bg-slate-400 hover:!bg-blue-500"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3 !border-2 !border-white !bg-slate-400 hover:!bg-blue-500"
      />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {node.type === 'agent' ? (
          <AgentAvatarImage avatar={data.agent?.avatar ?? null} agentName={node.agent} agentLevel={data.agent?.agentLevel} className="size-5" />
        ) : (
          <Icon className={cn('size-4', node.type === 'parallel' ? 'text-amber-600' : node.type === 'oneOf' ? 'text-violet-600' : 'text-blue-600')} />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{data.index + 1}</span>
      </div>
      <div className="space-y-1 px-3 py-2">
        <div className="line-clamp-2 text-xs text-muted-foreground">{node.task}</div>
        {node.type === 'parallel' && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center -space-x-1.5">
              {visibleBranchAgents.map((agent) => (
                <AgentAvatarImage
                  key={agent.name}
                  avatar={agent.avatar ?? null}
                  agentName={agent.name}
                  agentLevel={agent.agentLevel}
                  className="size-5 rounded-full border border-background bg-background"
                />
              ))}
              {hiddenBranchAgentCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full border border-background bg-muted text-[10px] text-muted-foreground">
                  +{hiddenBranchAgentCount}
                </span>
              )}
            </div>
            <div className="shrink-0 text-[11px] text-amber-700">{node.branches.length} {t('chat.dispatchRules.builderBranches')}</div>
          </div>
        )}
        {node.type === 'oneOf' && <div className="text-[11px] text-violet-700">{node.agents.join(' / ')}</div>}
        <OutcomeBadges
          onPass={node.type === 'parallel' ? undefined : node.on_pass}
          onFail={node.type === 'parallel' ? undefined : node.on_fail}
          passCount={branchPassCount}
          failCount={branchFailCount}
        />
      </div>
    </div>
  )
}

function OutcomeBadges({
  onPass,
  onFail,
  passCount,
  failCount,
}: {
  onPass?: string
  onFail?: string
  passCount: number
  failCount: number
}) {
  const { t } = useTranslation()
  const passText = onPass?.trim()
  const failText = onFail?.trim()
  const showPass = Boolean(passText) || passCount > 0
  const showFail = Boolean(failText) || failCount > 0

  if (!showPass && !showFail) return null

  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {showPass && (
        <span
          title={passText || undefined}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"
        >
          <CheckCircle2 className="size-3 shrink-0" />
          <span className="truncate">
            {t('chat.dispatchRules.builderOnPassPlaceholder')}
            {passCount > 0 ? ` ${passCount}` : ''}
          </span>
        </span>
      )}
      {showFail && (
        <span
          title={failText || undefined}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700"
        >
          <XCircle className="size-3 shrink-0" />
          <span className="truncate">
            {t('chat.dispatchRules.builderOnFailPlaceholder')}
            {failCount > 0 ? ` ${failCount}` : ''}
          </span>
        </span>
      )}
    </div>
  )
}

function FixedFlowNodeComponent({ data }: NodeProps<FixedFlowNode>) {
  const isStart = data.tone === 'start'

  return (
    <div
      className={cn(
        'relative flex h-14 w-24 items-center justify-center rounded-full border text-sm font-semibold shadow-sm',
        isStart ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600',
      )}
    >
      <Handle
        type={isStart ? 'source' : 'target'}
        position={isStart ? Position.Right : Position.Left}
        isConnectable={false}
        className="!size-2.5 !border-0 !bg-transparent"
      />
      {data.label}
    </div>
  )
}
