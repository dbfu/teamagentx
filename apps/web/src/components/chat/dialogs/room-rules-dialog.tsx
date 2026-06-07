import { ChatRoom, chatRoomApi } from '@/lib/agent-api'
import { Loader2, Scroll, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

interface RoomRulesDialogProps {
  isOpen: boolean
  onClose: () => void
  chatRoom: ChatRoom
  onChatRoomChange: () => void
}

export function RoomRulesDialog({
  isOpen,
  onClose,
  chatRoom,
  onChatRoomChange,
}: RoomRulesDialogProps) {
  const { t } = useTranslation()
  const [rules, setRules] = useState(chatRoom.rules || '')
  const [isSaving, setIsSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen) {
      setRules(chatRoom.rules || '')
    }
  }, [isOpen, chatRoom.rules])


  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await chatRoomApi.update(chatRoom.id, {
        rules: rules.trim() || undefined,
      })
      if (response.success) {
        toast.success(t('chat.roomSettings.rulesSaved'))
        onChatRoomChange()
        onClose()
      } else {
        toast.error(t('toast.saveFailed'))
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[70vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Scroll className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t('chat.roomSettings.rulesLabel')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Description */}
        <div className="px-6 py-3 border-b border-border bg-muted">
          <p className="text-sm text-muted-foreground">
            {t('chat.roomSettings.rulesHint')}
          </p>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-6">
          <textarea
            ref={textareaRef}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder={t('chat.roomSettings.rulesPlaceholder')}
            className="h-full w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <div />
          {/* <button
            type="button"
            onClick={handleOptimize}
            disabled={!rules.trim() || isOptimizing}
            className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-600 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isOptimizing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            AI 优化
          </button> */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
