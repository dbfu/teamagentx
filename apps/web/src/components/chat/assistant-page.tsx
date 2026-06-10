import { useState, useEffect, useCallback, useRef } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  Trash2,
  FolderPlus,
  RefreshCw,
  Pencil,
  Check,
  X,
} from 'lucide-react'
import { agentApi, categoryApi, Agent, AgentCategory, AgentSpeechConfig, AgentsGrouped, type AgentThinkingMode } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { isSystemAssistantDetailBlocked } from '@/lib/system-agents'
import { CreateAssistantModal } from './create-assistant-modal'
import { EditAssistantModal } from './edit-assistant-modal'
import { InstallSkillModal } from './install-skill-modal'
import { CreateCategoryModal } from './create-category-modal'
import { CategoryToggleButton } from './category-toggle-button'
import { shouldRenderUncategorizedSection } from './assistant-page-dnd'
import { SystemAssistantModelModal, type SystemAssistantRuntimeConfig } from './system-assistant-model-modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { QuickChatStartDialog } from './quick-chat-start-dialog'
import { AgentCard } from './agent-card'
import { CoordinatorLogModal } from '@/components/coordinator-log-modal'
import { useAuthStore } from '@/stores'
import { toast } from 'sonner'
import { useChatRoomStore } from '@/stores/chat-room-store'
import { GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID } from '@/lib/system-agents'

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
  onCoordinatorLogs?: (agent: Agent) => void
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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user: currentUser } = useAuthStore()
  const loadChatRooms = useChatRoomStore((s) => s.loadChatRooms)
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
  const [systemModelAgent, setSystemModelAgent] = useState<Agent | null>(null)
  const [systemModelModalOpen, setSystemModelModalOpen] = useState(false)
  const [coordinatorLogModalOpen, setCoordinatorLogModalOpen] = useState(false)

  // dnd-kit 状态
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null)
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

  const fetchData = useCallback(async (options: { showLoading?: boolean; resetExpanded?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true
    const resetExpanded = options.resetExpanded ?? true

    if (showLoading) {
      setLoading(true)
    }
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
      if (resetExpanded) {
        // 默认展开所有分类（包括未分类）
        const allCategoryIds = [...groupedResponse.data.categories.map(cg => cg.category.id), '__uncategorized__']
        setExpandedCategories(new Set(allCategoryIds))
      }
    }
    // Fetch categories for management
    const categoriesResponse = await categoryApi.getAll()
    if (categoriesResponse.success && categoriesResponse.data) {
      setCategories(categoriesResponse.data)
    }
    if (showLoading) {
      setLoading(false)
    }
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
    avatar: string
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    proxyConfig?: string | null
    codexModel?: string | null
    codexFastMode?: boolean
    claudeModel?: string | null
    thinkingMode?: AgentThinkingMode | null
    categoryId: string | null
    llmProviderId: string | null
    speechConfig: AgentSpeechConfig | null
    imageGeneration?: { enabled: boolean; llmProviderId: string | null }
  }): Promise<boolean> => {
    const response = await agentApi.create({
      name: data.name,
      avatar: data.avatar,
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      proxyConfig: data.proxyConfig || null,
      codexModel: data.codexModel || null,
      codexFastMode: Boolean(data.codexFastMode),
      claudeModel: data.claudeModel || null,
      thinkingMode: data.thinkingMode || 'high',
      categoryId: data.categoryId || undefined,
      llmProviderId: data.llmProviderId,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      await fetchData()
      setIsEditModalOpen(false)
      setEditingAssistant(null)
      setIsCreateModalOpen(false)
      return true
    } else {
      toast.error(t('assistant.createFailed'))
      return false
    }
  }

  const handleUpdateAssistant = async (data: {
    name: string
    avatar: string
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    proxyConfig?: string | null
    codexModel?: string | null
    codexFastMode?: boolean
    claudeModel?: string | null
    thinkingMode?: AgentThinkingMode | null
    categoryId: string | null
    llmProviderId: string | null
    speechConfig: AgentSpeechConfig | null
    imageGeneration?: { enabled: boolean; llmProviderId: string | null }
  }): Promise<boolean> => {
    if (!editingAssistant) return false
    const response = await agentApi.update(editingAssistant.id, {
      name: data.name,
      avatar: data.avatar,
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      proxyConfig: data.proxyConfig || null,
      codexModel: data.codexModel || null,
      codexFastMode: Boolean(data.codexFastMode),
      claudeModel: data.claudeModel || null,
      thinkingMode: data.thinkingMode || 'high',
      categoryId: data.categoryId,
      llmProviderId: data.llmProviderId,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      await fetchData({ showLoading: false, resetExpanded: false })
      await loadChatRooms()
      setIsEditModalOpen(false)
      setEditingAssistant(null)
      return true
    } else {
      toast.error(t('assistant.updateFailed'))
      return false
    }
  }

  const handleDeleteAssistant = async () => {
    if (!deletingAssistant) return
    const response = await agentApi.delete(deletingAssistant.id)
    if (response.success) {
      await fetchData()
    } else {
      toast.error(t('common.deleteFailed'))
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
      toast.error(t('assistant.statusUpdateFailed'))
    }
    closeMenu()
  }

  const loadAssistantForModal = async (assistant: Agent): Promise<Agent> => {
    const response = await agentApi.getById(assistant.id)
    // DEBUG: 打印 API 返回的数据
    console.log('[assistant-page] loadAssistantForModal 返回:', {
      success: response.success,
      assistantId: assistant.id,
      returnedData: response.success && response.data ? {
        id: response.data.id,
        name: response.data.name,
        llmProviderId: response.data.llmProviderId,
        llmProvider: response.data.llmProvider,
      } : null,
    })
    return response.success && response.data ? response.data : assistant
  }

  const openEditModal = async (assistant: Agent) => {
    setEditMode('edit')
    closeMenu()
    if (
      assistant.agentLevel === 'system'
      && (
        assistant.id === GROUP_ASSISTANT_ID
        || assistant.id === GROUP_COORDINATOR_ID
        || assistant.name === '群助手'
        || assistant.name === '群调度助手'
      )
    ) {
      setSystemModelAgent(await loadAssistantForModal(assistant))
      setSystemModelModalOpen(true)
      return
    }
    setEditingAssistant(await loadAssistantForModal(assistant))
    setIsEditModalOpen(true)
  }

  const openCopyModal = async (assistant: Agent) => {
    setEditMode('copy')
    closeMenu()
    setEditingAssistant(await loadAssistantForModal(assistant))
    setIsEditModalOpen(true)
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
      toast.error(t('assistant.categoryCreateFailed'))
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
        toast.success(t('assistant.categoryDeletedWithAgents', { name: deletingCategory.name, count: response.data?.deletedAgentsCount || 0 }))
        await fetchData()
        setDeleteCategoryDialogOpen(false)
        setDeletingCategory(null)
      } else {
        toast.error(t('assistant.categoryDeleteFailed'))
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
      toast.error(t('assistant.categoryNameUpdateFailed'))
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

  const openCoordinatorLogsDialog = (_agent: Agent) => {
    closeMenu()
    setCoordinatorLogModalOpen(true)
  }

  // 新建快速对话
  const handleStartQuickChat = async (workDir?: string) => {
    if (!currentUser?.id) {
      toast.error(t('auth.pleaseLoginFirst'))
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
        toast.error(t('assistant.quickChatCreateFailed'))
      }
    } finally {
      setCreatingQuickChat(false)
    }
  }

  const handleUpdateSystemAssistantModel = async (data: SystemAssistantRuntimeConfig): Promise<boolean> => {
    if (!systemModelAgent) return false

    const response = await agentApi.update(systemModelAgent.id, data)
    if (response.success) {
      toast.success(t('assistant.assistantUpdated', { name: systemModelAgent.name }))
      // fetchData 会获取最新数据并更新状态，不需要再用旧数据覆盖
      await fetchData({ showLoading: false, resetExpanded: false })
      await loadChatRooms()
      setSystemModelAgent(null)
      return true
    }

    toast.error(t('assistant.updateFailed'))
    return false
  }

  // 点击助手卡片 - 移动端直接快速对话，桌面端跳转详情页
  const handleAgentClick = (agent: Agent) => {
    if (isSystemAssistantDetailBlocked(agent)) return
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
    dragPreviewRef.current = null
    dragSourceCategoryIdRef.current = agent ? agent.categoryId || null : undefined
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event

    if (!over) {
      dragPreviewRef.current = null
      return
    }

    if (active.id === over.id) return

    const activeId = active.id as string
    const draggedAgent = (active.data.current?.agent as Agent | undefined)
      || findAgentInGroupedData(groupedData, activeId)
      || assistants.find(agent => agent.id === activeId)

    if (!groupedData || !draggedAgent || draggedAgent.agentLevel === 'system') {
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
      dragPreviewRef.current = null
      return
    }

    const targetAgents = getAgentsInCategory(groupedData, targetCategoryId)
      .filter(agent => agent.id !== activeId)
    const boundedInsertIndex = Math.min(insertIndex, targetAgents.length)
    const targetAgentsWithPreview = [
      ...targetAgents.slice(0, boundedInsertIndex),
      { ...draggedAgent, categoryId: targetCategoryId },
      ...targetAgents.slice(boundedInsertIndex),
    ]
    dragPreviewRef.current = { targetCategoryId, targetAgents: targetAgentsWithPreview }
  }

  const handleDragCancel = () => {
    setActiveAgent(null)
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
          toast.error(t('assistant.agentMoveFailed'))
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
        toast.error(t('assistant.systemCategoryCannotAddAgent'))
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
          toast.error(t('assistant.agentMoveFailed'))
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
      toast.error(t('assistant.systemCategoryCannotAddAgent'))
      return
    }

    // 系统助手不允许接收拖拽
    if (overAgent.agentLevel === 'system') {
      toast.error(t('assistant.systemAgentCannotDragIn'))
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
          toast.error(t('assistant.agentMoveFailed'))
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
          toast.error(t('assistant.agentSortFailed'))
          fetchData()
        }
      })
    }
  }

  // Filter helpers for grouped display
  const displayedGroupedData = groupedData

  // 系统协调助手由后端隐藏；可见系统分类仅展示群助手，并限制为快速对话入口。
  const { normalCategories, systemCategoryGroup } = displayedGroupedData ? {
    normalCategories: displayedGroupedData.categories.filter(cg => cg.category.id !== SYSTEM_CATEGORY_ID),
    systemCategoryGroup: displayedGroupedData.categories.find(cg => cg.category.id === SYSTEM_CATEGORY_ID) || null,
  } : { normalCategories: [], systemCategoryGroup: null }

  const matchesSearch = (agent: Agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agent.description?.toLowerCase().includes(searchQuery.toLowerCase())

  const filteredGroupedData = displayedGroupedData ? {
    categories: normalCategories
      .map(cg => ({
        category: cg.category,
        agents: cg.agents.filter(matchesSearch)
      })),
    systemCategory: systemCategoryGroup
      ? {
          category: systemCategoryGroup.category,
          agents: systemCategoryGroup.agents.filter(matchesSearch),
        }
      : null,
    uncategorized: displayedGroupedData.uncategorized.filter(matchesSearch)
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
            <span className="text-base font-semibold text-foreground">{t('nav.assistants')}</span>
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
                placeholder={t('assistant.searchAssistant')}
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
                  {t('assistant.createCategory')}
                </button>
                <button
                  onClick={() => fetchData()}
                  disabled={loading}
                  className="ta-button-secondary"
                >
                  <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
                  {t('common.refresh')}
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="ta-button-primary"
                >
                  <Plus className="size-4" />
                  {t('nav.createAssistant')}
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
                <p>{t('assistant.noAssistants')}</p>
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
                {/* Render system category - 显示在最上面，不支持拖拽 */}
                {filteredGroupedData.systemCategory && (
                  <DroppableCategoryArea
                    categoryId={filteredGroupedData.systemCategory.category.id}
                    isSystemCategory={true}
                  >
                    <div className="mb-6">
                      <CategoryToggleButton
                        expanded={expandedCategories.has(filteredGroupedData.systemCategory.category.id)}
                        label={filteredGroupedData.systemCategory.category.name}
                        count={filteredGroupedData.systemCategory.agents.length}
                        onClick={() => toggleCategoryExpansion(filteredGroupedData.systemCategory!.category.id)}
                        className="mb-3"
                      />
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
                              onCoordinatorLogs={openCoordinatorLogsDialog}
                              onClick={handleAgentClick}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </DroppableCategoryArea>
                )}

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
                            <CategoryToggleButton
                              expanded={expandedCategories.has(categoryGroup.category.id)}
                              label={categoryGroup.category.name}
                              count={categoryGroup.agents.length}
                              onClick={() => toggleCategoryExpansion(categoryGroup.category.id)}
                              className="gap-1"
                            />
                            {/* 移动端隐藏添加助手按钮 */}
                            {!isMobile && categoryGroup.category.id !== SYSTEM_CATEGORY_ID && (
                              <button
                                onClick={() => openCreateModalWithCategory(categoryGroup.category.id)}
                                className="ta-icon-button-compact opacity-70 hover:bg-primary/10 hover:text-primary hover:opacity-100"
                                title={t('assistant.addAssistant')}
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
                                  title={t('assistant.editCategoryName')}
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  onClick={() => openDeleteCategoryDialog(categoryGroup.category, categoryGroup.agents.length)}
                                  className="ta-icon-button-compact hover:bg-destructive/10 hover:text-destructive"
                                  title={t('assistant.deleteCategory')}
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
                {shouldRenderUncategorizedSection(
                  filteredGroupedData.uncategorized.length,
                  activeAgent?.categoryId
                ) && (
                  <DroppableCategoryArea
                    categoryId={null}
                    isSystemCategory={false}
                  >
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <CategoryToggleButton
                          expanded={expandedCategories.has('__uncategorized__')}
                          label={t('assistant.uncategorized')}
                          count={filteredGroupedData.uncategorized.length}
                          onClick={() => toggleCategoryExpansion('__uncategorized__')}
                        />
                        {/* 移动端隐藏添加助手按钮 */}
                        {!isMobile && (
                          <button
                            onClick={() => openCreateModalWithCategory(null)}
                            className="ta-icon-button-compact opacity-70 hover:bg-primary/10 hover:text-primary hover:opacity-100"
                            title={t('assistant.addAssistant')}
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
                <p>{t('assistant.noMatchingAssistants')}</p>
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
        key={`${editingAssistant?.id ?? 'none'}-${editMode}`}
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false)
          setEditingAssistant(null)
        }}
        onSubmit={editMode === 'copy' ? handleCreateAssistant : handleUpdateAssistant}
        assistant={editingAssistant}
        mode={editMode}
      />

      <SystemAssistantModelModal
        isOpen={systemModelModalOpen}
        assistant={systemModelAgent}
        onClose={() => {
          setSystemModelModalOpen(false)
          setSystemModelAgent(null)
        }}
        onSubmit={handleUpdateSystemAssistantModel}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t('assistant.deleteAssistantTitle')}
        description={t('assistant.deleteAssistantDesc', { name: deletingAssistant?.name })}
        confirmText={t('common.delete')}
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
        title={t('assistant.deleteCategoryTitle')}
        description={
          deletingCategoryAgentsCount > 0
            ? t('assistant.deleteCategoryDescAgents', { name: deletingCategory?.name, count: deletingCategoryAgentsCount })
            : t('assistant.deleteCategoryDesc', { name: deletingCategory?.name })
        }
        confirmText={t('common.delete')}
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

      {/* 调度日志弹框 */}
      <CoordinatorLogModal
        open={coordinatorLogModalOpen}
        onClose={() => setCoordinatorLogModalOpen(false)}
      />
    </>
  )
}
