import { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  type CollisionDetection,
  useDroppable,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Search,
  Plus,
  Bot,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Trash2,
  FolderPlus,
  RefreshCw,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { agentApi, categoryApi, Agent, AgentCategory, AgentsGrouped } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { CreateAssistantModal } from './create-assistant-modal'
import { EditAssistantModal } from './edit-assistant-modal'
import { InstallSkillModal } from './install-skill-modal'
import { CreateCategoryModal } from './create-category-modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { QuickChatStartDialog } from './quick-chat-start-dialog'
import { AgentCard } from './agent-card'
import { useAuthStore } from '@/stores'
import { toast } from 'sonner'

// 系统分类 ID
const SYSTEM_CATEGORY_ID = 'system-category-00000000-0000-0000-0000-000000000001'
const SORT_ORDER_STEP = 1000
const UNCATEGORIZED_DROP_ID = '__uncategorized__'

type SortOrderUpdate = { id: string; sortOrder: number; categoryId?: string | null }
type DragPreview = { targetCategoryId: string | null; targetAgents: Agent[] }
type DragSourceCategoryId = string | null | undefined

const assistantCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) {
    return pointerCollisions
  }

  const intersectionCollisions = rectIntersection(args)
  if (intersectionCollisions.length > 0) {
    return intersectionCollisions
  }

  return closestCenter(args)
}

function getCategoryDropId(categoryId: string | null) {
  return categoryId || UNCATEGORIZED_DROP_ID
}

function getCategoryTailDropId(categoryId: string | null) {
  return `${getCategoryDropId(categoryId)}__tail`
}

function getAgentsInCategory(data: AgentsGrouped | null, categoryId: string | null) {
  if (!data) return []
  if (categoryId === null) return data.uncategorized
  return data.categories.find(cg => cg.category.id === categoryId)?.agents || []
}

function findAgentInGroupedData(data: AgentsGrouped | null, agentId: string) {
  return getAgentsInCategory(data, null).find(agent => agent.id === agentId)
    || data?.categories.flatMap(cg => cg.agents).find(agent => agent.id === agentId)
    || null
}

function replaceAgentsInCategory(data: AgentsGrouped, categoryId: string | null, agents: Agent[]) {
  if (categoryId === null) {
    data.uncategorized = agents
    return
  }

  const categoryGroup = data.categories.find(cg => cg.category.id === categoryId)
  if (categoryGroup) {
    categoryGroup.agents = agents
  }
}

function cloneGroupedData(data: AgentsGrouped): AgentsGrouped {
  return {
    categories: data.categories.map(categoryGroup => ({
      category: categoryGroup.category,
      agents: [...categoryGroup.agents],
    })),
    uncategorized: [...data.uncategorized],
  }
}

function withStableSortOrders(agents: Agent[]) {
  return agents.map((agent, index) => ({
    ...agent,
    sortOrder: (agents.length - index) * SORT_ORDER_STEP,
  }))
}

function buildSortOrderUpdates(
  agents: Agent[],
  categoryId?: string | null
): SortOrderUpdate[] {
  return agents.map(agent => ({
    id: agent.id,
    sortOrder: agent.sortOrder,
    ...(categoryId !== undefined ? { categoryId } : {}),
  }))
}

// 可排序的助手卡片包装组件
function SortableAgentCard({
  agent,
  ...props
}: {
  agent: Agent
  openMenuId: string | null
  contextMenuPosition: { x: number; y: number } | null
  onContextMenu: (e: React.MouseEvent, agent: Agent) => void
  onToggleMenu: (id: string, pos?: { x: number; y: number } | null) => void
  onEdit: (agent: Agent) => void
  onCopy: (agent: Agent) => void
  onToggleStatus: (id: string, currentStatus: boolean) => void
  onDelete: (agent: Agent) => void
  onStartQuickChat?: (agent: Agent) => void
  onInstallSkill?: (agent: Agent) => void
  onClick?: (agent: Agent) => void
}) {
  const isSystemAgent = agent.agentLevel === 'system'
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: agent.id,
    disabled: isSystemAgent, // 系统助手不可拖拽
    data: { agent },
  })

  const style = transform
    ? {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <AgentCard
        assistant={agent}
        isDragging={isDragging}
        {...props}
      />
    </div>
  )
}

// 可放置的分类区域组件
function DroppableCategoryArea({
  categoryId,
  isSystemCategory,
  children,
}: {
  categoryId: string | null // null 表示未分类
  isSystemCategory: boolean
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({
    id: getCategoryDropId(categoryId),
    data: { categoryId, isSystemCategory },
    disabled: isSystemCategory, // 系统分类不允许放置
  })

  return (
    <div
      ref={setNodeRef}
      className="rounded-lg"
    >
      {children}
    </div>
  )
}

function DroppableAgentGrid({
  categoryId,
  isEmpty,
  isMobile,
  children,
}: {
  categoryId: string | null
  isEmpty: boolean
  isMobile?: boolean
  children: React.ReactNode
}) {
  const { setNodeRef } = useDroppable({
    id: getCategoryTailDropId(categoryId),
    data: { categoryId, isCategoryTail: true },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "gap-3",
        isMobile ? "grid grid-cols-3" : "grid grid-cols-6",
        isEmpty && "min-h-[84px]"
      )}
    >
      {children}
    </div>
  )
}

