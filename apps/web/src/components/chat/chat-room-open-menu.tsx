import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ChatRoom } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FOLDER_OPEN_OPTIONS, FolderOpenTargetIcon, type FolderOpenTarget } from './chat-side-panel/work-dir-card'
import { useTranslation } from 'react-i18next'

function getRoomWorkDir(chatRoom: ChatRoom): string {
  return chatRoom.workDir || `~/.teamagentx/workspace/${chatRoom.id}`
}

interface ChatRoomOpenMenuProps {
  chatRoom: ChatRoom
  isElectron: boolean
}

export function ChatRoomOpenMenu({ chatRoom, isElectron }: ChatRoomOpenMenuProps) {
  const { t } = useTranslation()
  const terminalOpenTarget = useUIStore((state) => state.terminalOpenTarget)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [suppressTooltip, setSuppressTooltip] = useState(false)
  const suppressTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current)
    }
  }, [])

  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open)
    setTooltipOpen(false)
    if (open) {
      if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current)
      setSuppressTooltip(true)
    } else {
      if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current)
      setSuppressTooltip(true)
      suppressTimerRef.current = window.setTimeout(() => {
        setSuppressTooltip(false)
        suppressTimerRef.current = null
      }, 350)
    }
  }, [])

  const handleTriggerPointerLeave = useCallback(() => {
    if (suppressTimerRef.current) window.clearTimeout(suppressTimerRef.current)
    setSuppressTooltip(false)
  }, [])

  const handleOpenFolder = async (target: FolderOpenTarget) => {
    if (!isElectron || !window.electronAPI?.openFolder) {
      // Web 环境下复制路径到剪贴板
      try {
        await navigator.clipboard.writeText(getRoomWorkDir(chatRoom))
        toast.success(t('chat.roomSettings.workDirCopied'))
      } catch {
        toast.error(t('common.copyFailed'))
      }
      return
    }

    try {
      const result = await window.electronAPI.openFolder(getRoomWorkDir(chatRoom), target, terminalOpenTarget)
      if (!result?.success) {
        toast.error(t('chat.roomSettings.openFolderFailed'))
      }
    } catch (error) {
      toast.error(t('chat.roomSettings.openFolderFailed'))
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
        <TooltipContent side="bottom">{t('chat.roomSettings.workDirCopied')}</TooltipContent>
      </Tooltip>
    )
  }

  // Electron 环境下使用下拉菜单选择打开方式
  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleMenuOpenChange}>
      <Tooltip
        open={!menuOpen && !suppressTooltip && tooltipOpen}
        onOpenChange={(open) => setTooltipOpen(open && !menuOpen && !suppressTooltip)}
      >
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                'rounded-lg p-2 transition-colors',
                menuOpen
                  ? 'bg-blue-500/10 text-blue-500'
                  : 'text-muted-foreground hover:bg-blue-500/10 hover:text-blue-500',
              )}
              type="button"
              onBlur={handleTriggerPointerLeave}
              onPointerLeave={handleTriggerPointerLeave}
            >
              <FolderOpen className="size-5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('common.openFolder')}</TooltipContent>
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
