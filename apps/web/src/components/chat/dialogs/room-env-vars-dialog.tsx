import { ChatRoom } from '@/lib/agent-api'
import { KeyRound, Plus, Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRef, useState } from 'react'
import { RoomEnvVarsEditor, RoomEnvVarsEditorRef } from '../chat-side-panel/room-env-vars-editor'

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
  const editorRef = useRef<RoomEnvVarsEditorRef>(null)
  const [editorState, setEditorState] = useState<{
    dirty: boolean
    hasErrors: boolean
    saving: boolean
  }>({ dirty: false, hasErrors: false, saving: false })

  if (!isOpen) return null

  const handleSave = () => {
    editorRef.current?.save()
  }

  const handleAddRow = () => {
    editorRef.current?.addRow()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
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

        {/* Editor - scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <RoomEnvVarsEditor
            ref={editorRef}
            chatRoomId={chatRoom.id}
            envVars={chatRoom.envVars}
            onSaved={onChatRoomChange}
            onClose={onClose}
            onStateChange={setEditorState}
          />
        </div>

        {/* Fixed buttons at bottom */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handleAddRow}
            className="flex items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            disabled={editorState.saving}
          >
            <Plus className="size-3" />
            {t('chat.envVars.addVariable')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={editorState.saving || !editorState.dirty || editorState.hasErrors}
            className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
          >
            <Save className="size-3" />
            {t('chat.envVars.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
