import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  horizontalListSortingStrategy,
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
import { SystemAssistantModelModal, type SystemAssistantRuntimeConfig } from './system-assistant-model-modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FloatingMenu } from '@/components/ui/floating-menu'
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
const UNCATEGORIZED_TAB_KEY = '__uncategorized__'
const SEARCH_TAB_KEY = '__search__'

type SortOrderUpdate = { id: string; sortOrder: number; categoryId?: string | null }

// 分类 Tab 定义
type AssistantTab = {
  key: string
  categoryId: string | null // null 表示未分类
  name: string
  type: 'system' | 'normal' | 'uncategorized' | 'search'
  category?: AgentCategory
}

// 搜索结果：跨所有分类（含未分类）扁平化的全部助手
function getAllAgents(data: AgentsGrouped | null) {
  if (!data) return []
  return [...data.categories.flatMap(cg => cg.agents), ...data.uncategorized]
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

// 可拖拽排序的分类 Tab（仅普通分类）
function SortableCategoryTab({
  tab,
  isActive,
  onSelect,
  onContextMenu,
}: {
  tab: AssistantTab
  isActive: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.categoryId as string })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn(
        "touch-none whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors",
        isActive
          ? "bg-blue-500/10 font-semibold text-blue-600"
          : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {tab.name}
    </button>
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
  const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false)

  // 当前激活的分类 Tab
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null)
  // 分类 Tab 右键菜单（重命名/删除）
  const [tabMenu, setTabMenu] = useState<{ categoryId: string; x: number; y: number } | null>(null)

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

  // dnd-kit 状态（仅用于同组内排序）
  const [activeAgent, setActiveAgent] = useState<Agent | null>(null)
  const activeTabKeyRef = useRef<string | null>(null)

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

  const fetchData = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true

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
    fallbackLlmProviderIds: string[]
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
      fallbackLlmProviderIds: data.fallbackLlmProviderIds,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      const createdCategoryId = response.data?.categoryId ?? data.categoryId ?? null
      await fetchData()
      setSearchQuery('')
      setActiveTabKey(createdCategoryId ?? UNCATEGORIZED_TAB_KEY)
      setIsEditModalOpen(false)
      setEditingAssistant(null)
      setIsCreateModalOpen(false)
      return true
    } else {
      toast.error(response.error || t('assistant.createFailed'))
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
    fallbackLlmProviderIds: string[]
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
      fallbackLlmProviderIds: data.fallbackLlmProviderIds,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      await fetchData({ showLoading: false })
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
      await fetchData({ showLoading: false })
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
  }

  const handleDragCancel = () => {
    setActiveAgent(null)
  }

  const syncFlatAssistants = (updatedAgents: Agent[]) => {
    const updatedAgentMap = new Map(updatedAgents.map(agent => [agent.id, agent]))
    setAssistants(prev => prev.map(agent => updatedAgentMap.get(agent.id) || agent))
  }

  // dnd-kit 拖拽结束 - 仅支持同组内排序，不支持跨分类拖拽
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveAgent(null)

    if (!over || active.id === over.id) return

    const activeId = active.id as string
    const overId = over.id as string

    // 找到拖拽的助手
    const draggedAgent = (active.data.current?.agent as Agent | undefined)
      || findAgentInGroupedData(groupedData, activeId)
      || assistants.find(a => a.id === activeId)
    if (!draggedAgent || draggedAgent.agentLevel === 'system') return

    // 当前激活 Tab 对应的分类（同组内排序）
    const activeKey = activeTabKeyRef.current
    // 搜索结果 Tab 跨分类聚合，不支持排序
    if (!activeKey || activeKey === SYSTEM_CATEGORY_ID || activeKey === SEARCH_TAB_KEY) return
    const categoryId = activeKey === UNCATEGORIZED_TAB_KEY ? null : activeKey

    const agentsInCategory = getAgentsInCategory(groupedData, categoryId)
    const draggedIndex = agentsInCategory.findIndex(a => a.id === activeId)
    const targetIndex = agentsInCategory.findIndex(a => a.id === overId)

    if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return

    const reorderedAgents = withStableSortOrders(arrayMove(agentsInCategory, draggedIndex, targetIndex))

    // 乐观更新
    setGroupedData(prev => {
      if (!prev) return prev
      const newData = JSON.parse(JSON.stringify(prev))
      replaceAgentsInCategory(newData, categoryId, reorderedAgents)
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

  const matchesSearch = useCallback((agent: Agent) =>
    agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (agent.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false),
    [searchQuery]
  )

  // 拖拽排序分类 Tab（仅普通分类参与，系统/未分类/搜索固定位置）
  const handleCategoryTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !groupedData) return

    const normalCategories = groupedData.categories.filter(cg => cg.category.id !== SYSTEM_CATEGORY_ID)
    const oldIndex = normalCategories.findIndex(cg => cg.category.id === active.id)
    const newIndex = normalCategories.findIndex(cg => cg.category.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(normalCategories, oldIndex, newIndex)
    // 重新分配 sortOrder（升序，与后端 findAll orderBy asc 保持一致）
    const updates = reordered.map((cg, index) => ({ id: cg.category.id, sortOrder: (index + 1) * SORT_ORDER_STEP }))
    const sortOrderMap = new Map(updates.map(u => [u.id, u.sortOrder]))

    setGroupedData(prev => {
      if (!prev) return prev
      const systemGroups = prev.categories.filter(cg => cg.category.id === SYSTEM_CATEGORY_ID)
      const newNormals = reordered.map(cg => ({
        ...cg,
        category: { ...cg.category, sortOrder: sortOrderMap.get(cg.category.id) ?? cg.category.sortOrder },
      }))
      return { ...prev, categories: [...systemGroups, ...newNormals] }
    })

    categoryApi.updateSortOrder(updates).then(response => {
      if (!response.success) {
        toast.error(t('assistant.categorySortFailed', { defaultValue: '分类排序保存失败' }))
        fetchData()
      }
    })
  }

  // 可参与拖拽排序的普通分类 ID 列表
  const sortableCategoryIds = useMemo(
    () => (groupedData?.categories.filter(cg => cg.category.id !== SYSTEM_CATEGORY_ID).map(cg => cg.category.id)) ?? [],
    [groupedData]
  )

  // 构建分类 Tab 列表：系统分类（群助手）在最前，随后是普通分类，最后是未分类。
  const hasSearch = searchQuery.trim() !== ''
  const tabs = useMemo<AssistantTab[]>(() => {
    if (!groupedData) return []
    const result: AssistantTab[] = []
    // 有搜索条件时，在最前面加一个“搜索结果”Tab
    if (hasSearch) {
      const q = searchQuery.toLowerCase()
      const count = getAllAgents(groupedData).filter(
        a => a.name.toLowerCase().includes(q) || (a.description?.toLowerCase().includes(q) ?? false)
      ).length
      result.push({
        key: SEARCH_TAB_KEY,
        categoryId: null,
        name: `${t('assistant.searchResults', { defaultValue: '搜索结果' })} (${count})`,
        type: 'search',
      })
    }
    groupedData.categories
      .filter(cg => cg.category.id !== SYSTEM_CATEGORY_ID)
      .forEach(cg => {
        result.push({ key: cg.category.id, categoryId: cg.category.id, name: cg.category.name, type: 'normal', category: cg.category })
      })
    const systemGroup = groupedData.categories.find(cg => cg.category.id === SYSTEM_CATEGORY_ID)
    if (systemGroup) {
      result.push({ key: systemGroup.category.id, categoryId: systemGroup.category.id, name: systemGroup.category.name, type: 'system' })
    }
    if (groupedData.uncategorized.length > 0) {
      result.push({ key: UNCATEGORIZED_TAB_KEY, categoryId: null, name: t('assistant.uncategorized'), type: 'uncategorized' })
    }
    return result
  }, [groupedData, t, hasSearch, searchQuery])

  // 进入/退出搜索时切换激活 Tab：开始搜索切到“搜索结果”，清空搜索回到第一个分类
  useEffect(() => {
    if (hasSearch) {
      setActiveTabKey(SEARCH_TAB_KEY)
    } else {
      setActiveTabKey(prev => (prev === SEARCH_TAB_KEY ? null : prev))
    }
  }, [hasSearch])

  // 保证当前激活的 Tab 始终有效
  useEffect(() => {
    if (tabs.length === 0) return
    if (!activeTabKey || !tabs.some(tab => tab.key === activeTabKey)) {
      setActiveTabKey(tabs[0].key)
    }
  }, [tabs, activeTabKey])

  const activeTab = tabs.find(tab => tab.key === activeTabKey) ?? tabs[0] ?? null
  useEffect(() => {
    activeTabKeyRef.current = activeTab?.key ?? null
  }, [activeTab?.key])

  // 当前 Tab 下经过搜索过滤的助手；“搜索结果”Tab 展示跨分类的全部匹配项
  const activeAgents = activeTab
    ? (activeTab.type === 'search'
        ? getAllAgents(groupedData).filter(matchesSearch)
        : getAgentsInCategory(groupedData, activeTab.categoryId).filter(matchesSearch))
    : []

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
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={t('common.clear', { defaultValue: '清除' })}
                >
                  <X className="size-3" />
                </button>
              )}
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
            ) : tabs.length > 0 && activeTab ? (
              <>
                {/* 分类 Tab 栏（药丸样式，普通分类支持拖拽排序 + 右键重命名/删除） */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleCategoryTabDragEnd}
                >
                  <SortableContext items={sortableCategoryIds} strategy={horizontalListSortingStrategy}>
                    <div className="mb-5 flex items-center gap-1.5 overflow-x-auto pb-1">
                      {tabs.map((tab) => {
                        const isActive = tab.key === activeTab.key

                        // 普通分类正在重命名：内联输入框
                        if (tab.type === 'normal' && editingCategoryId === tab.categoryId) {
                          return (
                            <div key={tab.key} className="flex items-center gap-1 px-1">
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
                                className="ta-input h-8 w-28 rounded-full px-3 py-0.5 text-sm shadow-none"
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
                          )
                        }

                        // 普通分类：可拖拽排序
                        if (tab.type === 'normal' && tab.categoryId) {
                          return (
                            <SortableCategoryTab
                              key={tab.key}
                              tab={tab}
                              isActive={isActive}
                              onSelect={() => setActiveTabKey(tab.key)}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setActiveTabKey(tab.key)
                                setTabMenu({ categoryId: tab.categoryId!, x: e.clientX, y: e.clientY })
                              }}
                            />
                          )
                        }

                        // 系统/未分类/搜索：固定位置，不可拖拽
                        return (
                          <button
                            key={tab.key}
                            onClick={() => setActiveTabKey(tab.key)}
                            className={cn(
                              "whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors",
                              isActive
                                ? "bg-blue-500/10 font-semibold text-blue-600"
                                : "font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            )}
                          >
                            {tab.name}
                          </button>
                        )
                      })}

                      {/* 末尾的添加分类按钮 */}
                      <button
                        type="button"
                        onClick={() => setIsCreateCategoryModalOpen(true)}
                        title={t('assistant.createCategory')}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 transition-colors hover:bg-blue-500/20"
                      >
                        <Plus className="size-4" />
                      </button>
                    </div>
                  </SortableContext>
                </DndContext>

                {/* 当前分类下的助手网格 */}
                {activeAgents.length === 0 && (activeTab.type === 'system' || searchQuery.trim() !== '') ? (
                  <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    {searchQuery.trim() !== '' ? (
                      <>
                        <Search className="size-12 mb-2" />
                        <p>{t('assistant.noMatchingAssistants')}</p>
                      </>
                    ) : (
                      <>
                        <Bot className="size-12 mb-2" />
                        <p>{t('assistant.noAssistants')}</p>
                      </>
                    )}
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragCancel={handleDragCancel}
                  >
                    <SortableContext
                      items={activeAgents.map(a => a.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div
                        className="grid gap-4"
                        style={
                          isMobile
                            ? { gridTemplateColumns: '1fr' }
                            : { gridTemplateColumns: 'repeat(auto-fill, minmax(max(280px, calc((100% - 4rem) / 5)), 1fr))' }
                        }
                      >
                        {/* 添加助手块 - 系统分类/搜索结果不显示，放在最前面 */}
                        {activeTab.type !== 'system' && activeTab.type !== 'search' && (
                          <button
                            onClick={() => openCreateModalWithCategory(activeTab.categoryId)}
                            className="group flex h-[180px] w-full max-w-[360px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 p-5 text-muted-foreground transition-all duration-200 hover:border-blue-500 hover:text-blue-500"
                            title={t('assistant.addAssistant')}
                          >
                            <div className="flex size-12 items-center justify-center rounded-full border border-dashed border-border transition-colors group-hover:border-blue-500">
                              <Plus className="size-6" />
                            </div>
                            <span className="text-sm">{t('assistant.addAssistant')}</span>
                          </button>
                        )}

                        {activeAgents.map((assistant) => (
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
                                setContextMenuPosition(pos ?? null)
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
                    </SortableContext>

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
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Search className="size-12 mb-2" />
                <p>{t('assistant.noMatchingAssistants')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 分类 Tab 右键菜单 */}
      {tabMenu && (() => {
        const group = groupedData?.categories.find(cg => cg.category.id === tabMenu.categoryId)
        if (!group) return null
        return (
          <FloatingMenu
            open
            x={tabMenu.x}
            y={tabMenu.y}
            onClose={() => setTabMenu(null)}
            className="min-w-32 p-1"
          >
            <button
              onClick={() => {
                startEditCategoryName(group.category.id, group.category.name)
                setTabMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              <Pencil className="size-3.5" />
              {t('assistant.editCategoryName')}
            </button>
            <button
              onClick={() => {
                openDeleteCategoryDialog(group.category, group.agents.length)
                setTabMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" />
              {t('assistant.deleteCategory')}
            </button>
          </FloatingMenu>
        )
      })()}

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
