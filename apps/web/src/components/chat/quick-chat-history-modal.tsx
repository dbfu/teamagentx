import { MessageSquare } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Agent, QuickChatSession } from '@/lib/agent-api'
import { cn, formatDateTime } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('chat.quickChatHistoryTitle', { name: agent?.name })}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {t('chat.noQuickChatHistory')}
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
                    <span className="text-xs text-muted-foreground">{t('chat.quickChatArchived')}</span>
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