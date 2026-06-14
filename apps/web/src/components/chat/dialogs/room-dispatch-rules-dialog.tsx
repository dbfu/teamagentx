import { ChatRoom, chatRoomApi } from '@/lib/agent-api'
import { AlertTriangle, Code2, Loader2, Workflow, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { parseDispatchRulesYaml } from '@/lib/dispatch-rules/schema'
import { DispatchRulesFlow } from './dispatch-rules-flow'

interface RoomDispatchRulesDialogProps {
  isOpen: boolean
  onClose: () => void
  chatRoom: ChatRoom
  onChatRoomChange: () => void
}

type ViewMode = 'flow' | 'source'

export function RoomDispatchRulesDialog({
  isOpen,
  onClose,
  chatRoom,
  onChatRoomChange,
}: RoomDispatchRulesDialogProps) {
  const { t } = useTranslation()
  const [yamlText, setYamlText] = useState(chatRoom.dispatchRules || '')
  const [view, setView] = useState<ViewMode>('flow')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
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
      // 有内容且能解析则默认流程图视图，否则进源码视图
      const parsed = parseDispatchRulesYaml(initial)
      setView(initial.trim() && parsed.ok ? 'flow' : 'source')
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

  // 群内真实存在的业务助手名称，用于标红不存在的引用
  const validAgentNames = useMemo(() => {
    const names: string[] = []
    for (const cra of latestRoom.chatRoomAgents ?? []) {
      const agent = cra.agent
      if (agent && agent.agentLevel !== 'system') names.push(agent.name)
    }
    return names
  }, [latestRoom.chatRoomAgents])

  const parsed = useMemo(() => parseDispatchRulesYaml(yamlText), [yamlText])

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
        onClose()
      } else {
        toast.error(response.error || t('toast.saveFailed'))
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Workflow className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t('chat.groupDispatchRules')}</h2>
            {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex items-center gap-2">
            {/* 视图切换 */}
            <div className="flex rounded-lg border border-border p-0.5">
              <button
                type="button"
                onClick={() => setView('flow')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${
                  view === 'flow' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <Workflow className="size-3.5" />
                {t('chat.dispatchRules.viewFlow')}
              </button>
              <button
                type="button"
                onClick={() => setView('source')}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${
                  view === 'source' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                <Code2 className="size-3.5" />
                {t('chat.dispatchRules.viewSource')}
              </button>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="border-b border-border bg-muted px-6 py-3">
          <p className="text-sm text-muted-foreground">{t('chat.dispatchRules.hint')}</p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {view === 'flow' ? (
            yamlText.trim() && parsed.ok && parsed.data ? (
              <DispatchRulesFlow data={parsed.data} validAgentNames={validAgentNames} />
            ) : yamlText.trim() && !parsed.ok ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <AlertTriangle className="size-8 text-amber-500" />
                <p className="text-sm text-muted-foreground">{t('chat.dispatchRules.parseFailed')}</p>
                <p className="max-w-md text-xs text-red-500">{parsed.error}</p>
                <button
                  type="button"
                  onClick={() => setView('source')}
                  className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                >
                  {t('chat.dispatchRules.viewSource')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <Workflow className="size-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">{t('chat.dispatchRules.empty')}</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {t('chat.dispatchRules.emptyTip')}
                </p>
              </div>
            )
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

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
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
            disabled={isSaving || (!!yamlText.trim() && !parsed.ok)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
