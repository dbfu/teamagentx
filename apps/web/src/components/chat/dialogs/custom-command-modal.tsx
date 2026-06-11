import { chatRoomCommandApi, type ChatRoomCommand } from '@/lib/chatroom-command-api'
import { useCustomCommandStore } from '@/stores'
import { Loader2, Pencil, Plus, Terminal, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface CustomCommandModalProps {
  isOpen: boolean
  onClose: () => void
  chatRoomId: string
}

// 稳定的空数组引用，避免选择器每次返回新数组导致无限渲染
const EMPTY_COMMANDS: ChatRoomCommand[] = []

export function CustomCommandModal({ isOpen, onClose, chatRoomId }: CustomCommandModalProps) {
  const { t } = useTranslation()
  const commands = useCustomCommandStore((s) => s.commandsByRoom[chatRoomId]) ?? EMPTY_COMMANDS
  const loadCommands = useCustomCommandStore((s) => s.loadCommands)
  const setCommands = useCustomCommandStore((s) => s.setCommands)

  // 编辑状态：null 表示未编辑，'new' 表示新增，否则为正在编辑的指令 id
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [contentDraft, setContentDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && chatRoomId) {
      loadCommands(chatRoomId)
      setEditingId(null)
    }
  }, [isOpen, chatRoomId, loadCommands])

  const startCreate = () => {
    setEditingId('new')
    setNameDraft('')
    setContentDraft('')
  }

  const startEdit = (cmd: ChatRoomCommand) => {
    setEditingId(cmd.id)
    setNameDraft(cmd.name)
    setContentDraft(cmd.content)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setNameDraft('')
    setContentDraft('')
  }

  const reload = async () => {
    const list = await chatRoomCommandApi.list(chatRoomId)
    setCommands(chatRoomId, list)
  }

  const handleSave = async () => {
    const name = nameDraft.trim().replace(/^\/+/, '')
    const content = contentDraft.trim()
    if (!name) {
      toast.error(t('chat.customCommands.nameRequired'))
      return
    }
    if (!content) {
      toast.error(t('chat.customCommands.contentRequired'))
      return
    }
    setIsSaving(true)
    try {
      const response =
        editingId === 'new'
          ? await chatRoomCommandApi.create(chatRoomId, { name, content })
          : await chatRoomCommandApi.update(editingId as string, { name, content })
      if (response.success) {
        await reload()
        cancelEdit()
      } else {
        toast.error(response.error || t('toast.saveFailed'))
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (cmd: ChatRoomCommand) => {
    setDeletingId(cmd.id)
    try {
      await chatRoomCommandApi.remove(cmd.id)
      await reload()
      if (editingId === cmd.id) cancelEdit()
    } finally {
      setDeletingId(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[70vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Terminal className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t('chat.customCommands.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Description */}
        <div className="border-b border-border bg-muted px-6 py-3">
          <p className="text-sm text-muted-foreground">{t('chat.customCommands.hint')}</p>
        </div>

        {/* List */}
        <div className="flex-1 space-y-2 overflow-y-auto p-6">
          {commands.length === 0 && editingId !== 'new' && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('chat.customCommands.empty')}
            </div>
          )}

          {commands.map((cmd) =>
            editingId === cmd.id ? (
              <CommandEditor
                key={cmd.id}
                name={nameDraft}
                content={contentDraft}
                onNameChange={setNameDraft}
                onContentChange={setContentDraft}
                onSave={handleSave}
                onCancel={cancelEdit}
                isSaving={isSaving}
              />
            ) : (
              <div
                key={cmd.id}
                className="group flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3"
              >
                <span className="inline-flex shrink-0 whitespace-nowrap rounded-md bg-blue-500/10 px-2 py-0.5 font-mono text-xs font-medium text-blue-600">
                  /{cmd.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {cmd.content}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(cmd)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(cmd)}
                    disabled={deletingId === cmd.id}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                  >
                    {deletingId === cmd.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            )
          )}

          {editingId === 'new' && (
            <CommandEditor
              name={nameDraft}
              content={contentDraft}
              onNameChange={setNameDraft}
              onContentChange={setContentDraft}
              onSave={handleSave}
              onCancel={cancelEdit}
              isSaving={isSaving}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={startCreate}
            disabled={editingId === 'new'}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
          >
            <Plus className="size-4" />
            {t('chat.customCommands.addCommand')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface CommandEditorProps {
  name: string
  content: string
  onNameChange: (v: string) => void
  onContentChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  isSaving: boolean
}

function CommandEditor({
  name,
  content,
  onNameChange,
  onContentChange,
  onSave,
  onCancel,
  isSaving,
}: CommandEditorProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 rounded-lg border border-blue-500/40 bg-background p-4">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('chat.customCommands.nameLabel')} <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm text-muted-foreground">/</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('chat.customCommands.namePlaceholder')}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('chat.customCommands.contentLabel')} <span className="text-red-500">*</span>
        </label>
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={t('chat.customCommands.contentPlaceholder')}
          rows={4}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
