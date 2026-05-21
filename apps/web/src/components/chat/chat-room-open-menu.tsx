import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChatRoom } from '@/lib/agent-api'
import { useUIStore } from '@/stores'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { FOLDER_OPEN_OPTIONS, FolderOpenTargetIcon, type FolderOpenTarget } from './chat-side-panel/work-dir-card'

function getRoomWorkDir(chatRoom: ChatRoom): string {
  return chatRoom.workDir || `~/.teamagentx/workspace/${chatRoom.id}`
}

interface ChatRoomOpenMenuProps {
  chatRoom: ChatRoom
  isElectron: boolean
}

export function ChatRoomOpenMenu({ chatRoom, isElectron }: ChatRoomOpenMenuProps) {
  const terminalOpenTarget = useUIStore((state) => state.terminalOpenTarget)

  const handleOpenFolder = async (target: FolderOpenTarget) => {
    if (!isElectron || !window.electronAPI?.openFolder) {
      // Web 环境下复制路径到剪贴板
      try {
        await navigator.clipboard.writeText(getRoomWorkDir(chatRoom))
        toast.success('工作目录路径已复制到剪贴板')
      } catch {
        toast.error('复制路径失败')
      }
      return
    }

    try {
      const result = await window.electronAPI.openFolder(getRoomWorkDir(chatRoom), target, terminalOpenTarget)
      if (!result?.success) {
        toast.error(result?.error || '打开目录失败')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开目录失败')
    }
  }

  // Web 环境下点击直接复制路径
  if (!isElectron || !window.electronAPI?.openFolder) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="rounded-lg p-2 text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500"
            type="button"
            onClick={() => handleOpenFolder('system')}
          >
            <FolderOpen className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">复制群工作目录路径</TooltipContent>
      </Tooltip>
    )
  }

  // Electron 环境下使用下拉菜单选择打开方式
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className="rounded-lg p-2 text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500"
              type="button"
            >
              <FolderOpen className="size-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">打开群工作目录</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-36">
        {FOLDER_OPEN_OPTIONS.map((option: { target: FolderOpenTarget; label: string }) => (
          <DropdownMenuItem key={option.target} onClick={() => handleOpenFolder(option.target)}>
            <FolderOpenTargetIcon target={option.target} />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
