import { ArrowLeft, ChevronLeft, ClipboardList, Eraser, Loader2, MoreVertical, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Route, Routes, useNavigate, useSearchParams, useParams } from 'react-router-dom'
import { LoginModal } from './components/auth/login-modal'
import { RegisterModal } from './components/auth/register-modal'
import { AssistantDetailPage } from './components/chat/assistant-detail'
import { AssistantPage } from './components/chat/assistant-page'
import { ChatArea } from './components/chat/chat-area'
import { ConversationList } from './components/chat/conversation-list'
import { CreateGroupModal } from './components/chat/create-group-modal'
import { MobileTabBar } from './components/chat/mobile-tab-bar'
import { IntegrationPage } from './components/chat/integration-page'
import { ModelPage } from './components/chat/model-page'
import { SkillPage } from './components/chat/skill-page'
import { SidebarNav } from './components/chat/sidebar-nav'
import { SettingsPage } from './components/chat/settings-page'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { Toaster } from './components/ui/sonner'
import { WindowTitleBar } from './components/ui/window-title-bar'
import { useIsMobile } from './hooks/use-mobile'
import { playMessageSound } from './lib/message-sound'
import { cn } from './lib/utils'
import { SetupWizard } from './components/setup/setup-wizard'
import { UpdateNotification } from './components/update/update-notification'
import { isElectron, waitForServer } from './lib/config'
import { ChatRoom } from './lib/agent-api'
import { useAuthStore, useChatRoomStore, useSocketStore, useUIStore } from './stores'
import { useChatStore } from './stores/chat-store'
import { TodoData } from './stores/socket-store'

// 移动端群聊列表页面
function MobileChatListPage({
  chatRooms,
  unreadCounts,
  executingChatRooms,
  onRefresh,
  isRefreshing,
  onSelectRoom,
}: {
  chatRooms: ChatRoom[]
  unreadCounts: Record<string, number>
  executingChatRooms: Set<string>
  onRefresh: () => void
  isRefreshing: boolean
  onSelectRoom: (id: string) => void
}) {
  const navigate = useNavigate()

  const handleSelectRoom = (roomId: string) => {
    onSelectRoom(roomId)
    navigate(`/chat/${roomId}`)
  }

  return (
    <div className="flex flex-1 flex-col pb-14 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 h-12 shrink-0">
        <h1 className="text-lg font-semibold">消息</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 群聊列表 */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <ConversationList
          chatRooms={chatRooms}
          selectedId={null}
          onSelect={handleSelectRoom}
          unreadCounts={unreadCounts}
          executingChatRooms={executingChatRooms}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          isMobile={true}
        />
      </div>
    </div>
  )
}

// 移动端聊天详情页面
function MobileChatDetailPage({
  chatRooms,
  onChatRoomChange,
  onDeleteChatRoom,
  unreadCounts,
}: {
  chatRooms: ChatRoom[]
  onChatRoomChange: () => void
  onDeleteChatRoom: (chatRoomId: string) => void
  unreadCounts: Record<string, number>
}) {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const selectedRoom = chatRooms.find(room => room.id === roomId)
  const unreadCount = roomId ? (unreadCounts[roomId] || 0) : 0

  // 从 store 获取操作函数
  const setSidePanelMode = useChatStore((s) => s.setSidePanelMode)
  const setShowClearConfirm = useChatStore((s) => s.setShowClearConfirm)

  const handleBack = () => {
    navigate('/')
  }

  const handleOpenTaskBoard = () => {
    setSidePanelMode('task-board')
  }

  if (!selectedRoom) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center border-b border-border px-4 h-12 shrink-0">
          <button
            onClick={handleBack}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
          >
            <ArrowLeft className="size-5" />
          </button>
          <span className="ml-2 text-base font-medium">群聊不存在</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          群聊不存在或已被删除
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center border-b border-border px-4 h-12 shrink-0">
        {/* 左侧：返回按钮 */}
        <div className="w-10">
          <button
            onClick={handleBack}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        {/* 中间：未读数 + 群聊名称（居中） */}
        <div className="flex-1 flex items-center justify-center gap-2">
          {unreadCount > 0 && (
            <span className="flex items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs text-white min-w-[20px]">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          <span className="text-base font-medium">{selectedRoom.name}</span>
        </div>

        {/* 右侧：更多菜单 */}
        <div className="w-10 flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent">
                <MoreVertical className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* 移动端只保留任务看板和清空消息 */}
              <DropdownMenuItem onClick={handleOpenTaskBoard}>
                <ClipboardList className="size-4 mr-2" />
                任务看板
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowClearConfirm(true)}>
                <Eraser className="size-4 mr-2" />
                清空消息
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 聊天区域 */}
      <div className="flex flex-1 min-h-0">
        <ChatArea
          chatRoom={selectedRoom}
          onChatRoomChange={onChatRoomChange}
          onDeleteChatRoom={onDeleteChatRoom}
          isMobile={true}
        />
      </div>
    </div>
  )
}

