
import { CreateAssistantModal } from '@/components/chat/create-assistant-modal'
import { CreateGroupModal } from '@/components/chat/create-group-modal'
import { TodoModal } from '@/components/chat/todo-modal'
import { UserAvatar } from '@/components/chat/user-avatar'
import { useTheme } from '@/components/theme-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { agentApi } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { useAuthStore, useSocketStore } from '@/stores'
import { useChatStore } from '@/stores/chat-store'
import { TodoData } from '@/stores/socket-store'
import { Bot, Check, Cpu, Globe, ListTodo, MessageSquare, Monitor, Moon, Package, Palette, Plus, Sun, Users } from 'lucide-react'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

interface SidebarNavProps {
  messageBadge?: number
  onRefreshChatRooms?: () => void
}

export function SidebarNav({ messageBadge, onRefreshChatRooms }: SidebarNavProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)
  const [isCreateAssistantOpen, setIsCreateAssistantOpen] = useState(false)
  const [isTodoModalOpen, setIsTodoModalOpen] = useState(false)
  const { user } = useAuthStore()
  const { user: socketUser, todos } = useSocketStore()
  const { theme, setTheme, brandTheme, setBrandTheme } = useTheme()
  const setSidePanelMode = useChatStore((s) => s.setSidePanelMode)

  const activeTab = location.pathname.startsWith('/settings')
    ? null
    : location.pathname.startsWith('/assistant')
      ? 'assistant'
      : location.pathname.startsWith('/skill')
        ? 'skill'
        : location.pathname.startsWith('/model')
          ? 'model'
          : location.pathname.startsWith('/integration')
            ? 'integration'
            : 'message'
  const currentUser = user || socketUser

  // 待办数量
  const todoCount = todos.filter(t => t.status === 'pending').length

  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false
  const isMac = isElectron && /mac/i.test(navigator.platform)
  const modeOptions = [
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
    { value: 'system', label: '跟随系统', icon: Monitor },
  ] as const
  const brandOptions = [
    { value: 'enterprise', label: '商务蓝', color: 'oklch(0.55 0.22 250)' },
    { value: 'graphite', label: '石墨灰', color: 'oklch(0.36 0.018 260)' },
    { value: 'emerald', label: '翡翠绿', color: 'oklch(0.55 0.16 158)' },
    { value: 'ruby', label: '曜石红', color: 'oklch(0.55 0.2 18)' },
  ] as const

  const handleTabChange = (tab: 'message' | 'assistant' | 'skill' | 'model' | 'integration') => {
    // 切换 Tab 时关闭侧拉框
    setSidePanelMode(null)
    if (tab === 'message') {
      navigate('/')
    } else {
      navigate(`/${tab}`)
    }
  }

  const handleCreateAssistant = async (data: {
    name: string
    avatarIndex: number
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    categoryId: string | null
    llmProviderId: string | null
    imageGeneration?: { enabled: boolean; llmProviderId: string | null }
  }): Promise<boolean> => {
    const response = await agentApi.create({
      name: data.name,
      avatar: String(data.avatarIndex),
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      categoryId: data.categoryId || undefined,
      llmProviderId: data.llmProviderId || undefined,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      setIsCreateAssistantOpen(false)
      return true
    } else {
      toast.error(response.error || '创建失败')
      return false
    }
  }

  return (
    <div
      className="flex h-full w-20 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar/95 shadow-[var(--control-shadow)] backdrop-blur"
      style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
    >
      {/* Logo area - 拖拽区域 */}
      <div className={cn(
        "mb-4 flex size-10 items-center justify-center overflow-hidden rounded-xl border border-sidebar-border bg-[var(--surface-raised)] shadow-[var(--control-shadow)]",
        isMac ? "mt-10" : "mt-4"
      )}>
        <img src={`${import.meta.env.BASE_URL}app-logo.png`} alt="TeamAgentX" className="size-full object-cover" />
      </div>

      {/* Nav items */}
      <div className="flex w-full flex-1 flex-col items-center gap-1 px-2 pb-4 select-none">
        {/* 加号按钮 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg py-2 text-muted-foreground hover:bg-sidebar-accent transition-colors focus:outline-none"
              style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
            >
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--control-shadow)]">
                <Plus className="size-4" />
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            <DropdownMenuItem onClick={() => setIsCreateGroupOpen(true)}>
              <Users className="size-4" />
              创建群组
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsCreateAssistantOpen(true)}>
              <Bot className="size-4" />
              创建助手
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleTabChange('model')}>
              <Cpu className="size-4" />
              模型管理
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 消息 Tab */}
        <button
          onClick={() => handleTabChange('message')}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            activeTab === 'message'
              ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
              : 'text-muted-foreground hover:bg-sidebar-accent'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <MessageSquare className="size-5" />
          <span className="text-xs">消息</span>
          {!!messageBadge && messageBadge > 0 && (
            <span className="absolute right-3 top-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white">
              {messageBadge > 99 ? '99' : messageBadge}
            </span>
          )}
        </button>

        {/* 助手 Tab */}
        <button
          onClick={() => handleTabChange('assistant')}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            activeTab === 'assistant'
              ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
              : 'text-muted-foreground hover:bg-sidebar-accent'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Bot className="size-5" />
          <span className="text-xs">助手</span>
        </button>

        {/* 技能 Tab */}
        <button
          onClick={() => handleTabChange('skill')}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            activeTab === 'skill'
              ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
              : 'text-muted-foreground hover:bg-sidebar-accent'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Package className="size-5" />
          <span className="text-xs">技能</span>
        </button>

        {/* 模型 Tab */}
        <button
          onClick={() => handleTabChange('model')}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            activeTab === 'model'
              ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
              : 'text-muted-foreground hover:bg-sidebar-accent'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Cpu className="size-5" />
          <span className="text-xs">模型</span>
        </button>

        {/* 集成 Tab */}
        <button
          onClick={() => handleTabChange('integration')}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            activeTab === 'integration'
              ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
              : 'text-muted-foreground hover:bg-sidebar-accent'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Globe className="size-5" />
          <span className="text-xs">集成</span>
        </button>

        {/* 待办按钮 */}
        <button
          onClick={() => setIsTodoModalOpen(true)}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            'text-muted-foreground hover:bg-sidebar-accent'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <ListTodo className="size-5" />
          <span className="text-xs">待办</span>
          {todoCount > 0 && (
            <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-orange-500 text-[10px] text-white">
              {todoCount > 99 ? '99' : todoCount}
            </span>
          )}
        </button>

        {/* 中间空白区域 - 可拖拽 */}
      </div>

      {/* Bottom buttons */}
      <div className="flex flex-col items-center gap-1 pb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              title="外观主题"
              style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
            >
              <Palette className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="end"
            className="w-48"
            style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            {modeOptions.map((option) => {
              const Icon = option.icon
              return (
                <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
                  <Icon className="size-4" />
                  <span>{option.label}</span>
                  {theme === option.value && <Check className="ml-auto size-4 text-primary" />}
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            {brandOptions.map((option) => (
              <DropdownMenuItem key={option.value} onClick={() => setBrandTheme(option.value)}>
                <span className="size-2.5 rounded-full" style={{ background: option.color }} />
                <span>{option.label}</span>
                {brandTheme === option.value && <Check className="ml-auto size-4 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User avatar - 跳转到设置 */}
        <button
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent"
          onClick={() => navigate('/settings')}
          title="设置"
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          {currentUser ? (
            <UserAvatar avatar={currentUser.avatar} size="sm" />
          ) : (
            <div className="flex size-7 items-center justify-center rounded-full bg-linear-to-br from-green-400 to-green-600 text-xs text-white">
              U
            </div>
          )}
        </button>
      </div>

      {/* Create Group Modal */}
      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        onSuccess={(chatRoomId) => {
          onRefreshChatRooms?.()
          // 导航到新创建的群聊
          navigate(`/?room=${chatRoomId}`)
        }}
        ownerId={currentUser?.id}
      />

      {/* Create Assistant Modal */}
      <CreateAssistantModal
        isOpen={isCreateAssistantOpen}
        onClose={() => setIsCreateAssistantOpen(false)}
        onSubmit={handleCreateAssistant}
      />

      {/* Todo Modal */}
      <TodoModal
        isOpen={isTodoModalOpen}
        onClose={() => setIsTodoModalOpen(false)}
        onTodoClick={(todo: TodoData) => {
          // 跳转到对应群聊并定位消息
          navigate(`/?room=${todo.chatRoomId}&msg=${todo.messageId}`)
        }}
      />
    </div>
  )
}
