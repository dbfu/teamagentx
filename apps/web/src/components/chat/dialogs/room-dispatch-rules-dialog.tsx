import { ChatRoom, chatRoomApi } from '@/lib/agent-api'
import { AlertTriangle, Code2, GitBranch, Loader2, Workflow } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { parseDispatchRulesYaml } from '@/lib/dispatch-rules/schema'
import { cn } from '@/lib/utils'
import { DispatchRulesBuilder } from './dispatch-rules-builder'
import type { DispatchRulesBuilderAgent } from './dispatch-rules-builder-model'

interface RoomDispatchRulesDialogProps {
  isOpen: boolean
  onClose: () => void
  chatRoom: ChatRoom
  onChatRoomChange: () => void
}

type ViewMode = 'builder' | 'source'

export function RoomDispatchRulesDialog({
  isOpen,
  onClose,
  chatRoom,
  onChatRoomChange,
}: RoomDispatchRulesDialogProps) {
  const { t } = useTranslation()
  const [yamlText, setYamlText] = useState(chatRoom.dispatchRules || '')
  const [view, setView] = useState<ViewMode>('builder')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isPanelFullscreen, setIsPanelFullscreen] = useState(false)
  const [builderResetKey, setBuilderResetKey] = useState(0)
  // 群助手可能刚更新过调度规则，每次打开都拉一次最新群聊，避免用本地缓存的旧数据
  const [latestRoom, setLatestRoom] = useState<ChatRoom>(chatRoom)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    const applyRoom = (room: ChatRoom) => {
      if (cancelled) return
      setLatestRoom(room)
      const initial = room.dispatchRules || ''
      setYamlText(initial)
      setBuilderResetKey((key) => key + 1)
      // 有内容且能解析则进入拖拽编排；解析失败才切到源码视图。
      const parsed = parseDispatchRulesYaml(initial)
      setView(initial.trim() && !parsed.ok ? 'source' : 'builder')
    }

    // 先用当前缓存渲染，再异步取最新覆盖
    applyRoom(chatRoom)
    setIsLoading(true)
    chatRoomApi
      .getById(chatRoom.id)
      .then((res) => {
        if (res.success && res.data) applyRoom(res.data)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
    // 仅依赖打开状态与群聊 id，避免缓存对象引用变化导致重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, chatRoom.id])

  useEffect(() => {
    if (!isOpen) {
      setIsPanelFullscreen(false)
      return
    }
    if (!isPanelFullscreen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPanelFullscreen(false)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isPanelFullscreen])

  const builderAgents = useMemo<DispatchRulesBuilderAgent[]>(() => {
    const agents: DispatchRulesBuilderAgent[] = []
    for (const cra of latestRoom.chatRoomAgents ?? []) {
      const agent = cra.agent
      if (agent && agent.agentLevel !== 'system') {
        agents.push({
          name: agent.name,
          role: agent.description?.trim() || cra.role || t('chat.dispatchRules.builderDefaultRole'),
          avatar: agent.avatar,
          avatarColor: agent.avatarColor,
          agentLevel: agent.agentLevel,
        })
      }
    }
    return agents
  }, [latestRoom.chatRoomAgents, t])

  const parsed = useMemo(() => parseDispatchRulesYaml(yamlText), [yamlText])

  const openBuilder = () => {
    if (view !== 'builder') setBuilderResetKey((key) => key + 1)
    setView('builder')
  }

  const handleClose = () => {
    setIsPanelFullscreen(false)
    onClose()
  }

  const handleSave = async () => {
    const trimmed = yamlText.trim()
    // 非空内容必须通过格式校验，否则不允许保存
    if (trimmed && !parsed.ok) {
      toast.error(`${t('chat.dispatchRules.invalidFormat')}：${parsed.error}`)
      setView('source')
      return
    }
    setIsSaving(true)
    try {
      const response = await chatRoomApi.update(chatRoom.id, {
        dispatchRules: trimmed || null,
      })
      if (response.success) {
        toast.success(t('chat.dispatchRules.saved'))
        onChatRoomChange()
        handleClose()
      } else {
        toast.error(response.error || t('toast.saveFailed'))
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-hidden bg-background',
        isPanelFullscreen && 'fixed inset-0 z-[60] h-screen w-screen',
      )}
    >
      <div className="flex h-full min-w-0 w-full flex-col overflow-hidden bg-card">
        {/* Header */}
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-border px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Workflow className="size-4 text-primary" />
            <h2 className="truncate text-base font-semibold text-foreground">{t('chat.groupDispatchRules')}</h2>
            {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          {/* 视图切换 */}
          <div className="flex justify-self-center rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={openBuilder}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                view === 'builder' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <GitBranch className="size-3.5" />
              {t('chat.dispatchRules.viewBuilder')}
            </button>
            <button
              type="button"
              onClick={() => setView('source')}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${
                view === 'source' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              <Code2 className="size-3.5" />
              {t('chat.dispatchRules.viewSource')}
            </button>
          </div>
          <div className="flex min-w-0 justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || (!!yamlText.trim() && !parsed.ok)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving && <Loader2 className="size-3.5 animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={view === 'builder' ? 'min-h-0 flex-1 overflow-hidden p-3' : 'min-h-0 flex-1 overflow-auto p-4'}>
          {view === 'builder' ? (
            <DispatchRulesBuilder
              initialData={parsed.ok ? parsed.data : undefined}
              resetKey={builderResetKey}
              roomAgents={builderAgents}
              onYamlChange={setYamlText}
              isFullscreen={isPanelFullscreen}
              onToggleFullscreen={() => setIsPanelFullscreen((fullscreen) => !fullscreen)}
            />
          ) : (
            <div className="flex h-full flex-col gap-2">
              <textarea
                value={yamlText}
                onChange={(e) => setYamlText(e.target.value)}
                placeholder={t('chat.dispatchRules.placeholder')}
                spellCheck={false}
                className="h-full w-full resize-none rounded-lg border border-border bg-background px-4 py-3 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
              {yamlText.trim() && !parsed.ok && (
                <div className="flex items-start gap-1.5 text-xs text-red-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{parsed.error}</span>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