// 桌面端消息页面
function DesktopMessagePage({
  chatRooms,
  selectedRoomId,
  onSelectRoom,
  onChatRoomChange,
  unreadCounts,
  executingChatRooms,
  onRefresh,
  isRefreshing,
  onDeleteChatRoom,
  onCreateChatRoom,
}: {
  chatRooms: ChatRoom[]
  selectedRoomId: string | null
  onSelectRoom: (id: string) => void
  onChatRoomChange: () => void
  unreadCounts: Record<string, number>
  executingChatRooms: Set<string>
  onRefresh: () => void
  isRefreshing: boolean
  onDeleteChatRoom: (chatRoomId: string) => void
  onCreateChatRoom: () => void
}) {
  const selectedRoom = chatRooms.find(room => room.id === selectedRoomId)

  return (
    <>
      {/* Conversation list */}
      <ConversationList
        chatRooms={chatRooms}
        selectedId={selectedRoomId}
        onSelect={onSelectRoom}
        unreadCounts={unreadCounts}
        executingChatRooms={executingChatRooms}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onDeleteChatRoom={onDeleteChatRoom}
        onCreateChatRoom={onCreateChatRoom}
      />

      {/* Main chat area */}
      <ChatArea
        chatRoom={selectedRoom}
        onChatRoomChange={onChatRoomChange}
        onDeleteChatRoom={onDeleteChatRoom}
        isMobile={false}
      />
    </>
  )
}

