import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { ChatRoom, Message } from '@/lib/agent-api';
import { AgentAvatarImage } from '@/lib/agent-avatars';
import { GroupAvatarImage } from '@/lib/group-avatars';
import { cn } from '@/lib/utils';
import { Camera, ClipboardList, Clock, Eraser, Scroll, Settings, UserPlus, Users } from 'lucide-react';
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
  onOpenRoomRules,
  onScreenshot,
}: ChatAreaHeaderProps) {
  // 检测是否在 Electron 环境中
  const isElectron = window.electronAPI?.isElectron ?? false
  // 检测是否在移动端
  const isMobile = useIsMobile()

  return (
    <div
      className="flex items-center border-b border-border bg-card px-6 py-3"
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
            {/* 任务看板按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'rounded-lg p-2 transition-colors',
                    taskBoardActive
                      ? 'bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:text-white'
                      : 'text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10'
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
            <ChatRoomOpenMenu chatRoom={chatRoom} isElectron={isElectron} />
            {/* 快速对话群聊不允许添加新助手 */}
            {!chatRoom.isQuickChatRoom && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="group rounded-lg p-2 text-muted-foreground transition-all duration-200 hover:bg-blue-500/10 hover:text-blue-500 active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2"
                    onClick={() => onShowAddAgent(true)}
                  >
                    <UserPlus className="size-5 transition-transform duration-200 group-hover:scale-110" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">添加助手</TooltipContent>
              </Tooltip>
            )}
            {/* 任务看板按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    'rounded-lg p-2 transition-colors',
                    taskBoardActive
                      ? 'bg-blue-500 text-white shadow-sm hover:bg-blue-600 hover:text-white'
                      : 'text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10'
                  )}
                  onClick={onOpenTaskBoard}
                >
                  <ClipboardList className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">任务看板</TooltipContent>
            </Tooltip>
            {/* 群规则按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground hover:bg-accent"
                  onClick={onOpenRoomRules}
                >
                  <Scroll className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">群规则</TooltipContent>
            </Tooltip>
            {/* 截图按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground hover:text-primary hover:bg-primary/10"
                  onClick={onScreenshot}
                >
                  <Camera className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">截图聊天记录</TooltipContent>
            </Tooltip>
            {/* 定时任务按钮 */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="rounded-lg p-2 text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10"
                  onClick={onOpenCronTasks}
                >
                  <Clock className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">定时任务</TooltipContent>
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