// 导航到群聊的回调类型（由父组件提供）
interface AssistantPageProps {
  onNavigateToChatRoom?: (roomId: string) => void
  isMobile?: boolean
}

export function AssistantPage({ onNavigateToChatRoom, isMobile }: AssistantPageProps) {
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()
  const [assistants, setAssistants] = useState<Agent[]>([])
  const [groupedData, setGroupedData] = useState<AgentsGrouped | null>(null)
  const [_categories, setCategories] = useState<AgentCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [createModalDefaultCategoryId, setCreateModalDefaultCategoryId] = useState<string | undefined>(undefined)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingAssistant, setEditingAssistant] = useState<Agent | null>(null)
  const [editMode, setEditMode] = useState<'edit' | 'copy'>('edit')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingAssistant, setDeletingAssistant] = useState<Agent | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false)

  // 删除分类对话框状态
  const [deleteCategoryDialogOpen, setDeleteCategoryDialogOpen] = useState(false)
  const [deletingCategory, setDeletingCategory] = useState<AgentCategory | null>(null)
  const [deletingCategoryAgentsCount, setDeletingCategoryAgentsCount] = useState(0)
  const [deleteCategoryLoading, setDeleteCategoryLoading] = useState(false)

  // 编辑分类名称状态
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')

  // Skills 安装对话框状态
  const [isInstallSkillModalOpen, setIsInstallSkillModalOpen] = useState(false)
  const [installingSkillAgent, setInstallingSkillAgent] = useState<Agent | null>(null)
  const [quickChatAgent, setQuickChatAgent] = useState<Agent | null>(null)
  const [quickChatDialogOpen, setQuickChatDialogOpen] = useState(false)
  const [creatingQuickChat, setCreatingQuickChat] = useState(false)

  // dnd-kit 状态
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null)
  const [dragPreviewGroupedData, setDragPreviewGroupedData] = useState<AgentsGrouped | null>(null)
  const dragPreviewRef = useRef<DragPreview | null>(null)
  const dragSourceCategoryIdRef = useRef<DragSourceCategoryId>(undefined)

  // dnd-kit 传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 需要移动 8px 才开始拖拽
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    // Fetch grouped agents
    const groupedResponse = await agentApi.getGrouped()
    if (groupedResponse.success && groupedResponse.data) {
      setGroupedData(groupedResponse.data)
      // Flatten all assistants for search
      const allAgents = [
        ...groupedResponse.data.categories.flatMap(cg => cg.agents),
        ...groupedResponse.data.uncategorized
      ]
      setAssistants(allAgents)
      // 默认展开所有分类（包括未分类）
      const allCategoryIds = [...groupedResponse.data.categories.map(cg => cg.category.id), '__uncategorized__']
      setExpandedCategories(new Set(allCategoryIds))
    }
    // Fetch categories for management
    const categoriesResponse = await categoryApi.getAll()
    if (categoriesResponse.success && categoriesResponse.data) {
      setCategories(categoriesResponse.data)
    }
    setLoading(false)
  }, [currentUser?.id])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // 点击外部关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => {
      if (openMenuId) {
        closeMenu()
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [openMenuId])

  const handleCreateAssistant = async (data: {
    name: string
    avatarIndex: number
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    categoryId: string | null
    llmProviderId: string | null
  }): Promise<boolean> => {
    const response = await agentApi.create({
      name: data.name,
      avatar: String(data.avatarIndex),
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      categoryId: data.categoryId || undefined,
      llmProviderId: data.llmProviderId,
    })
    if (response.success) {
      await fetchData()
      setIsEditModalOpen(false)
      setEditingAssistant(null)
      setIsCreateModalOpen(false)
      return true
    } else {
      toast.error(response.error || '创建失败')
      return false
    }
  }

  const handleUpdateAssistant = async (data: {
    name: string
    avatarIndex: number
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    categoryId: string | null
    llmProviderId: string | null
  }): Promise<boolean> => {
    if (!editingAssistant) return false
    const response = await agentApi.update(editingAssistant.id, {
      name: data.name,
      avatar: String(data.avatarIndex),
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      categoryId: data.categoryId,
      llmProviderId: data.llmProviderId,
    })
    if (response.success) {
      await fetchData()
      setIsEditModalOpen(false)
      setEditingAssistant(null)
      return true
    } else {
      toast.error(response.error || '更新失败')
      return false
    }
  }

  const handleDeleteAssistant = async () => {
    if (!deletingAssistant) return
    const response = await agentApi.delete(deletingAssistant.id)
    if (response.success) {
      await fetchData()
    } else {
      toast.error(response.error || '删除失败')
    }
    setDeleteDialogOpen(false)
    setDeletingAssistant(null)
  }

  const openDeleteDialog = (assistant: Agent) => {
    setDeletingAssistant(assistant)
    setDeleteDialogOpen(true)
    closeMenu()
  }

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    const response = await agentApi.updateStatus(id, !currentStatus)
    if (response.success) {
      await fetchData()
    } else {
      toast.error(response.error || '状态更新失败')
    }
    closeMenu()
  }

  const openEditModal = (assistant: Agent) => {
    setEditingAssistant(assistant)
    setEditMode('edit')
    setIsEditModalOpen(true)
    closeMenu()
  }

  const openCopyModal = (assistant: Agent) => {
    setEditingAssistant(assistant)
    setEditMode('copy')
    setIsEditModalOpen(true)
    closeMenu()
  }

  // 打开 Skills 安装对话框
  const openInstallSkillModal = (assistant: Agent) => {
    setInstallingSkillAgent(assistant)
    setIsInstallSkillModalOpen(true)
    closeMenu()
  }

  // 打开创建助手对话框并预设分类
  const openCreateModalWithCategory = (categoryId: string | null) => {
    // 使用 flushSync 确保状态立即更新
    flushSync(() => {
      setCreateModalDefaultCategoryId(categoryId ?? undefined)
      setCreateModalKey(prev => prev + 1)
    })
    setIsCreateModalOpen(true)
  }

  const handleContextMenu = (e: React.MouseEvent, assistant: Agent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpenMenuId(assistant.id)
    setContextMenuPosition({ x: e.clientX, y: e.clientY })
  }

  const closeMenu = () => {
    setOpenMenuId(null)
    setContextMenuPosition(null)
  }

  const toggleCategoryExpansion = (categoryId: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev)
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId)
      } else {
        newSet.add(categoryId)
      }
      return newSet
    })
  }

  const handleCreateCategory = async (data: { name: string; description: string }) => {
    const response = await categoryApi.create(data)
    if (response.success) {
      await fetchData()
      setIsCreateCategoryModalOpen(false)
    } else {
      toast.error(response.error || '创建分类失败')
    }
  }

  // 打开删除分类确认对话框
  const openDeleteCategoryDialog = (category: AgentCategory, agentsCount: number) => {
    setDeletingCategory(category)
    setDeletingCategoryAgentsCount(agentsCount)
    setDeleteCategoryDialogOpen(true)
  }

  // 删除分类
  const handleDeleteCategory = async () => {
    if (!deletingCategory) return

    setDeleteCategoryLoading(true)
    try {
      const response = await categoryApi.delete(deletingCategory.id)
      if (response.success) {
        toast.success(`已删除分类「${deletingCategory.name}」及 ${response.data?.deletedAgentsCount || 0} 个助手`)
        await fetchData()
        setDeleteCategoryDialogOpen(false)
        setDeletingCategory(null)
      } else {
        toast.error(response.error || '删除分类失败')
      }
    } finally {
      setDeleteCategoryLoading(false)
    }
  }

  // 开始编辑分类名称
  const startEditCategoryName = (categoryId: string, currentName: string) => {
    setEditingCategoryId(categoryId)
    setEditingCategoryName(currentName)
  }

  // 保存分类名称
  const saveCategoryName = async () => {
    if (!editingCategoryId || !editingCategoryName.trim()) return

    const response = await categoryApi.update(editingCategoryId, { name: editingCategoryName.trim() })
    if (response.success) {
      await fetchData()
      setEditingCategoryId(null)
      setEditingCategoryName('')
    } else {
      toast.error(response.error || '修改分类名称失败')
    }
  }

  // 取消编辑分类名称
  const cancelEditCategoryName = () => {
    setEditingCategoryId(null)
    setEditingCategoryName('')
  }

  const openQuickChatDialog = (agent: Agent) => {
    closeMenu()
    setQuickChatAgent(agent)
    setQuickChatDialogOpen(true)
  }

  // 新建快速对话
  const handleStartQuickChat = async (workDir?: string) => {
    if (!currentUser?.id) {
      toast.error('请先登录')
      return
    }
    if (!quickChatAgent) return

    setCreatingQuickChat(true)
    try {
      const response = await agentApi.createQuickChat(quickChatAgent.id, currentUser.id, workDir)
      if (response.success && response.data) {
        setQuickChatDialogOpen(false)
        setQuickChatAgent(null)
        // 导航到新创建的群聊
        onNavigateToChatRoom?.(response.data.id)
      } else {
        toast.error(response.error || '创建快速对话失败')
      }
    } finally {
      setCreatingQuickChat(false)
    }
  }

  // 点击助手卡片 - 移动端直接快速对话，桌面端跳转详情页
  const handleAgentClick = (agent: Agent) => {
    if (isMobile) {
      openQuickChatDialog(agent)
    } else {
      navigate(`/assistant/${agent.id}`)
    }
  }

  // dnd-kit 拖拽开始
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const agent = (active.data.current?.agent as Agent | undefined)
      || findAgentInGroupedData(groupedData, String(active.id))
      || assistants.find(a => a.id === active.id)
    setActiveAgent(agent || null)
    setDragPreviewGroupedData(null)
    dragPreviewRef.current = null
    dragSourceCategoryIdRef.current = agent ? agent.categoryId || null : undefined
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event

    if (!over) {
      setDragPreviewGroupedData(null)
      dragPreviewRef.current = null
      return
    }

    if (active.id === over.id) return

    const activeId = active.id as string
    const draggedAgent = (active.data.current?.agent as Agent | undefined)
      || findAgentInGroupedData(groupedData, activeId)
      || assistants.find(agent => agent.id === activeId)

    if (!groupedData || !draggedAgent || draggedAgent.agentLevel === 'system') {
      setDragPreviewGroupedData(null)
      dragPreviewRef.current = null
      return
    }

    const overData = over.data.current
    let targetCategoryId: string | null | undefined
    let insertIndex: number | undefined
    if (overData?.categoryId !== undefined) {
      targetCategoryId = overData.categoryId as string | null
      insertIndex = getAgentsInCategory(groupedData, targetCategoryId).length
    } else {
      const overAgent = (overData?.agent as Agent | undefined)
        || findAgentInGroupedData(groupedData, String(over.id))
        || assistants.find(agent => agent.id === over.id)
      if (overAgent) {
        targetCategoryId = overAgent.categoryId || null
        insertIndex = getAgentsInCategory(groupedData, targetCategoryId).findIndex(agent => agent.id === over.id)
      }
    }

    const currentCategoryId = dragSourceCategoryIdRef.current !== undefined
      ? dragSourceCategoryIdRef.current
      : draggedAgent.categoryId || null
    if (
      targetCategoryId === undefined
      || insertIndex === undefined
      || insertIndex < 0
      || targetCategoryId === currentCategoryId
      || targetCategoryId === SYSTEM_CATEGORY_ID
    ) {
      setDragPreviewGroupedData(null)
      dragPreviewRef.current = null
      return
    }

    const nextData = cloneGroupedData(groupedData)
    const sourceAgentsWithoutDragged = getAgentsInCategory(nextData, currentCategoryId)
      .filter(agent => agent.id !== activeId)
    const targetAgents = getAgentsInCategory(nextData, targetCategoryId)
      .filter(agent => agent.id !== activeId)
    const boundedInsertIndex = Math.min(insertIndex, targetAgents.length)
    const targetAgentsWithPreview = [
      ...targetAgents.slice(0, boundedInsertIndex),
      { ...draggedAgent, categoryId: targetCategoryId },
      ...targetAgents.slice(boundedInsertIndex),
    ]

    replaceAgentsInCategory(nextData, currentCategoryId, sourceAgentsWithoutDragged)
    replaceAgentsInCategory(nextData, targetCategoryId, targetAgentsWithPreview)
    dragPreviewRef.current = { targetCategoryId, targetAgents: targetAgentsWithPreview }
    setDragPreviewGroupedData(nextData)
  }

  const handleDragCancel = () => {
    setActiveAgent(null)
    setDragPreviewGroupedData(null)
    dragPreviewRef.current = null
    dragSourceCategoryIdRef.current = undefined
  }

  const syncFlatAssistants = (updatedAgents: Agent[]) => {
    const updatedAgentMap = new Map(updatedAgents.map(agent => [agent.id, agent]))
    setAssistants(prev => prev.map(agent => updatedAgentMap.get(agent.id) || agent))
  }

  // dnd-kit 拖拽结束
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    const dragPreview = dragPreviewRef.current
    dragPreviewRef.current = null
    const sourceCategoryId = dragSourceCategoryIdRef.current
    dragSourceCategoryIdRef.current = undefined
    setActiveAgent(null)
    setDragPreviewGroupedData(null)

    if (!over) return

    const activeId = active.id as string

    // 找到拖拽的助手
    const draggedAgent = (active.data.current?.agent as Agent | undefined)
      || findAgentInGroupedData(groupedData, activeId)
      || assistants.find(a => a.id === activeId)
    if (!draggedAgent || draggedAgent.agentLevel === 'system') return

    const currentCategoryId = sourceCategoryId !== undefined
      ? sourceCategoryId
      : draggedAgent.categoryId || null

    if (active.id === over.id) {
      if (!dragPreview || dragPreview.targetCategoryId === currentCategoryId) return

      const targetCategoryId = dragPreview.targetCategoryId
      const reorderedTargetAgents = withStableSortOrders(dragPreview.targetAgents)
      const sourceAgentsWithoutDragged = getAgentsInCategory(groupedData, currentCategoryId)
        .filter(agent => agent.id !== activeId)

      setGroupedData(prev => {
        if (!prev) return prev
        const newData = JSON.parse(JSON.stringify(prev))
        replaceAgentsInCategory(newData, currentCategoryId, sourceAgentsWithoutDragged)
        replaceAgentsInCategory(newData, targetCategoryId, reorderedTargetAgents)
        return newData
      })
      syncFlatAssistants(reorderedTargetAgents)

      agentApi.updateSortOrder(buildSortOrderUpdates(reorderedTargetAgents, targetCategoryId)).then(response => {
        if (!response.success) {
          toast.error(response.error || '移动失败')
          fetchData()
        }
      })
      return
    }

    const overId = over.id as string

    // 判断目标是否是分类区域（通过 over.data）
    const overData = over.data.current
    const isOverCategory = overData?.categoryId !== undefined

    if (isOverCategory) {
      // 拖到分类区域
      const targetCategoryId = overData.categoryId as string | null

      // 系统分类不允许拖入
      if (targetCategoryId === SYSTEM_CATEGORY_ID) {
        toast.error('系统分类不允许添加助手')
        return
      }

      if (currentCategoryId === targetCategoryId) return

      const sourceAgents = getAgentsInCategory(groupedData, currentCategoryId)
      const targetAgents = getAgentsInCategory(groupedData, targetCategoryId)
      const sourceAgentsWithoutDragged = sourceAgents.filter(agent => agent.id !== activeId)
      const reorderedTargetAgents = withStableSortOrders([
        ...targetAgents,
        { ...draggedAgent, categoryId: targetCategoryId },
      ])

      // 乐观更新
      setGroupedData(prev => {
        if (!prev) return prev
        const newData = JSON.parse(JSON.stringify(prev))

        replaceAgentsInCategory(newData, currentCategoryId, sourceAgentsWithoutDragged)
        replaceAgentsInCategory(newData, targetCategoryId, reorderedTargetAgents)

        return newData
      })
      syncFlatAssistants(reorderedTargetAgents)

      // 更新助手分类
      agentApi.updateSortOrder(buildSortOrderUpdates(reorderedTargetAgents, targetCategoryId)).then(response => {
        if (!response.success) {
          toast.error(response.error || '移动失败')
          fetchData()
        }
      })
      return
    }

    // 拖到另一个助手上
    const overAgent = (over.data.current?.agent as Agent | undefined)
      || findAgentInGroupedData(groupedData, overId)
      || assistants.find(a => a.id === overId)
    if (!overAgent) return

    const targetCategoryId = overAgent.categoryId || null

    // 系统分类不允许拖入
    if (targetCategoryId === SYSTEM_CATEGORY_ID) {
      toast.error('系统分类不允许添加助手')
      return
    }

    // 系统助手不允许接收拖拽
    if (overAgent.agentLevel === 'system') {
      toast.error('系统助手不允许其他助手拖入')
      return
    }

    if (currentCategoryId !== targetCategoryId) {
      const sourceAgents = getAgentsInCategory(groupedData, currentCategoryId)
      const targetAgents = getAgentsInCategory(groupedData, targetCategoryId)
      const sourceAgentsWithoutDragged = sourceAgents.filter(agent => agent.id !== activeId)
      const targetIndex = targetAgents.findIndex(agent => agent.id === overId)
      const insertIndex = targetIndex === -1 ? targetAgents.length : targetIndex
      const reorderedTargetAgents = withStableSortOrders([
        ...targetAgents.slice(0, insertIndex),
        { ...draggedAgent, categoryId: targetCategoryId },
        ...targetAgents.slice(insertIndex),
      ])

      // 跨分类移动
      setGroupedData(prev => {
        if (!prev) return prev
        const newData = JSON.parse(JSON.stringify(prev))

        replaceAgentsInCategory(newData, currentCategoryId, sourceAgentsWithoutDragged)
        replaceAgentsInCategory(newData, targetCategoryId, reorderedTargetAgents)

        return newData
      })
      syncFlatAssistants(reorderedTargetAgents)

      agentApi.updateSortOrder(buildSortOrderUpdates(reorderedTargetAgents, targetCategoryId)).then(response => {
        if (!response.success) {
          toast.error(response.error || '移动失败')
          fetchData()
        }
      })
    } else {
      // 同组内排序
      const agentsInCategory = getAgentsInCategory(groupedData, targetCategoryId)

      const targetIndex = agentsInCategory.findIndex(a => a.id === overId)
      const draggedIndex = agentsInCategory.findIndex(a => a.id === activeId)

      if (targetIndex === -1 || draggedIndex === -1 || targetIndex === draggedIndex) return

      const reorderedAgents = withStableSortOrders(arrayMove(agentsInCategory, draggedIndex, targetIndex))

      // 乐观更新
      setGroupedData(prev => {
        if (!prev) return prev
        const newData = JSON.parse(JSON.stringify(prev))
        replaceAgentsInCategory(newData, targetCategoryId, reorderedAgents)
        return newData
      })
      syncFlatAssistants(reorderedAgents)

      agentApi.updateSortOrder(buildSortOrderUpdates(reorderedAgents)).then(response => {
        if (!response.success) {
          toast.error(response.error || '排序失败')
          fetchData()
        }
      })
    }
  }

  // Filter helpers for grouped display
  const displayedGroupedData = dragPreviewGroupedData || groupedData

  // 分离系统分类（sortOrder = -1000）和普通分类
  const { normalCategories, systemCategory } = displayedGroupedData ? {
    normalCategories: displayedGroupedData.categories.filter(cg => cg.category.sortOrder !== -1000),
    systemCategory: displayedGroupedData.categories.find(cg => cg.category.sortOrder === -1000),
  } : { normalCategories: [], systemCategory: null }

  const filteredGroupedData = displayedGroupedData ? {
    categories: normalCategories
      .map(cg => ({
        category: cg.category,
        agents: cg.agents.filter(a =>
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.description?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      })),
    systemCategory: systemCategory ? {
      category: systemCategory.category,
      agents: systemCategory.agents.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    } : null,
    uncategorized: displayedGroupedData.uncategorized.filter(a =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  } : null

  return (
    <>
      <div className="flex flex-1 flex-col bg-[var(--surface)]">
        {/* Header */}
        <div
          className="flex h-[52px] items-center border-b border-border px-4 shrink-0 bg-[var(--surface-raised)]"
          style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <span className="text-sm font-bold text-foreground">助手</span>
          </div>
          <div
            className="ml-auto flex items-center gap-1.5"
            style={window.electronAPI?.isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            <div className={cn("ta-search-shell", isMobile && "flex-1 max-w-[220px]")}>
              <Search className="size-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索助手"
                className={cn("bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none", isMobile ? "w-full" : "w-44")}
              />
            </div>
            {!isMobile && (
              <>
                <button
                  onClick={() => setIsCreateCategoryModalOpen(true)}
                  className="ta-button-secondary"
                >
                  <FolderPlus className="size-4" />
                  创建分类
                </button>
                <button
                  onClick={() => fetchData()}
                  disabled={loading}
                  className="ta-button-secondary"
                >
                  <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                  刷新
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="ta-button-primary"
                >
                  <Plus className="size-4" />
                  创建助手
                </button>
              </>
            )}
            {isMobile && (
              <button
                onClick={() => fetchData()}
                disabled={loading}
                className="ta-icon-button"
              >
                <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className={cn(isMobile ? "ta-page-section-mobile" : "ta-page-section")}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
              </div>
            ) : assistants.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Bot className="size-12 mb-2" />
                <p>暂无助手</p>
              </div>
            ) : filteredGroupedData && (filteredGroupedData.categories.length > 0 || filteredGroupedData.uncategorized.length > 0 || filteredGroupedData.systemCategory) ? (
              <DndContext
                sensors={sensors}
                collisionDetection={assistantCollisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <>
                {/* Render categorized groups */}
                {filteredGroupedData.categories.map((categoryGroup) => (
                  <DroppableCategoryArea
                    key={categoryGroup.category.id}
                    categoryId={categoryGroup.category.id}
                    isSystemCategory={categoryGroup.category.id === SYSTEM_CATEGORY_ID}
                  >
                    <div className="mb-6">
                      {/* Category header */}
                      <div className="group mb-3 flex items-center gap-2">
                        {expandedCategories.has(categoryGroup.category.id) ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                        {expandedCategories.has(categoryGroup.category.id) ? (
                          <FolderOpen className="size-4 text-primary" />
                        ) : (
                          <Folder className="size-4 text-muted-foreground" />
                        )}
                        {/* 分类名称 - 支持编辑 */}
                        {editingCategoryId === categoryGroup.category.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={editingCategoryName}
                              onChange={(e) => setEditingCategoryName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  saveCategoryName()
                                } else if (e.key === 'Escape') {
                                  cancelEditCategoryName()
                                }
                              }}
                              className="ta-input h-8 w-36 px-2 py-1 text-sm shadow-none"
                              autoFocus
                            />
                            <button
                              onClick={saveCategoryName}
                              className="ta-icon-button-compact text-green-600 hover:bg-green-500/10 hover:text-green-600"
                            >
                              <Check className="size-3.5" />
                            </button>
                            <button
                              onClick={cancelEditCategoryName}
                              className="ta-icon-button-compact"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => toggleCategoryExpansion(categoryGroup.category.id)}
                              className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-foreground/80"
                            >
                              <span>{categoryGroup.category.name}</span>
                              <span className="text-muted-foreground">({categoryGroup.agents.length})</span>
                            </button>
                            {/* 移动端隐藏添加助手按钮 */}
                            {!isMobile && categoryGroup.category.id !== SYSTEM_CATEGORY_ID && (
                              <button
                                onClick={() => openCreateModalWithCategory(categoryGroup.category.id)}
                                className="ta-icon-button-compact opacity-70 hover:bg-primary/10 hover:text-primary hover:opacity-100"
                                title="添加助手"
                              >
                                <Plus className="size-3.5" />
                              </button>
                            )}
                            {/* 操作按钮 - hover 显示（系统分类不显示，移动端隐藏） */}
                            {!isMobile && categoryGroup.category.id !== SYSTEM_CATEGORY_ID && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditCategoryName(categoryGroup.category.id, categoryGroup.category.name)}
                                  className="ta-icon-button-compact hover:bg-primary/10 hover:text-primary"
                                  title="修改名称"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  onClick={() => openDeleteCategoryDialog(categoryGroup.category, categoryGroup.agents.length)}
                                  className="ta-icon-button-compact hover:bg-destructive/10 hover:text-destructive"
                                  title="删除分类"
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>

                      {/* Category agents grid */}
                      {expandedCategories.has(categoryGroup.category.id) && (
                        <SortableContext
                          items={categoryGroup.agents.map(a => a.id)}
                          strategy={rectSortingStrategy}
                        >
                          <DroppableAgentGrid
                            categoryId={categoryGroup.category.id}
                            isEmpty={categoryGroup.agents.length === 0}
                            isMobile={isMobile}
                          >
                            {categoryGroup.agents.map((assistant) => (
                              <SortableAgentCard
                                key={assistant.id}
                                agent={assistant}
                                openMenuId={openMenuId}
                                contextMenuPosition={contextMenuPosition}
                                onContextMenu={handleContextMenu}
                                onToggleMenu={(id, pos) => {
                                  if (openMenuId === id) {
                                    closeMenu()
                                  } else {
                                    setOpenMenuId(id)
                                    setContextMenuPosition(pos ? null : null)
                                  }
                                }}
                                onEdit={openEditModal}
                                onCopy={openCopyModal}
                                onToggleStatus={handleToggleStatus}
                                onDelete={openDeleteDialog}
                                onStartQuickChat={openQuickChatDialog}
                                onInstallSkill={openInstallSkillModal}
                                onClick={handleAgentClick}
                              />
                            ))}
                          </DroppableAgentGrid>
                        </SortableContext>
                      )}
                    </div>
                  </DroppableCategoryArea>
                ))}

                {/* Render uncategorized agents */}
                {filteredGroupedData.uncategorized.length > 0 && (
                  <DroppableCategoryArea
                    categoryId={null}
                    isSystemCategory={false}
                  >
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <button
                          onClick={() => toggleCategoryExpansion('__uncategorized__')}
                          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground/80"
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
                          <span className="text-muted-foreground">({filteredGroupedData.uncategorized.length})</span>
                        </button>
                        {/* 移动端隐藏添加助手按钮 */}
                        {!isMobile && (
                          <button
                            onClick={() => openCreateModalWithCategory(null)}
                            className="ta-icon-button-compact opacity-70 hover:bg-primary/10 hover:text-primary hover:opacity-100"
                            title="添加助手"
                          >
                            <Plus className="size-3.5" />
                          </button>
                        )}
                      </div>
                      {expandedCategories.has('__uncategorized__') && (
                        <SortableContext
                          items={filteredGroupedData.uncategorized.map(a => a.id)}
                          strategy={rectSortingStrategy}
                        >
                          <DroppableAgentGrid
                            categoryId={null}
                            isEmpty={filteredGroupedData.uncategorized.length === 0}
                            isMobile={isMobile}
                          >
                            {filteredGroupedData.uncategorized.map((assistant) => (
                              <SortableAgentCard
                                key={assistant.id}
                                agent={assistant}
                                openMenuId={openMenuId}
                                contextMenuPosition={contextMenuPosition}
                                onContextMenu={handleContextMenu}
                                onToggleMenu={(id) => {
                                  if (openMenuId === id) {
                                    closeMenu()
                                  } else {
                                    setOpenMenuId(id)
                                    setContextMenuPosition(null)
                                  }
                                }}
                                onEdit={openEditModal}
                                onCopy={openCopyModal}
                                onToggleStatus={handleToggleStatus}
                                onDelete={openDeleteDialog}
                                onStartQuickChat={openQuickChatDialog}
                                onInstallSkill={openInstallSkillModal}
                                onClick={handleAgentClick}
                              />
                            ))}
                          </DroppableAgentGrid>
                        </SortableContext>
                      )}
                    </div>
                  </DroppableCategoryArea>
                )}

                {/* Render system category - 始终显示在最后，不支持拖拽 */}
                {filteredGroupedData.systemCategory && (
                  <DroppableCategoryArea
                    categoryId={filteredGroupedData.systemCategory.category.id}
                    isSystemCategory={true}
                  >
                    <div className="mb-6">
                      <button
                        onClick={() => toggleCategoryExpansion(filteredGroupedData.systemCategory!.category.id)}
                        className="flex items-center gap-2 mb-3 text-sm font-medium text-foreground hover:text-foreground/80"
                      >
                        {expandedCategories.has(filteredGroupedData.systemCategory.category.id) ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                        {expandedCategories.has(filteredGroupedData.systemCategory.category.id) ? (
                          <FolderOpen className="size-4 text-primary" />
                        ) : (
                          <Folder className="size-4 text-muted-foreground" />
                        )}
                        <span>{filteredGroupedData.systemCategory.category.name}</span>
                        <span className="text-muted-foreground">({filteredGroupedData.systemCategory.agents.length})</span>
                      </button>
                      {expandedCategories.has(filteredGroupedData.systemCategory.category.id) && filteredGroupedData.systemCategory.agents.length > 0 && (
                        <div className={cn("gap-3", isMobile ? "grid grid-cols-3" : "grid grid-cols-6")}>
                          {filteredGroupedData.systemCategory.agents.map((assistant) => (
                            <SortableAgentCard
                              key={assistant.id}
                              agent={assistant}
                              openMenuId={openMenuId}
                              contextMenuPosition={contextMenuPosition}
                              onContextMenu={handleContextMenu}
                              onToggleMenu={(id, pos) => {
                                if (openMenuId === id) {
                                  closeMenu()
                                } else {
                                  setOpenMenuId(id)
                                  setContextMenuPosition(pos ? null : null)
                                }
                              }}
                              onEdit={openEditModal}
                              onCopy={openCopyModal}
                              onToggleStatus={handleToggleStatus}
                              onDelete={openDeleteDialog}
                              onStartQuickChat={openQuickChatDialog}
                              onInstallSkill={openInstallSkillModal}
                              onClick={handleAgentClick}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </DroppableCategoryArea>
                )}
                </>

                {/* Drag Overlay - 拖拽时显示的预览 */}
                <DragOverlay>
                  {activeAgent ? (
                    <div className="opacity-80">
                      <AgentCard
                        assistant={activeAgent}
                        openMenuId={null}
                        contextMenuPosition={null}
                        onContextMenu={() => {}}
                        onToggleMenu={() => {}}
                        onEdit={() => {}}
                        onCopy={() => {}}
                        onToggleStatus={() => {}}
                        onDelete={() => {}}
                      />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Search className="size-12 mb-2" />
                <p>未找到匹配的助手</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateAssistantModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false)
          setCreateModalDefaultCategoryId(undefined)
        }}
        onSubmit={handleCreateAssistant}
        defaultCategoryId={createModalDefaultCategoryId}
        key={createModalKey}
      />

      <EditAssistantModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingAssistant(null)
        }}
        onSubmit={editMode === 'copy' ? handleCreateAssistant : handleUpdateAssistant}
        assistant={editingAssistant}
        mode={editMode}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="删除助手"
        description={`确定要删除助手「${deletingAssistant?.name}」吗？此操作无法撤销。`}
        confirmText="删除"
        onConfirm={handleDeleteAssistant}
        icon={Trash2}
      />

      <CreateCategoryModal
        isOpen={isCreateCategoryModalOpen}
        onClose={() => setIsCreateCategoryModalOpen(false)}
        onSubmit={handleCreateCategory}
      />

      {/* 删除分类确认对话框 */}
      <ConfirmDialog
        open={deleteCategoryDialogOpen}
        onOpenChange={setDeleteCategoryDialogOpen}
        title="删除分类"
        description={
          deletingCategoryAgentsCount > 0
            ? `确定要删除分类「${deletingCategory?.name}」吗？该分类下的 ${deletingCategoryAgentsCount} 个助手也将被删除，此操作无法撤销。`
            : `确定要删除分类「${deletingCategory?.name}」吗？此操作无法撤销。`
        }
        confirmText="删除"
        onConfirm={handleDeleteCategory}
        loading={deleteCategoryLoading}
        icon={Trash2}
      />

      {/* Skills 安装对话框 */}
      {installingSkillAgent && (
        <InstallSkillModal
          isOpen={isInstallSkillModalOpen}
          onClose={() => {
            setIsInstallSkillModalOpen(false)
            setInstallingSkillAgent(null)
          }}
          agentId={installingSkillAgent.id}
          agentName={installingSkillAgent.name}
        />
      )}

      <QuickChatStartDialog
        open={quickChatDialogOpen}
        onOpenChange={(open) => {
          setQuickChatDialogOpen(open)
          if (!open) {
            setQuickChatAgent(null)
          }
        }}
        agent={quickChatAgent}
        onConfirm={handleStartQuickChat}
        loading={creatingQuickChat}
      />
    </>
  )
}
