
import { CreateAssistantModal } from '@/components/chat/create-assistant-modal'
import { CreateGroupModal } from '@/components/chat/create-group-modal'
import { GlobalSearchModal } from '@/components/chat/global-search-modal'
import { SortableNavItem } from '@/components/chat/sortable-nav-item'
import { useNavOrder } from '@/components/chat/hooks/use-nav-order'
import { UserAvatar } from '@/components/chat/user-avatar'
import { UserProfileModal } from '@/components/chat/user-profile-modal'
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
import { BookOpenText, Bot, Check, CircleArrowUp, Cpu, Globe, LayoutDashboard, MessageSquare, Monitor, Moon, MoreHorizontal, Package, Palette, Plus, Search, Settings, Sun, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

interface SidebarNavProps {
  messageBadge?: number
  onRefreshChatRooms?: () => void
}

type MainNavTab = 'message' | 'workbench' | 'assistant' | 'skill' | 'model' | 'integration'
type OptionalNavTab = Exclude<MainNavTab, 'message'>

const NAV_HIDE_CANDIDATES: OptionalNavTab[][] = [
  [],
  ['integration'],
  ['model', 'integration'],
  ['skill', 'model', 'integration'],
  ['assistant', 'skill', 'model', 'integration'],
  ['workbench', 'assistant', 'skill', 'model', 'integration'],
]

const isOptionalNavTab = (tab: MainNavTab | null): tab is OptionalNavTab => (
  tab === 'workbench' || tab === 'assistant' || tab === 'skill' || tab === 'model' || tab === 'integration'
)

const areSameTabs = (a: OptionalNavTab[], b: OptionalNavTab[]) => (
  a.length === b.length && a.every((tab, index) => tab === b[index])
)

export function SidebarNav({ messageBadge, onRefreshChatRooms }: SidebarNavProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)
  const [isCreateAssistantOpen, setIsCreateAssistantOpen] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)
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

  const activeTab: MainNavTab | null = location.pathname.startsWith('/settings')
    ? null
    : location.pathname.startsWith('/workbench')
      ? 'workbench'
      : location.pathname.startsWith('/assistant')
        ? 'assistant'
        : location.pathname.startsWith('/skill')
          ? 'skill'
          : location.pathname.startsWith('/model')
            ? 'model'
            : location.pathname.startsWith('/integration')
              ? 'integration'
              : 'message'
  const isSettingsActive = location.pathname.startsWith('/settings')
  const currentUser = user || socketUser
  const [hiddenNavTabs, setHiddenNavTabs] = useState<OptionalNavTab[]>([])
  const navItemsRef = useRef<HTMLDivElement>(null)
  const navMeasureRefs = useRef<Array<HTMLDivElement | null>>([])
  const hiddenNavTabSet = new Set(hiddenNavTabs)
  const isMoreTabActive = isOptionalNavTab(activeTab) && hiddenNavTabSet.has(activeTab)

  // 导航项拖拽排序
  const { navOrder, handleDragEnd } = useNavOrder()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 300,
        tolerance: 5,
      },
    })
  )

  // 导航项配置（id -> 图标和标签）
  const navItemConfig: Record<MainNavTab, { icon: LucideIcon; label: string }> = {
    message: { icon: MessageSquare, label: t('nav.messages') },
    workbench: { icon: LayoutDashboard, label: t('nav.workbench') },
    assistant: { icon: Bot, label: t('nav.assistants') },
    skill: { icon: Package, label: t('nav.skills') },
    model: { icon: Cpu, label: t('nav.models') },
    integration: { icon: Globe, label: t('nav.integrations') },
  }

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

  const navTabs: Array<{ id: OptionalNavTab; icon: LucideIcon; label: string; menuLabel: string }> = [
    { id: 'workbench', icon: LayoutDashboard, label: t('nav.workbench'), menuLabel: t('nav.workbench') },
    { id: 'assistant', icon: Bot, label: t('nav.assistants'), menuLabel: t('nav.assistants') },
    { id: 'skill', icon: Package, label: t('nav.skills'), menuLabel: t('nav.skills') },
    { id: 'model', icon: Cpu, label: t('nav.models'), menuLabel: t('nav.modelManagement') },
    { id: 'integration', icon: Globe, label: t('nav.integrations'), menuLabel: t('nav.integrations') },
  ]
  const hiddenMenuTabs = navTabs.filter((tab) => hiddenNavTabSet.has(tab.id))

  const handleTabChange = (tab: MainNavTab) => {
    // 切换 Tab 时关闭侧拉框
    setSidePanelMode(null)
    if (tab === 'message') {
      navigate('/')
    } else {
      navigate(`/${tab}`)
    }
  }

  const handleOpenSettings = () => {
    // 切换到设置时关闭侧拉框
    setSidePanelMode(null)
    navigate('/settings')
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
      llmProviderId: data.llmProviderId || undefined,
      fallbackLlmProviderIds: data.fallbackLlmProviderIds,
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

  useEffect(() => {
    const navItems = navItemsRef.current
    const measureRefs = navMeasureRefs.current
    if (!navItems || NAV_HIDE_CANDIDATES.some((_, index) => !measureRefs[index])) return

    let frameId = 0
    const updateHiddenNavTabs = () => {
      if (frameId) cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(() => {
        const availableHeight = Math.floor(navItems.clientHeight)
        const nextHiddenTabs = NAV_HIDE_CANDIDATES.find((_, index) => {
          const measure = measureRefs[index]
          return measure ? Math.ceil(measure.scrollHeight) <= availableHeight : false
        }) ?? NAV_HIDE_CANDIDATES[NAV_HIDE_CANDIDATES.length - 1]

        setHiddenNavTabs((current) => areSameTabs(current, nextHiddenTabs) ? current : nextHiddenTabs)
      })
    }

    updateHiddenNavTabs()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHiddenNavTabs)
      return () => {
        if (frameId) cancelAnimationFrame(frameId)
        window.removeEventListener('resize', updateHiddenNavTabs)
      }
    }

    const observer = new ResizeObserver(updateHiddenNavTabs)
    observer.observe(navItems)
    measureRefs.forEach((measure) => {
      if (measure) observer.observe(measure)
    })
    window.addEventListener('resize', updateHiddenNavTabs)

    return () => {
      if (frameId) cancelAnimationFrame(frameId)
      observer.disconnect()
      window.removeEventListener('resize', updateHiddenNavTabs)
    }
  }, [])

  const measuredNavButtonClass = 'relative flex w-full flex-col items-center gap-1 rounded-lg border border-transparent py-2'
  const renderMeasuredNavTab = (key: string, Icon: LucideIcon, label: string) => (
    <button key={key} tabIndex={-1} className={measuredNavButtonClass}>
      <Icon className="size-5" />
      <span className="text-xs">{label}</span>
    </button>
  )
  const renderMeasuredNavGroup = (hiddenTabs: OptionalNavTab[]) => {
    const hiddenTabsSet = new Set(hiddenTabs)
    return (
    <div className="flex w-full flex-col items-center gap-1 px-2 pb-4 select-none">
      <button tabIndex={-1} className="group flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-full">
          <Search className="size-4" />
        </span>
      </button>
      <button tabIndex={-1} className="flex w-full flex-col items-center gap-1 rounded-lg py-2">
        <div className="flex size-8 items-center justify-center rounded-full">
          <Plus className="size-4" />
        </div>
      </button>
      {renderMeasuredNavTab('message', MessageSquare, t('nav.messages'))}
      {navTabs.map((tab) => !hiddenTabsSet.has(tab.id) && renderMeasuredNavTab(tab.id, tab.icon, tab.label))}
      {hiddenTabs.length > 0 && renderMeasuredNavTab('more', MoreHorizontal, t('common.more'))}
      {renderMeasuredNavTab('settings', Settings, t('nav.settings'))}
    </div>
    )
  }

  return (
    <>
    <div
      className="relative flex h-full w-20 shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar/95 shadow-[var(--control-shadow)] backdrop-blur"
      style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
    >
      {/* Logo area - 拖拽区域 */}
      <div className={cn(
        "mb-2 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-sidebar-border bg-[var(--surface-raised)] shadow-[var(--control-shadow)]",
        isMac ? "mt-10" : "mt-4"
      )}>
        <img src={`${import.meta.env.BASE_URL}app-logo.png`} alt="TeamAgentX" className="size-full object-cover" />
      </div>

      {/* Nav items */}
      <div ref={navItemsRef} className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 px-2 pb-4 select-none">
        <button
          onClick={() => setIsSearchOpen(true)}
          className="group flex w-full cursor-pointer items-center justify-center rounded-lg py-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
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

        {/* 可排序导航项 - 用 DndContext 包装 */}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={navOrder} strategy={verticalListSortingStrategy}>
            {navOrder.map((navId) => {
              // 消息 Tab 永不隐藏，其他 Tab 检查是否在隐藏集合中
              if (navId !== 'message' && isOptionalNavTab(navId) && hiddenNavTabSet.has(navId)) return null

              const config = navItemConfig[navId]
              if (!config) return null

              return (
                <SortableNavItem
                  key={navId}
                  id={navId}
                  icon={config.icon}
                  label={config.label}
                  isActive={activeTab === navId}
                  onClick={() => handleTabChange(navId)}
                  isElectron={isElectron}
                  badge={navId === 'message' ? messageBadge : undefined}
                />
              )
            })}
          </SortableContext>
        </DndContext>

        {hiddenMenuTabs.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
                  isMoreTabActive
                    ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
                    : 'text-muted-foreground hover:bg-sidebar-accent'
                )}
                title={t('common.more')}
                style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
              >
                <MoreHorizontal className="size-5" />
                <span className="text-xs">{t('common.more')}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
            >
              {hiddenMenuTabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <DropdownMenuItem key={tab.id} onClick={() => handleTabChange(tab.id)}>
                    <Icon className="size-4" />
                    {tab.menuLabel}
                    {activeTab === tab.id && <Check className="ml-auto size-4 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 设置 Tab - 常驻末尾 */}
        <button
          onClick={handleOpenSettings}
          className={cn(
            'relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border border-transparent py-2 transition-colors',
            isSettingsActive
              ? 'border border-[var(--nav-active-border)] bg-[var(--nav-active)] text-primary shadow-[var(--control-shadow)]'
              : 'text-muted-foreground hover:bg-sidebar-accent'
          )}
          title={t('nav.settings')}
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <Settings className="size-5" />
          <span className="text-xs">{t('nav.settings')}</span>
        </button>

        {/* 中间空白区域 - 可拖拽 */}
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 w-full opacity-0"
        style={{ visibility: 'hidden' }}
      >
        {NAV_HIDE_CANDIDATES.map((hiddenTabs, index) => (
          <div
            key={hiddenTabs.join('-') || 'all'}
            ref={(element) => {
              navMeasureRefs.current[index] = element
            }}
            className="absolute left-0 top-0 w-full"
          >
            {renderMeasuredNavGroup(hiddenTabs)}
          </div>
        ))}
      </div>

      {/* Bottom buttons */}
      <div className="flex shrink-0 flex-col items-center gap-1 pb-4">
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

        {/* User avatar - 打开用户信息弹框 */}
        <button
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-sidebar-accent"
          onClick={() => setIsProfileOpen(true)}
          title={t('settings.userInfo')}
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

    <UserProfileModal
      open={isProfileOpen}
      onClose={() => setIsProfileOpen(false)}
    />

    </>
  )
}
