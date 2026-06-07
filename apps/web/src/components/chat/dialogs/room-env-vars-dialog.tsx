import { ChatRoom } from '@/lib/agent-api'
import { KeyRound, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { RoomEnvVarsEditor } from '../chat-side-panel/room-env-vars-editor'

interface RoomEnvVarsDialogProps {
  isOpen: boolean
  onClose: () => void
  chatRoom: ChatRoom
  onChatRoomChange: () => void
}

export function RoomEnvVarsDialog({
  isOpen,
  onClose,
  chatRoom,
  onChatRoomChange,
}: RoomEnvVarsDialogProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t('chat.envVars.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <RoomEnvVarsEditor
            chatRoomId={chatRoom.id}
            envVars={chatRoom.envVars}
            onSaved={onChatRoomChange}
          />
        </div>
      </div>
    </div>
  )
}