function AppContent() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const chatRooms = useChatRoomStore((s) => s.chatRooms)
  const selectedRoomId = useChatRoomStore((s) => s.selectedRoomId)
  const loadChatRooms = useChatRoomStore((s) => s.loadChatRooms)
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const addRoom = useChatRoomStore((s) => s.addRoom)
  const updateRoomLastMessage = useChatRoomStore((s) => s.updateRoomLastMessage)
  const unreadCounts = useChatStore((s) => s.unreadCounts)
  const setUnreadCounts = useChatStore((s) => s.setUnreadCounts)
  const updateUnreadCount = useChatStore((s) => s.updateUnreadCount)
  const executingChatRooms = useChatStore((s) => s.executingChatRooms)
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId)
  const { isConnected, onUnreadUpdate, requestUnreadCounts, requestTodos, onTodoList, onTodoCreated, onTodoUpdated, onMessage, onChatRoomCreated, user: socketUser } = useSocketStore()
  const { user } = useAuthStore()

  // 刷新状态
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 刷新群聊列表
  const handleRefreshChatRooms = async () => {
    setIsRefreshing(true)
    try {
      await loadChatRooms()
    } finally {
      setIsRefreshing(false)
    }
  }

  // 删除群聊后的处理
  const handleDeleteChatRoom = (_chatRoomId: string) => {
    // 刷新群聊列表（选中状态已在 ConversationList 中处理）
    loadChatRooms()
  }

  // 创建群聊状态
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)

  // 打开创建群聊对话框
  const handleCreateGroup = () => {
    setIsCreateGroupOpen(true)
  }

  // 导航到群聊
  const handleNavigateToChatRoom = async (roomId: string) => {
    // 先刷新群聊列表，确保新创建的群聊已加载
    await loadChatRooms()
    selectRoom(roomId)
    navigate('/')
  }

  // 加载聊天室列表
  useEffect(() => {
    loadChatRooms()
  }, [loadChatRooms])

  // 全局消息监听 - 更新群聊列表的 lastMessage + 播放提示音
  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = onMessage((msg) => {
      // 更新群聊的 lastMessage
      updateRoomLastMessage(msg.chatRoomId, {
        id: msg.id,
        content: msg.content,
        time: typeof msg.time === 'string' ? msg.time : new Date(msg.time).toISOString(),
        isHuman: msg.isHuman ?? true,
        userId: msg.userId ?? null,
        agentId: msg.agentId ?? null,
        user: msg.isHuman && msg.userId ? { id: msg.userId, username: msg.user ?? '用户' } : null,
        agent: msg.agentId && msg.agentName ? { id: msg.agentId, name: msg.agentName } : null,
      })

      // 收到 Agent 回复时播放提示音
      if (msg.agentId) {
        playMessageSound()
      }
    })
    return unsubscribe
  }, [isConnected, onMessage, updateRoomLastMessage])

  // 监听新群聊创建事件（其他端创建的群聊会同步过来）
  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = onChatRoomCreated((data) => {
      // 检查群聊是否已存在（避免重复添加）
      if (!chatRooms.some(room => room.id === data.chatRoom.id)) {
        addRoom(data.chatRoom as ChatRoom)
      }
    })
    return unsubscribe
  }, [isConnected, onChatRoomCreated, chatRooms, addRoom])

  // 处理 URL 参数中的 room 参数
  useEffect(() => {
    const roomId = searchParams.get('room')
    const msgId = searchParams.get('msg')
    if (roomId && chatRooms.length > 0) {
      // 检查该群聊是否存在
      const roomExists = chatRooms.some(room => room.id === roomId)
      if (roomExists && selectedRoomId !== roomId) {
        selectRoom(roomId)
      }
      // 如果有 msg 参数，设置滚动定位
      if (msgId) {
        setScrollToMessageId(msgId)
      }
      // 清除 URL 参数
      setSearchParams({})
    }
  }, [searchParams, chatRooms, selectedRoomId, selectRoom, setSearchParams, setScrollToMessageId])

  // 监听未读数更新事件 - 需要在 socket 连接后设置
  useEffect(() => {
    if (!isConnected) return

    const unsubscribe = onUnreadUpdate((data) => {
      if (data.unreadCounts) {
        // 批量更新所有未读数
        setUnreadCounts(data.unreadCounts)
      } else if (data.chatRoomId && data.count !== undefined) {
        // 如果是当前选中的群聊，不显示未读数
        if (data.chatRoomId === selectedRoomId) {
          updateUnreadCount(data.chatRoomId, 0)
        } else {
          updateUnreadCount(data.chatRoomId, data.count)
        }
      }
    })
    return unsubscribe
  }, [isConnected, onUnreadUpdate, setUnreadCounts, updateUnreadCount, selectedRoomId])

  // 切换群聊时重新请求未读数
  useEffect(() => {
    if (isConnected && selectedRoomId) {
      requestUnreadCounts()
    }
  }, [isConnected, selectedRoomId, requestUnreadCounts])

  // 连接成功后请求未读数
  useEffect(() => {
    if (isConnected) {
      requestUnreadCounts()
      requestTodos()
    }
  }, [isConnected, requestUnreadCounts, requestTodos])

  // 监听待办事件
  useEffect(() => {
    if (!isConnected) return

    const unsubList = onTodoList((data) => {
      useSocketStore.setState({ todos: data.todos })
    })

    const unsubCreated = onTodoCreated((todo: TodoData) => {
      const currentTodos = useSocketStore.getState().todos
      // 避免重复添加
      if (!currentTodos.some((t) => t.id === todo.id)) {
        useSocketStore.setState({ todos: [todo, ...currentTodos] })
      }
    })

    const unsubUpdated = onTodoUpdated((data) => {
      const currentTodos = useSocketStore.getState().todos
      useSocketStore.setState({ todos: currentTodos.filter((t) => t.id !== data.todoId) })
    })

    return () => {
      unsubList()
      unsubCreated()
      unsubUpdated()
    }
  }, [isConnected, onTodoList, onTodoCreated, onTodoUpdated])

  // 计算总未读数
  const totalUnreadCount = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0)

  // 移动端导航到群聊
  const handleMobileNavigateToChatRoom = (roomId: string) => {
    selectRoom(roomId)
  }

  return (
    <div className={cn("flex flex-1 h-full w-full bg-[var(--surface)] text-foreground", isMobile ? "overflow-x-hidden" : "overflow-hidden")}>
      {/* 桌面端 Sidebar navigation */}
      {!isMobile && <SidebarNav messageBadge={totalUnreadCount} onRefreshChatRooms={loadChatRooms} />}

      {/* Content based on route */}
      <Routes>
        {/* 桌面端消息页面 */}
        <Route path="/" element={
          isMobile ? (
            <MobileChatListPage
              chatRooms={chatRooms}
              unreadCounts={unreadCounts}
              executingChatRooms={executingChatRooms}
              onRefresh={handleRefreshChatRooms}
              isRefreshing={isRefreshing}
              onSelectRoom={handleMobileNavigateToChatRoom}
            />
          ) : (
            <DesktopMessagePage
              chatRooms={chatRooms}
              selectedRoomId={selectedRoomId}
              onSelectRoom={selectRoom}
              onChatRoomChange={loadChatRooms}
              unreadCounts={unreadCounts}
              executingChatRooms={executingChatRooms}
              onRefresh={handleRefreshChatRooms}
              isRefreshing={isRefreshing}
              onDeleteChatRoom={handleDeleteChatRoom}
              onCreateChatRoom={handleCreateGroup}
            />
          )
        } />
        {/* 移动端聊天详情页面 */}
        <Route path="/chat/:roomId" element={
          <MobileChatDetailPage
            chatRooms={chatRooms}
            onChatRoomChange={loadChatRooms}
            onDeleteChatRoom={handleDeleteChatRoom}
            unreadCounts={unreadCounts}
          />
        } />
        <Route path="/assistant" element={<AssistantPage onNavigateToChatRoom={handleNavigateToChatRoom} isMobile={isMobile} />} />
        <Route path="/assistant/:id" element={<AssistantDetailPage />} />
        <Route path="/skill" element={<SkillPage />} />
        <Route path="/model" element={<ModelPage />} />
        <Route path="/integration" element={<IntegrationPage />} />
        <Route path="/settings" element={<SettingsPage isMobile={isMobile} />} />
      </Routes>

      {/* 移动端底部 Tab */}
      {isMobile && <MobileTabBar messageBadge={totalUnreadCount} />}

      {/* 创建群聊对话框 */}
      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        onSuccess={(chatRoomId) => {
          loadChatRooms()
          selectRoom(chatRoomId)
        }}
        ownerId={user?.id || socketUser?.id}
      />
    </div>
  )
}

