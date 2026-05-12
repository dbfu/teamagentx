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
  const isElectron = window.electronAPI?.isElectron ?? false
  const isMobile = useIsMobile()

  return (
    <div
      className="flex h-[52px] items-center border-b border-border bg-[var(--surface-raised)] px-4 shrink-0"
      style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
    >
      {/* Left content */}
      <div
        className="flex shrink-0 items-center gap-2.5"
        style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
      >
        <button onClick={onOpenRoomSettings} className="transition-transform hover:scale-105">
          {chatRoom.isQuickChatRoom ? (
            <AgentAvatarImage avatar={chatRoom.avatar ?? null} className="size-6 rounded-full" />
          ) : (
            <GroupAvatarImage avatar={chatRoom.avatar ?? null} className="size-6 rounded-full" />
          )}
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOpenRoomSettings}
            className="text-sm font-bold text-foreground hover:text-primary transition-colors"
          >
            {chatRoom.name}
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-7 cursor-pointer items-center gap-1 rounded-full bg-[var(--surface-subtle)] px-2 text-[11px] font-medium text-muted-foreground hover:bg-accent"
                onClick={onToggleAgentsPanel}
              >
                <Users className="size-3" />
                {chatRoom.chatRoomAgents?.length ?? 0}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">查看群成员</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Right actions */}
      <div
        className="ml-auto flex shrink-0 items-center gap-0.5"
        style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
      >
        {isMobile ? (
          <>
            <HeaderIconButton icon={ClipboardList} tip="任务看板" active={taskBoardActive} onClick={onOpenTaskBoard} />
            <HeaderIconButton icon={Eraser} tip="清空消息" danger onClick={onClearMessages} />
          </>
        ) : (
          <>
            <ChatRoomOpenMenu chatRoom={chatRoom} isElectron={isElectron} />
            {!chatRoom.isQuickChatRoom && (
              <HeaderIconButton icon={UserPlus} tip="添加助手" onClick={() => onShowAddAgent(true)} />
            )}
            <HeaderIconButton icon={ClipboardList} tip="任务看板" active={taskBoardActive} onClick={onOpenTaskBoard} />
            <HeaderIconButton icon={Scroll} tip="群规则" onClick={onOpenRoomRules} />
            <HeaderIconButton icon={Camera} tip="截图" onClick={onScreenshot} />
            <HeaderIconButton icon={Clock} tip="定时任务" onClick={onOpenCronTasks} />
            <HeaderIconButton icon={Eraser} tip="清空消息" danger onClick={onClearMessages} />
            <HeaderIconButton icon={Settings} tip="群设置" onClick={onOpenRoomSettings} />
          </>
        )}
      </div>
    </div>
  )
}

/** Compact icon button matching the new design */
function HeaderIconButton({
  icon: Icon,
  tip,
  active,
  danger,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  tip: string
  active?: boolean
  danger?: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={cn(
            'flex size-8 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] transition-colors',
            active
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : danger
                ? 'text-muted-foreground hover:text-orange-500 hover:bg-orange-500/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-[var(--surface-subtle)]'
          )}
          onClick={onClick}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  )
}
