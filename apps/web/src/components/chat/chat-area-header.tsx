import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { chatRoomApi, ChatRoom, Message, type PackageScriptsResult } from '@/lib/agent-api';
import { AgentAvatarImage } from '@/lib/agent-avatars';
import { GroupAvatarImage } from '@/lib/group-avatars';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Box, Camera, ClipboardList, Clock, Eraser, History, KeyRound, Loader2, MoreHorizontal, Play, Scroll, Settings, Square, TerminalSquare, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useUIStore } from '@/stores';
import { ChatRoomOpenMenu } from './chat-room-open-menu';

interface ChatAreaHeaderProps {
  chatRoom: ChatRoom
  messages: Message[]
  onShowAddAgent: (show: boolean) => void
  onToggleAgentsPanel: () => void
  onOpenRoomSettings?: () => void
  onClearMessages?: () => void
  onOpenCronTasks?: () => void
  onOpenTaskBoard?: () => void
  onOpenMessageArchives?: () => void
  taskBoardActive?: boolean
  hasActiveTasks?: boolean
  onStopAllTasks?: () => void
  onOpenRoomRules?: () => void
  onOpenEnvVars?: () => void
  onOpenCustomCommands?: () => void
  onScreenshot?: () => void
}


export function ChatAreaHeader({
  chatRoom,
  onShowAddAgent,
  onToggleAgentsPanel,
  onOpenRoomSettings,
  onClearMessages,
  onOpenCronTasks,
  onOpenTaskBoard,
  onOpenMessageArchives,
  taskBoardActive,
  hasActiveTasks,
  onStopAllTasks,
  onOpenRoomRules,
  onOpenEnvVars,
  onOpenCustomCommands,
  onScreenshot,
}: ChatAreaHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false
  // 检测是否在移动端
  const isMobile = useIsMobile()
  const terminalOpenTarget = useUIStore((state) => state.terminalOpenTarget)
  const [packageScripts, setPackageScripts] = useState<PackageScriptsResult | null>(null)
  const [loadingScripts, setLoadingScripts] = useState(false)
  const [runningScript, setRunningScript] = useState<string | null>(null)
  const [packageScriptsMenuOpen, setPackageScriptsMenuOpen] = useState(false)
  const [packageScriptsTooltipOpen, setPackageScriptsTooltipOpen] = useState(false)
  const [suppressPackageScriptsTooltip, setSuppressPackageScriptsTooltip] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [moreTooltipOpen, setMoreTooltipOpen] = useState(false)
  const [suppressMoreTooltip, setSuppressMoreTooltip] = useState(false)
  const packageScriptsRequestRef = useRef(0)
  const packageScriptsLoadedRef = useRef(false)
  const packageScriptsTooltipSuppressTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const moreTooltipSuppressTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const visibleScripts = packageScripts?.scripts ?? []
  const shouldShowPackageScriptsMenu = (packageScripts?.hasScripts ?? packageScripts?.hasPackageJson ?? false) || visibleScripts.length > 0

  const loadPackageScripts = useCallback(async (options?: { reset?: boolean; showLoading?: boolean }) => {
    const requestId = packageScriptsRequestRef.current + 1
    packageScriptsRequestRef.current = requestId
    const shouldReset = options?.reset === true
    if (shouldReset) {
      packageScriptsLoadedRef.current = false
      setPackageScripts(null)
    }

    const shouldShowLoading = options?.showLoading ?? !packageScriptsLoadedRef.current
    if (shouldShowLoading) {
      setLoadingScripts(true)
    }

    try {
      const response = await chatRoomApi.getPackageScripts(chatRoom.id)
      if (packageScriptsRequestRef.current !== requestId) return
      if (response.success && response.data) {
        setPackageScripts(response.data)
      }
    } catch {
      if (packageScriptsRequestRef.current !== requestId) return
      if (shouldReset) {
        setPackageScripts(null)
      }
    } finally {
      if (packageScriptsRequestRef.current === requestId) {
        packageScriptsLoadedRef.current = true
        setLoadingScripts(false)
      }
    }
  }, [chatRoom.id, chatRoom.workDir])

  useEffect(() => {
    void loadPackageScripts({ reset: true, showLoading: true })
    const intervalId = window.setInterval(() => {
      void loadPackageScripts({ showLoading: false })
    }, 10_000)

    return () => {
      window.clearInterval(intervalId)
      packageScriptsRequestRef.current += 1
    }
  }, [loadPackageScripts])

  useEffect(() => {
    return () => {
      if (packageScriptsTooltipSuppressTimerRef.current) {
        window.clearTimeout(packageScriptsTooltipSuppressTimerRef.current)
      }
      if (moreTooltipSuppressTimerRef.current) {
        window.clearTimeout(moreTooltipSuppressTimerRef.current)
      }
    }
  }, [])

  const handleRunPackageScript = useCallback(async (scriptId: string, scriptName: string) => {
    setRunningScript(scriptId)
    try {
      if (!window.electronAPI?.isElectron || !window.electronAPI.runCommandInTerminal) {
        toast.error(t('chat.scriptRunNeedDesktop'))
        return
      }

      const response = await chatRoomApi.runPackageScript(chatRoom.id, scriptId)
      if (response.success && response.data) {
        const result = await window.electronAPI.runCommandInTerminal(
          response.data.workDir,
          response.data.command,
          terminalOpenTarget,
        )
        if (result?.success) {
          toast.success(t('chat.scriptExecutedInTerminal', { name: scriptName }))
        } else {
          toast.error(t('chat.openTerminalFailed'))
        }
      } else {
        toast.error(response.error || t('chat.runScriptFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.runScriptFailed'))
    } finally {
      setRunningScript(null)
    }
  }, [chatRoom.id, terminalOpenTarget, t])

  const clearPackageScriptsTooltipSuppressTimer = useCallback(() => {
    if (packageScriptsTooltipSuppressTimerRef.current) {
      window.clearTimeout(packageScriptsTooltipSuppressTimerRef.current)
      packageScriptsTooltipSuppressTimerRef.current = null
    }
  }, [])

  const suppressPackageScriptsTooltipBriefly = useCallback(() => {
    clearPackageScriptsTooltipSuppressTimer()
    setSuppressPackageScriptsTooltip(true)
    packageScriptsTooltipSuppressTimerRef.current = window.setTimeout(() => {
      setSuppressPackageScriptsTooltip(false)
      packageScriptsTooltipSuppressTimerRef.current = null
    }, 350)
  }, [clearPackageScriptsTooltipSuppressTimer])

  const handlePackageScriptsMenuOpenChange = useCallback((open: boolean) => {
    setPackageScriptsMenuOpen(open)
    setPackageScriptsTooltipOpen(false)
    if (open) {
      clearPackageScriptsTooltipSuppressTimer()
      setSuppressPackageScriptsTooltip(true)
      void loadPackageScripts()
    } else {
      suppressPackageScriptsTooltipBriefly()
    }
  }, [clearPackageScriptsTooltipSuppressTimer, loadPackageScripts, suppressPackageScriptsTooltipBriefly])

  const handlePackageScriptsTooltipOpenChange = useCallback((open: boolean) => {
    setPackageScriptsTooltipOpen(open && !packageScriptsMenuOpen && !suppressPackageScriptsTooltip)
  }, [packageScriptsMenuOpen, suppressPackageScriptsTooltip])

  const handlePackageScriptsTriggerPointerLeave = useCallback(() => {
    clearPackageScriptsTooltipSuppressTimer()
    setSuppressPackageScriptsTooltip(false)
  }, [clearPackageScriptsTooltipSuppressTimer])

  const clearMoreTooltipSuppressTimer = useCallback(() => {
    if (moreTooltipSuppressTimerRef.current) {
      window.clearTimeout(moreTooltipSuppressTimerRef.current)
      moreTooltipSuppressTimerRef.current = null
    }
  }, [])

  const suppressMoreTooltipBriefly = useCallback(() => {
    clearMoreTooltipSuppressTimer()
    setSuppressMoreTooltip(true)
    moreTooltipSuppressTimerRef.current = window.setTimeout(() => {
      setSuppressMoreTooltip(false)
      moreTooltipSuppressTimerRef.current = null
    }, 350)
  }, [clearMoreTooltipSuppressTimer])

  const handleMoreMenuOpenChange = useCallback((open: boolean) => {
    setMoreMenuOpen(open)
    setMoreTooltipOpen(false)
    if (open) {
      clearMoreTooltipSuppressTimer()
      setSuppressMoreTooltip(true)
    } else {
      suppressMoreTooltipBriefly()
    }
  }, [clearMoreTooltipSuppressTimer, suppressMoreTooltipBriefly])

  const handleMoreTooltipOpenChange = useCallback((open: boolean) => {
    setMoreTooltipOpen(open && !moreMenuOpen && !suppressMoreTooltip)
  }, [moreMenuOpen, suppressMoreTooltip])

  const handleMoreTriggerPointerLeave = useCallback(() => {
    clearMoreTooltipSuppressTimer()
    setSuppressMoreTooltip(false)
  }, [clearMoreTooltipSuppressTimer])

  const packageScriptsMenu = (
    <DropdownMenu open={packageScriptsMenuOpen} onOpenChange={handlePackageScriptsMenuOpenChange}>
      <Tooltip
        open={!packageScriptsMenuOpen && !suppressPackageScriptsTooltip && packageScriptsTooltipOpen}
        onOpenChange={handlePackageScriptsTooltipOpenChange}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
              type="button"
              disabled={runningScript !== null}
              onBlur={handlePackageScriptsTriggerPointerLeave}
              onPointerLeave={handlePackageScriptsTriggerPointerLeave}
            >
              {runningScript ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <TerminalSquare className="size-5" />
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('chat.runPackageScript')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-[420px] w-[420px] max-w-[calc(100vw-24px)] overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('chat.availableScripts')}
        </DropdownMenuLabel>
        {loadingScripts ? (
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('chat.refreshing')}
          </div>
        ) : visibleScripts.length > 0 ? (
          visibleScripts.map((script) => {
            const scriptLabel = script.relativeDir ? `${script.relativeDir} / ${script.name}` : script.name

            return (
              <DropdownMenuItem
                key={script.id}
                disabled={runningScript !== null}
                onClick={() => void handleRunPackageScript(script.id, script.name)}
              >
                <Play className="size-4" />
                <div className="min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{scriptLabel}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {script.source === 'shell' ? t('chat.shellScript') : packageScripts?.packageManager ?? 'npm'}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="left" align="start" className="max-w-[420px] break-all text-xs">
                      {scriptLabel}
                    </TooltipContent>
                  </Tooltip>
                  <div className="truncate text-xs text-muted-foreground">{script.command}</div>
                </div>
              </DropdownMenuItem>
            )
          })
        ) : (
          <div className="px-2 py-2 text-sm text-muted-foreground">
            {t('chat.noPackageScripts')}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div
      className="flex items-center border-b border-border/80 bg-[var(--surface-raised)] px-6 py-3 shadow-[var(--control-shadow)]"
      style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
    >
      {/* Left content */}
      <div
        className="flex shrink-0 items-center gap-3"
        style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
      >
        <button
          onClick={onOpenRoomSettings}
          className="transition-transform hover:scale-105"
        >
          {/* 快速对话群聊使用助手头像，普通群聊使用群聊头像 */}
          {chatRoom.isQuickChatRoom ? (
            <AgentAvatarImage avatar={chatRoom.avatar ?? null} className="size-8 rounded-full" />
          ) : (
            <GroupAvatarImage avatar={chatRoom.avatar ?? null} className="size-8 rounded-full" />
          )}
        </button>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <button
            onClick={onOpenRoomSettings}
            className="text-lg font-semibold text-foreground hover:text-primary transition-colors"
          >
            {chatRoom.name}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex cursor-pointer items-center gap-1 rounded px-1 text-sm text-muted-foreground hover:bg-accent"
                onClick={onToggleAgentsPanel}
              >
                <Users className="size-4" />
                {chatRoom.chatRoomAgents?.length ?? 0}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('chat.viewGroupMembers')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Right actions */}
      <div
        className="ml-auto flex shrink-0 items-center gap-2"
        style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
      >
        {/* 移动端只显示任务看板和清空消息 */}
        {isMobile ? (
          <>
            {shouldShowPackageScriptsMenu && packageScriptsMenu}
            {/* 停止所有任务按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'rounded-lg p-2 transition-colors',
                    hasActiveTasks
                      ? 'text-red-500 hover:bg-red-500/10 active:bg-red-500/20'
                      : 'text-muted-foreground/50'
                  )}
                  disabled={!hasActiveTasks}
                  onClick={onStopAllTasks}
                >
                  <Square className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.stopAllTasks')}</TooltipContent>
            </Tooltip>
            {/* 任务看板按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'rounded-lg p-2 transition-colors',
                    taskBoardActive
                      ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground'
                      : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                  )}
                  onClick={onOpenTaskBoard}
                >
                  <ClipboardList className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.taskBoardTitle')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  onClick={onOpenMessageArchives}
                >
                  <History className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.historyRecords')}</TooltipContent>
            </Tooltip>
            {/* 清空消息按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground hover:text-orange-500 hover:bg-orange-500/10"
                  onClick={onClearMessages}
                >
                  <Eraser className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.clearMessages')}</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            {shouldShowPackageScriptsMenu && packageScriptsMenu}
            <ChatRoomOpenMenu chatRoom={chatRoom} isElectron={isElectron} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="group rounded-lg p-2 text-muted-foreground transition-all duration-200 hover:bg-primary/10 hover:text-primary active:scale-[0.95] outline-none"
                  onClick={() => onShowAddAgent(true)}
                >
                  <UserPlus className="size-5 transition-transform duration-200 group-hover:scale-110" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.addAssistant')}</TooltipContent>
            </Tooltip>
            {/* 3D 视角按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                  onClick={() => navigate(`/office/${chatRoom.id}`)}
                >
                  <Box className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.3dView')}</TooltipContent>
            </Tooltip>
            {/* 停止所有任务按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'rounded-lg p-2 transition-colors',
                    hasActiveTasks
                      ? 'text-red-500 hover:bg-red-500/10 active:bg-red-500/20'
                      : 'text-muted-foreground/50'
                  )}
                  disabled={!hasActiveTasks}
                  onClick={onStopAllTasks}
                >
                  <Square className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.stopAllTasks')}</TooltipContent>
            </Tooltip>
            {/* 任务看板按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'rounded-lg p-2 transition-colors',
                    taskBoardActive
                      ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground'
                      : 'text-muted-foreground hover:text-primary hover:bg-primary/10'
                  )}
                  onClick={onOpenTaskBoard}
                >
                  <ClipboardList className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.taskBoardTitle')}</TooltipContent>
            </Tooltip>
            {/* 更多按钮 */}
            <DropdownMenu open={moreMenuOpen} onOpenChange={handleMoreMenuOpenChange}>
              <Tooltip
                open={!moreMenuOpen && !suppressMoreTooltip && moreTooltipOpen}
                onOpenChange={handleMoreTooltipOpenChange}
              >
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      type="button"
                      onBlur={handleMoreTriggerPointerLeave}
                      onPointerLeave={handleMoreTriggerPointerLeave}
                    >
                      <MoreHorizontal className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('chat.more')}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenRoomRules}
                >
                  <Scroll className="size-4 text-current" />
                  {t('chat.groupRules')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenEnvVars}
                >
                  <KeyRound className="size-4 text-current" />
                  {t('chat.envVars.title')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenCustomCommands}
                >
                  <TerminalSquare className="size-4 text-current" />
                  {t('chat.customCommands.menuTitle')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onScreenshot}
                >
                  <Camera className="size-4 text-current" />
                  {t('chat.screenshotChatHistory')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenCronTasks}
                >
                  <Clock className="size-4 text-current" />
                  {t('chat.cronTasks')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenMessageArchives}
                >
                  <History className="size-4 text-current" />
                  {t('chat.historyRecords')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-red-500/10 hover:text-red-500 hover:[&_svg]:text-red-500 focus:bg-red-500/10 focus:text-red-500 focus:[&_svg]:text-red-500"
                  onClick={onClearMessages}
                >
                  <Eraser className="size-4 text-current" />
                  {t('chat.clearMessages')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* 群设置按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                  onClick={onOpenRoomSettings}
                >
                  <Settings className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('chat.groupSettings')}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}