export default function App() {
  const { state, isFirstUse, setupCompleted, login, register, token, checkAuth, setupLogin, setSetupCompleted } = useAuthStore()
  const { connect, disconnect, isConnected } = useSocketStore()
  const { showLogin, showRegister, setShowLogin, setShowRegister } = useUIStore()

  // Track if we've already connected
  const hasConnectedRef = useRef(false)
  // Track if connection was lost after being connected
  const [showDisconnectedBanner, setShowDisconnectedBanner] = useState(false)

  // Electron 环境下等待后端服务就绪
  const [serverState, setServerState] = useState<'waiting' | 'ready' | 'error'>(
    isElectron() ? 'waiting' : 'ready'
  )
  const [serverError, setServerError] = useState('')

  useEffect(() => {
    if (serverState !== 'waiting') return
    waitForServer()
      .then(() => setServerState('ready'))
      .catch((err) => {
        setServerError(err.message || '服务启动失败')
        setServerState('error')
      })
  }, [serverState])

  // Check auth once server is ready
  useEffect(() => {
    if (serverState === 'ready') {
      checkAuth()
    }
  }, [serverState, checkAuth])

  // Connect socket when authenticated
  useEffect(() => {
    if (state === 'authenticated' && token && !isConnected && !hasConnectedRef.current) {
      hasConnectedRef.current = true
      connect(token)
    } else if (state === 'unauthenticated' && hasConnectedRef.current) {
      hasConnectedRef.current = false
      disconnect()
    }
  }, [state, token, isConnected, connect, disconnect])

  // Show disconnected banner when connection is lost
  useEffect(() => {
    if (isConnected) {
      setShowDisconnectedBanner(false)
    } else if (hasConnectedRef.current && state === 'authenticated') {
      // Connection was lost after being connected
      setShowDisconnectedBanner(true)
    }
  }, [isConnected, state])

  // Show register modal for first time users
  useEffect(() => {
    if (state === 'unauthenticated' && isFirstUse) {
      setShowRegister(true)
      setShowLogin(false)
    } else if (state === 'unauthenticated' && !isFirstUse) {
      setShowLogin(true)
      setShowRegister(false)
    } else {
      setShowLogin(false)
      setShowRegister(false)
    }
  }, [state, isFirstUse, setShowLogin, setShowRegister])

  const handleLogin = async (username: string, password: string) => {
    return login(username, password)
  }

  const handleRegister = async (
    username: string,
    password: string,
    avatar?: string,
  ) => {
    return register(username, password, avatar)
  }

  const handleSwitchToRegister = () => {
    setShowLogin(false)
    setShowRegister(true)
  }

  const forceSetup = typeof window !== 'undefined' && localStorage.getItem('force_setup_wizard') === 'true'
  const showSetupWizard = isElectron() && state !== 'checking' && (forceSetup || (isFirstUse && !setupCompleted))

  // Electron: 等待后端服务启动
  if (serverState === 'waiting') {
    return (
      <div className="flex flex-col h-screen w-full bg-background">
        <WindowTitleBar />
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-6 animate-spin text-primary" />
            正在启动服务...
          </div>
        </div>
      </div>
    )
  }

  // Electron: 服务启动失败
  if (serverState === 'error') {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    return (
      <div className="flex flex-col h-screen w-full bg-background">
        <WindowTitleBar />
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <div className="flex flex-col items-center gap-4 max-w-2xl w-full text-center">
            <div className="text-lg font-semibold text-foreground">服务启动失败</div>
            <pre className="text-xs text-left whitespace-pre-wrap break-words bg-muted/50 border border-border rounded-lg p-3 max-h-80 overflow-auto w-full">
              {serverError || '未知错误'}
            </pre>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setServerError(''); setServerState('waiting') }}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
              >
                重试
              </button>
              {electronAPI?.openLogFolder && (
                <button
                  onClick={() => electronAPI.openLogFolder()}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  打开日志文件夹
                </button>
              )}
              <button
                onClick={() => {
                  if (serverError && navigator.clipboard) {
                    navigator.clipboard.writeText(serverError).catch(() => {})
                  }
                }}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                复制错误
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show loading state while checking auth
  if (state === 'checking') {
    return (
      <div className="flex flex-col h-screen w-full bg-[var(--surface)]">
        {/* Windows 自定义标题栏 */}
        <WindowTitleBar />
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-6 animate-spin text-primary" />
            加载中...
          </div>
        </div>
      </div>
    )
  }

  // 桌面版首次引导
  if (showSetupWizard) {
    return (
      <div className="flex flex-col h-screen w-full bg-background">
        <WindowTitleBar />
        <SetupWizard
          onComplete={(data) => {
            setupLogin(data)
            localStorage.removeItem('force_setup_wizard')
          }}
          onSkip={() => {
            setSetupCompleted(true)
            localStorage.removeItem('force_setup_wizard')
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[var(--surface)]">
      {/* Windows 自定义标题栏 */}
      <WindowTitleBar />

      {/* 服务断开连接提示 */}
      {showDisconnectedBanner && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-white text-sm">
          <Loader2 className="size-4 animate-spin" />
          <span>服务已关闭，正在尝试重新连接...</span>
        </div>
      )}

      <UpdateNotification />

      <AppContent />

      {/* Login Modal */}
      <LoginModal
        isOpen={showLogin}
        onLogin={handleLogin}
        onSwitchToRegister={handleSwitchToRegister}
      />

      {/* Register Modal */}
      <RegisterModal
        isOpen={showRegister}
        onRegister={handleRegister}
      />

      {/* Toast notifications */}
      <Toaster />
    </div>
  )
}
