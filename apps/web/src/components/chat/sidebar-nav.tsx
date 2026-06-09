
import { CreateAssistantModal } from '@/components/chat/create-assistant-modal'
import { CreateGroupModal } from '@/components/chat/create-group-modal'
import { GlobalSearchModal } from '@/components/chat/global-search-modal'
import { UserAvatar } from '@/components/chat/user-avatar'
import { useTheme } from '@/components/theme-provider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { agentApi, AgentSpeechConfig, type AgentThinkingMode } from '@/lib/agent-api'
import { openExternalUrl, TEAMAGENTX_DOCS_URL, TEAMAGENTX_GITHUB_URL } from '@/lib/site-links'
import { updateManager } from '@/lib/update-manager'
import { cn } from '@/lib/utils'
import { useAuthStore, useChatRoomStore, useSocketStore } from '@/stores'
import { useChatStore } from '@/stores/chat-store'
import { BookOpenText, Bot, Check, CircleArrowUp, Cpu, Globe, MessageSquare, Monitor, Moon, Package, Palette, Plus, Search, Sun, Users } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

interface SidebarNavProps {
  messageBadge?: number
  onRefreshChatRooms?: () => void
}

export function SidebarNav({ messageBadge, onRefreshChatRooms }: SidebarNavProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)
  const [isCreateAssistantOpen, setIsCreateAssistantOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const chatRooms = useChatRoomStore((s) => s.chatRooms)
  const { user } = useAuthStore()
  const { user: socketUser } = useSocketStore()
  const { theme, setTheme, brandTheme, setBrandTheme } = useTheme()
  const setSidePanelMode = useChatStore((s) => s.setSidePanelMode)
  const updateState = useSyncExternalStore(
    updateManager.subscribe,
    updateManager.getSnapshot,
    updateManager.getSnapshot,
  )

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !isTyping) {
        event.preventDefault()
        setIsSearchOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false
  const isMac = isElectron && /mac/i.test(navigator.platform)
  const modeOptions = [
    { value: 'light', label: t('nav.light'), icon: Sun },
    { value: 'dark', label: t('nav.dark'), icon: Moon },
    { value: 'system', label: t('nav.system'), icon: Monitor },
  ] as const
  const brandOptions = [
    { value: 'enterprise', label: t('nav.enterpriseBlue'), color: 'oklch(0.55 0.22 250)' },
    { value: 'graphite', label: t('nav.graphiteGray'), color: 'oklch(0.36 0.018 260)' },
    { value: 'violet', label: t('nav.inspirationPurple'), color: 'oklch(0.54 0.28 293)' },
    { value: 'emerald', label: t('nav.emeraldGreen'), color: 'oklch(0.55 0.16 158)' },
    { value: 'ruby', label: t('nav.rubyRed'), color: 'oklch(0.55 0.2 18)' },
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
      llmProviderId: data.llmProviderId || undefined,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })
    if (response.success) {
      setIsCreateAssistantOpen(false)
      return true
    } else {
      toast.error(t('assistant.createFailed'))
      return false
    }
  }

  const handleOpenDocs = async () => {
    const result = await openExternalUrl(TEAMAGENTX_DOCS_URL)
    if (!result.success) {
      toast.error(t('settings.openDocsFailed'))
    }
  }

  const handleOpenGithub = async () => {
    const result = await openExternalUrl(TEAMAGENTX_GITHUB_URL)
    if (!result.success) {
      toast.error(t('settings.openGithubFailed'))
    }
  }

  return (
    <>
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
        <button
          onClick={() => setIsSearchOpen(true)}
          className="group flex w-full cursor-pointer items-center justify-center rounded-lg py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          title={t('globalSearch.title')}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-sidebar-accent text-muted-foreground transition-colors group-hover:text-foreground">
            <Search className="size-4" />
          </span>
        </button>

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
              {t('nav.createGroup')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsCreateAssistantOpen(true)}>
              <Bot className="size-4" />
              {t('nav.createAssistant')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleTabChange('model')}>
              <Cpu className="size-4" />
              {t('nav.modelManagement')}
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
          <span className="text-xs">{t('nav.messages')}</span>
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
          <span className="text-xs">{t('nav.assistants')}</span>
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
          <span className="text-xs">{t('nav.skills')}</span>
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
          <span className="text-xs">{t('nav.models')}</span>
        </button>

        {/* 频道 Tab */}
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
          <span className="text-xs">{t('nav.integrations')}</span>
        </button>

        {/* 中间空白区域 - 可拖拽 */}
      </div>

      {/* Bottom buttons */}
      <div className="flex flex-col items-center gap-1 pb-4">
        {isElectron && updateState.update && (
          <button
            className="relative flex size-9 cursor-pointer items-center justify-center rounded-lg text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700"
            onClick={() => updateManager.openNotification()}
            title={t('settings.updateAvailable') + ' ' + updateState.update.version}
            style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            <CircleArrowUp className="size-5" />
            <span className="absolute right-1 top-1 size-2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_var(--sidebar)]" />
          </button>
        )}

        <button
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          title={t('nav.github')}
          onClick={handleOpenGithub}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <svg
            data-component="Octicon"
            aria-hidden="true"
            focusable="false"
            className="size-5"
            viewBox="0 0 24 24"
            fill="currentColor"
            display="inline-block"
            overflow="visible"
          >
            <path d="M10.226 17.284c-2.965-.36-5.054-2.493-5.054-5.256 0-1.123.404-2.336 1.078-3.144-.292-.741-.247-2.314.09-2.965.898-.112 2.111.36 2.83 1.01.853-.269 1.752-.404 2.853-.404 1.1 0 1.999.135 2.807.382.696-.629 1.932-1.1 2.83-.988.315.606.36 2.179.067 2.942.72.854 1.101 2 1.101 3.167 0 2.763-2.089 4.852-5.098 5.234.763.494 1.28 1.572 1.28 2.807v2.336c0 .674.561 1.056 1.235.786 4.066-1.55 7.255-5.615 7.255-10.646C23.5 6.188 18.334 1 11.978 1 5.62 1 .5 6.188.5 12.545c0 4.986 3.167 9.12 7.435 10.669.606.225 1.19-.18 1.19-.786V20.63a2.9 2.9 0 0 1-1.078.224c-1.483 0-2.359-.808-2.987-2.313-.247-.607-.517-.966-1.034-1.033-.27-.023-.359-.135-.359-.27 0-.27.45-.471.898-.471.652 0 1.213.404 1.797 1.235.45.651.921.943 1.483.943.561 0 .92-.202 1.437-.719.382-.381.674-.718.944-.943" />
          </svg>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              title={t('nav.theme')}
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

        <button
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          title={t('nav.docs')}
          onClick={handleOpenDocs}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <BookOpenText className="size-4" />
        </button>

        {/* User avatar - 跳转到设置 */}
        <button
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent"
          onClick={() => navigate('/settings')}
          title={t('nav.settings')}
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
    </div>

    {/* Modals rendered outside backdrop-blur container to avoid clipping */}
    <CreateGroupModal
      isOpen={isCreateGroupOpen}
      onClose={() => setIsCreateGroupOpen(false)}
      onSuccess={(chatRoomId) => {
        onRefreshChatRooms?.()
        navigate(`/?room=${chatRoomId}`)
      }}
      ownerId={currentUser?.id}
    />

    <CreateAssistantModal
      isOpen={isCreateAssistantOpen}
      onClose={() => setIsCreateAssistantOpen(false)}
      onSubmit={handleCreateAssistant}
    />

    <GlobalSearchModal
      open={isSearchOpen}
      onClose={() => setIsSearchOpen(false)}
      chatRooms={chatRooms}
    />

    </>
  )
}
