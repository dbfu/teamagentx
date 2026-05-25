import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { chatRoomApi, ChatRoom, Message, type PackageScriptsResult } from '@/lib/agent-api';
import { AgentAvatarImage } from '@/lib/agent-avatars';
import { GroupAvatarImage } from '@/lib/group-avatars';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Camera, ClipboardList, Clock, Eraser, Loader2, MoreHorizontal, Play, Scroll, Settings, Square, TerminalSquare, UserPlus, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  taskBoardActive?: boolean
  hasActiveTasks?: boolean
  onStopAllTasks?: () => void
  onOpenRoomRules?: () => void
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
  taskBoardActive,
  hasActiveTasks,
  onStopAllTasks,
  onOpenRoomRules,
  onScreenshot,
}: ChatAreaHeaderProps) {
  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false
  // 检测是否在移动端
  const isMobile = useIsMobile()
  const terminalOpenTarget = useUIStore((state) => state.terminalOpenTarget)
  const [packageScripts, setPackageScripts] = useState<PackageScriptsResult | null>(null)
  const [loadingScripts, setLoadingScripts] = useState(false)
  const [runningScript, setRunningScript] = useState<string | null>(null)
  const packageScriptsRequestRef = useRef(0)
  const visibleScripts = packageScripts?.scripts ?? []
  const shouldShowPackageScriptsMenu = packageScripts?.hasPackageJson === true

  const loadPackageScripts = useCallback(async (options?: { reset?: boolean }) => {
    const requestId = packageScriptsRequestRef.current + 1
    packageScriptsRequestRef.current = requestId
    const shouldReset = options?.reset === true
    if (shouldReset) {
      setPackageScripts(null)
    }

    setLoadingScripts(true)
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
        setLoadingScripts(false)
      }
    }
  }, [chatRoom.id, chatRoom.workDir])

  useEffect(() => {
    void loadPackageScripts({ reset: true })
    const intervalId = window.setInterval(() => {
      void loadPackageScripts()
    }, 10_000)

    return () => {
      window.clearInterval(intervalId)
      packageScriptsRequestRef.current += 1
    }
  }, [loadPackageScripts])

  const handleRunPackageScript = useCallback(async (scriptId: string, scriptName: string) => {
    setRunningScript(scriptId)
    try {
      if (!window.electronAPI?.isElectron || !window.electronAPI.runCommandInTerminal) {
        toast.error('执行脚本需要在桌面客户端中打开终端')
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
          toast.success(`已在终端执行脚本：${scriptName}`)
        } else {
          toast.error(result?.error || '打开终端失败')
        }
      } else {
        toast.error(response.error || '执行脚本失败')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '执行脚本失败')
    } finally {
      setRunningScript(null)
    }
  }, [chatRoom.id, terminalOpenTarget])

  const packageScriptsMenu = (
    <DropdownMenu onOpenChange={(open) => {
      if (open) void loadPackageScripts()
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
              type="button"
              disabled={runningScript !== null}
            >
              {runningScript ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <TerminalSquare className="size-5" />
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">执行 package 脚本</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-[420px] w-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {packageScripts?.packageManager ?? 'npm'} scripts
        </DropdownMenuLabel>
        {loadingScripts ? (
          <div className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在刷新
          </div>
        ) : visibleScripts.length > 0 ? (
          visibleScripts.map((script) => (
            <DropdownMenuItem
              key={script.id}
              disabled={runningScript !== null}
              onClick={() => void handleRunPackageScript(script.id, script.name)}
              title={script.command}
            >
              <Play className="size-4" />
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {script.relativeDir ? `${script.relativeDir} / ${script.name}` : script.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">{script.command}</div>
              </div>
            </DropdownMenuItem>
          ))
        ) : (
          <div className="px-2 py-2 text-sm text-muted-foreground">
            未发现 package scripts
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
            <TooltipContent side="bottom">查看群成员</TooltipContent>
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
              <TooltipContent side="bottom">停止所有任务</TooltipContent>
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
              <TooltipContent side="bottom">任务看板</TooltipContent>
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
              <TooltipContent side="bottom">清空消息</TooltipContent>
            </Tooltip>
          </>
        ) : (
          <>
            {shouldShowPackageScriptsMenu && packageScriptsMenu}
            <ChatRoomOpenMenu chatRoom={chatRoom} isElectron={isElectron} />
            {/* 快速对话群聊不允许添加新助手 */}
            {!chatRoom.isQuickChatRoom && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="group rounded-lg p-2 text-muted-foreground transition-all duration-200 hover:bg-primary/10 hover:text-primary active:scale-[0.95] outline-none"
                    onClick={() => onShowAddAgent(true)}
                  >
                    <UserPlus className="size-5 transition-transform duration-200 group-hover:scale-110" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">添加助手</TooltipContent>
              </Tooltip>
            )}
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
              <TooltipContent side="bottom">停止所有任务</TooltipContent>
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
              <TooltipContent side="bottom">任务看板</TooltipContent>
            </Tooltip>
            {/* 更多按钮 */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      type="button"
                    >
                      <MoreHorizontal className="size-5" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">更多</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenRoomRules}
                >
                  <Scroll className="size-4 text-current" />
                  群规则
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onScreenshot}
                >
                  <Camera className="size-4 text-current" />
                  截图聊天记录
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-primary/10 hover:text-primary hover:[&_svg]:text-primary focus:bg-primary/10 focus:text-primary focus:[&_svg]:text-primary"
                  onClick={onOpenCronTasks}
                >
                  <Clock className="size-4 text-current" />
                  定时任务
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="hover:bg-red-500/10 hover:text-red-500 hover:[&_svg]:text-red-500 focus:bg-red-500/10 focus:text-red-500 focus:[&_svg]:text-red-500"
                  onClick={onClearMessages}
                >
                  <Eraser className="size-4 text-current" />
                  清空消息
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
              <TooltipContent side="bottom">群设置</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}
