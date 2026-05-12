
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
    })
    if (response.success) {
      setIsCreateAssistantOpen(false)
      return true
    } else {
      toast.error(response.error || '创建失败')
      return false
    }
  }

  const navItems = [
    { id: 'message' as const, icon: MessageSquare, label: '消息' },
    { id: 'assistant' as const, icon: Bot, label: '助手' },
    { id: 'skill' as const, icon: Package, label: '技能' },
    { id: 'model' as const, icon: Cpu, label: '模型' },
  ]

  return (
    <div
      className="flex h-full w-[80px] shrink-0 flex-col items-center border-r border-border bg-sidebar"
      style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
    >
      {/* Logo area */}
      <div className={cn(
        "flex items-center justify-center",
        isElectron ? "mt-[24px]" : "mt-3"
      )}>
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-lg bg-white">
          <img src={`${import.meta.env.BASE_URL}app-logo.png`} alt="TeamAgentX" className="size-full object-cover" />
        </div>
      </div>

      {/* New button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="mt-4 mb-1 flex size-7 items-center justify-center rounded bg-primary text-primary-foreground shadow-[0_2px_8px_oklch(0.55_0.22_250/0.18)] hover:opacity-90 transition-opacity"
            style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            <Plus className="size-3.5" strokeWidth={2.5} />
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

      {/* Divider */}
      <div className="my-1 h-px w-6 bg-border/60" />

      {/* Nav items */}
      <div className="flex w-full flex-1 flex-col items-center gap-0.5 px-1.5 select-none">
        {navItems.map((item) => {
          const isActive = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => handleTabChange(item.id)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-1 w-full rounded-md py-3 transition-all duration-150 cursor-pointer group',
                isActive
                  ? 'bg-[var(--nav-active)] text-primary'
                  : 'text-muted-foreground hover:bg-[var(--surface-subtle)] hover:text-foreground'
              )}
              style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
            >
              {/* Active indicator bar (VS Code style) */}
              {isActive && (
                <div className="absolute left-[-6px] top-2.5 bottom-2.5 w-[3px] rounded-r-sm bg-primary" />
              )}
              <div className="relative">
                <item.icon className="size-4" strokeWidth={isActive ? 2.2 : 1.6} />
                {/* Notification badge for messages */}
                {item.id === 'message' && !!messageBadge && messageBadge > 0 && (
                  <div className="absolute -right-1.5 -top-1 flex size-2 items-center justify-center rounded-full bg-primary"
                    style={{ animation: 'sidebar-glow 2s ease-in-out infinite' }}
                  />
                )}
                {/* Todo count badge */}
                {item.id === 'message' && !!messageBadge && messageBadge > 0 && (
                  <span className="absolute -right-2 -top-1 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
                    {messageBadge > 99 ? '99' : messageBadge}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-medium leading-none">{item.label}</span>
            </button>
          )
        })}

        {/* 集成 Tab */}
        <button
          onClick={() => handleTabChange('integration')}
          className={cn(
            'relative flex w-full flex-col items-center gap-1 rounded-lg py-2 transition-colors',
            activeTab === 'integration'
              ? 'bg-card text-primary shadow-sm'
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
            'relative flex w-full flex-col items-center justify-center gap-1 rounded-md py-3 transition-all duration-150 cursor-pointer',
            'text-muted-foreground hover:bg-[var(--surface-subtle)] hover:text-foreground'
          )}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <div className="relative">
            <ListTodo className="size-4" strokeWidth={1.6} />
            {todoCount > 0 && (
              <span className="absolute -right-1.5 -top-1 flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
                {todoCount > 99 ? '99' : todoCount}
              </span>
            )}
          </div>
          <span className="text-[9px] font-medium leading-none">待办</span>
        </button>
      </div>

      {/* Bottom buttons */}
      <div className="flex flex-col items-center gap-0.5 py-2">
        {/* Theme picker */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-subtle)] hover:text-foreground transition-colors cursor-pointer"
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

        {/* Settings / User avatar */}
        <button
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--surface-subtle)] transition-colors cursor-pointer"
          onClick={() => navigate('/settings')}
          title="设置"
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          {currentUser ? (
            <UserAvatar avatar={currentUser.avatar} size="sm" />
          ) : (
            <div className="flex size-6 items-center justify-center rounded-full bg-linear-to-br from-green-400 to-green-600 text-[10px] font-bold text-white">
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
          navigate(`/?room=${todo.chatRoomId}&msg=${todo.messageId}`)
        }}
      />
    </div>
  )
}
