import { MessageSquare } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Agent, QuickChatSession } from '@/lib/agent-api'
import { cn, formatDateTime } from '@/lib/utils'

interface QuickChatHistoryModalProps {
  open: boolean
  onClose: () => void
  agent: Agent | null
  sessions: QuickChatSession[]
  onSelectRoom: (roomId: string) => void
}

export function QuickChatHistoryModal({
  open,
  onClose,
  agent,
  sessions,
  onSelectRoom,
}: QuickChatHistoryModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>与 {agent?.name} 的历史对话</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              暂无历史对话
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => {
                    onSelectRoom(session.chatRoomId)
                    onClose()
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg border p-3',
                    'hover:bg-accent transition-colors text-left',
                    session.status === 'archived' && 'opacity-50'
                  )}
                >
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {session.chatRoom.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDateTime(session.createdAt)}
                    </div>
                  </div>
                  {session.status === 'archived' && (
                    <span className="text-xs text-muted-foreground">已归档</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}