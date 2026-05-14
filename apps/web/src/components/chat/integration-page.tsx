import { bridgeApi, type BridgeBot, type BridgeEvent, type BridgePlatformDefinition, type Platform } from '@/lib/bridge-api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { ArrowDownLeft, ArrowUpRight, Check, Clock3, Globe, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BotEditorForm } from './integration/BotEditorForm'
import { BotListCard } from './integration/BotListCard'
import { useBridgeData } from './integration/useBridgeData'

const ELECTRON_DRAG_STYLE = window.electronAPI?.isElectron
  ? { WebkitAppRegion: 'drag' as const }
  : {}

const NO_DRAG_STYLE = window.electronAPI?.isElectron
  ? { WebkitAppRegion: 'no-drag' as const }
  : {}

type PendingRebind = {
  botId: string
  chatRoomId: string
  fromRoomName: string
  toRoomName: string
}

function formatEventTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function platformLabel(platforms: BridgePlatformDefinition[], platform: Platform) {
  return platforms.find((item) => item.key === platform)?.label ?? platform
}

export function IntegrationPage() {
  const [activePlatform, setActivePlatform] = useState<Platform>('telegram')
  const { platforms, bots, rooms, playbook, events, baseUrl: loadedBaseUrl, loading, hasError, loadBots, reload } =
    useBridgeData(activePlatform)

  const [baseUrl, setBaseUrl] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [editingBaseUrl, setEditingBaseUrl] = useState(false)
  const [savingBaseUrl, setSavingBaseUrl] = useState(false)

  // Sync baseUrl from hook on initial load
  const [baseUrlSynced, setBaseUrlSynced] = useState(false)
  if (!baseUrlSynced && !loading && loadedBaseUrl !== undefined) {
    setBaseUrl(loadedBaseUrl)
    setBaseUrlInput(loadedBaseUrl)
    setBaseUrlSynced(true)
  }

  const [savingBot, setSavingBot] = useState(false)
  const [editingBotId, setEditingBotId] = useState<string | null>(null)
  const [botName, setBotName] = useState('')
  const [botFields, setBotFields] = useState<Record<string, string>>({})
  const [draftChatRoomId, setDraftChatRoomId] = useState('__none__')
  const [pendingRebind, setPendingRebind] = useState<PendingRebind | null>(null)
  const [pendingDeleteBot, setPendingDeleteBot] = useState<BridgeBot | null>(null)
  const [botSearch, setBotSearch] = useState('')
  const [pendingBotIds, setPendingBotIds] = useState<Set<string>>(new Set())

  const platformInfo = platforms.find((item) => item.key === activePlatform) ?? null
  const activeFields = platformInfo?.configFields ?? []

  const botsByRoomId = useMemo(() => {
    const map = new Map<string, BridgeBot[]>()
    for (const bot of bots) {
      if (!bot.chatRoomId) continue
      const next = map.get(bot.chatRoomId) ?? []
      next.push(bot)
      map.set(bot.chatRoomId, next)
    }
    return map
  }, [bots])

  const linkedRooms = useMemo(
    () => rooms.filter((room) => (botsByRoomId.get(room.id)?.length ?? 0) > 0),
    [rooms, botsByRoomId],
  )

  const filteredBots = useMemo(() => {
    const keyword = botSearch.trim().toLowerCase()
    if (!keyword) return bots
    return bots.filter((bot) => {
      const roomName = bot.chatRoom?.name ?? ''
      const pLabel = platformLabel(platforms, bot.platform)
      return [bot.name, roomName, pLabel].some((v) => v.toLowerCase().includes(keyword))
    })
  }, [botSearch, bots, platforms])

  const cancelBotEditor = () => {
    setEditingBotId(null)
    setBotName('')
    setBotFields({})
    setDraftChatRoomId('__none__')
  }

  const startCreateBot = () => {
    if (editingBotId || botName.trim()) {
      if (!window.confirm('当前有未保存的编辑内容，确定要丢弃吗？')) return
    }
    setEditingBotId(null)
    setBotName(platformInfo?.label ? `${platformInfo.label} 机器人` : '')
    setBotFields({})
    setDraftChatRoomId('__none__')
  }

  const startEditBot = (bot: BridgeBot) => {
    setEditingBotId(bot.id)
    setBotName(bot.name)
    const nextFields: Record<string, string> = {}
    for (const field of activeFields) {
      // Never pre-fill secret fields (Fix #60 / Fix #69)
      if (field.secret) continue
      nextFields[field.key] = bot.configValues?.[field.key] ?? ''
    }
    setBotFields(nextFields)
    setDraftChatRoomId(bot.chatRoomId ?? '__none__')
  }

  const handleSaveBot = async () => {
    if (!botName.trim()) {
      toast.error('请输入机器人名称')
      return
    }
    const missingFields = activeFields
      .filter((field) => {
        const value = botFields[field.key]?.trim()
        if (editingBotId && field.secret && !value) return false
        return !value
      })
      .map((field) => field.label)

    if (missingFields.length > 0) {
      toast.error(`请填写：${missingFields.join('、')}`)
      return
    }
    setSavingBot(true)
    try {
      // Build config: always include non-secret fields so server receives complete config (Fix #61).
      // Secret fields are omitted when blank (meaning "keep existing").
      const configData: Record<string, unknown> = {}
      for (const field of activeFields) {
        if (field.secret) continue
        const value = botFields[field.key]?.trim()
        if (value) configData[field.key] = value
      }

      if (editingBotId) {
        // Collect secret fields that were explicitly filled
        const secretToken = activeFields.find((f) => f.secret && f.key === 'botToken')
          ? botFields.botToken?.trim() || undefined
          : undefined
        await bridgeApi.updateBot(editingBotId, {
          name: botName.trim(),
          config: Object.keys(configData).length > 0 ? configData : null,
          botToken: secretToken,
        })
        toast.success('机器人实例已更新')
      } else {
        const targetRoomId = draftChatRoomId === '__none__' ? undefined : draftChatRoomId
        await bridgeApi.createBot({
          platform: activePlatform,
          name: botName.trim(),
          config: Object.keys(configData).length > 0 ? configData : undefined,
          botToken: botFields.botToken?.trim() || undefined,
          chatRoomId: targetRoomId,
        })
        toast.success('机器人实例已创建')
      }
      // After mutation only refetch bots (Fix #70)
      await loadBots(activePlatform)
      cancelBotEditor()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingBot(false)
    }
  }

  const addPending = (botId: string) =>
    setPendingBotIds((prev) => new Set(prev).add(botId))
  const removePending = (botId: string) =>
    setPendingBotIds((prev) => { const next = new Set(prev); next.delete(botId); return next })

  const handleDeleteBot = async (bot: BridgeBot) => {
    addPending(bot.id)
    try {
      await bridgeApi.deleteBot(bot.id)
      toast.success('机器人实例已删除')
      if (editingBotId === bot.id) cancelBotEditor()
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    } finally {
      removePending(bot.id)
    }
  }

  const handleToggleBot = async (bot: BridgeBot) => {
    addPending(bot.id)
    try {
      await bridgeApi.updateBot(bot.id, { enabled: !bot.enabled })
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新失败')
    } finally {
      removePending(bot.id)
    }
  }

  const handleBindBot = async (bot: BridgeBot, chatRoomId: string, forceRebind = false) => {
    addPending(bot.id)
    try {
      await bridgeApi.bindBot(bot.id, chatRoomId, forceRebind)
      toast.success('绑定关系已更新')
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '绑定失败')
    } finally {
      removePending(bot.id)
    }
  }

  const handleSelectRoom = async (bot: BridgeBot, chatRoomId: string) => {
    const room = rooms.find((item) => item.id === chatRoomId)
    if (!room) return
    if (bot.chatRoomId && bot.chatRoomId !== chatRoomId) {
      setPendingRebind({
        botId: bot.id,
        chatRoomId,
        fromRoomName: bot.chatRoom?.name ?? bot.chatRoomId,
        toRoomName: room.name,
      })
      return
    }
    await handleBindBot(bot, chatRoomId)
  }

  const handleCopyWebhook = async (bot: BridgeBot) => {
    const platformDef = platforms.find((p) => p.key === bot.platform)
    if (!baseUrl || !platformDef?.requiresPublicWebhook) {
      toast.error('当前平台不需要 webhook，或尚未配置公网地址')
      return
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/bridge/webhook/${bot.platform}/${bot.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Webhook 地址已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  const handleUnbindBot = async (bot: BridgeBot) => {
    addPending(bot.id)
    try {
      await bridgeApi.unbindBot(bot.id)
      toast.success('已解绑')
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '解绑失败')
    } finally {
      removePending(bot.id)
    }
  }

  const handleSaveBaseUrl = async () => {
    setSavingBaseUrl(true)
    try {
      const result = await bridgeApi.setSystemConfig(baseUrlInput.trim())
      setBaseUrl(result.baseUrl)
      setBaseUrlInput(result.baseUrl)
      setEditingBaseUrl(false)
      toast.success('公网地址已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingBaseUrl(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (hasError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <span>加载失败，请重试</span>
        <button
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="size-3.5" />
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div
        className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6"
        style={ELECTRON_DRAG_STYLE}
      >
        <div className="flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          <h1 className="text-base font-semibold">外部平台集成</h1>
        </div>
        <div className="flex items-center gap-2" style={NO_DRAG_STYLE}>
          <button
            onClick={startCreateBot}
            className="rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
          >
            新建机器人实例
          </button>
        </div>
      </div>

      {/* Base URL bar */}
      <div className="border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-xs text-muted-foreground">服务公网地址</span>
          {editingBaseUrl ? (
            <>
              <input
                className="flex-1 rounded-lg border border-gray-200 bg-background px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                value={baseUrlInput}
                placeholder="https://your-domain.com"
                onChange={(event) => setBaseUrlInput(event.target.value)}
                style={NO_DRAG_STYLE}
              />
              <button
                onClick={handleSaveBaseUrl}
                disabled={savingBaseUrl}
                className="rounded bg-blue-500 px-2.5 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                style={NO_DRAG_STYLE}
              >
                {savingBaseUrl ? '保存中…' : '保存'}
              </button>
              {/* Fix #73: cancel button for base URL edit */}
              <button
                onClick={() => {
                  setEditingBaseUrl(false)
                  setBaseUrlInput(baseUrl)
                }}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                style={NO_DRAG_STYLE}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <span className={cn('flex-1 text-xs', baseUrl ? 'font-mono text-foreground' : 'italic text-muted-foreground')}>
                {baseUrl || '未配置（企业微信 / QQ / Telegram Webhook 场景需要）'}
              </span>
              <button
                onClick={() => setEditingBaseUrl(true)}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                style={NO_DRAG_STYLE}
              >
                <Pencil className="mr-1 inline size-3" />
                {baseUrl ? '修改' : '配置'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Platform tabs */}
      <div
        className="flex shrink-0 gap-2 border-b border-border px-6 pt-3"
        role="tablist"
      >
        {platforms.map((platform) => (
          <button
            key={platform.key}
            role="tab"
            aria-selected={activePlatform === platform.key}
            onClick={() => setActivePlatform(platform.key)}
            className={cn(
              'rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium',
              activePlatform === platform.key
                ? 'border-border bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            style={NO_DRAG_STYLE}
          >
            {platform.emoji} {platform.label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[360px_1fr] gap-0">
        {/* Left: editor form */}
        <div className="border-r border-border overflow-y-auto p-5">
          <BotEditorForm
            activePlatform={activePlatform}
            platformInfo={platformInfo}
            playbook={playbook}
            editingBotId={editingBotId}
            botName={botName}
            botFields={botFields}
            draftChatRoomId={draftChatRoomId}
            rooms={rooms}
            botsByRoomId={botsByRoomId}
            savingBot={savingBot}
            noDragStyle={NO_DRAG_STYLE}
            onBotNameChange={setBotName}
            onFieldChange={(key, value) => setBotFields((cur) => ({ ...cur, [key]: value }))}
            onDraftChatRoomIdChange={setDraftChatRoomId}
            onSave={handleSaveBot}
            onCancel={cancelBotEditor}
          />
        </div>

        {/* Right: bot list + sidebar */}
        <div className="min-h-0 overflow-hidden p-5">
          <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <BotListCard
              bots={bots}
              filteredBots={filteredBots}
              botSearch={botSearch}
              rooms={rooms}
              platforms={platforms}
              platformInfo={platformInfo}
              editingBotId={editingBotId}
              pendingBotIds={pendingBotIds}
              baseUrl={baseUrl}
              noDragStyle={NO_DRAG_STYLE}
              onBotSearchChange={setBotSearch}
              onStartEditBot={startEditBot}
              onToggleBot={handleToggleBot}
              onUnbindBot={handleUnbindBot}
              onSelectRoom={handleSelectRoom}
              onCopyWebhook={handleCopyWebhook}
              onDeleteBot={(bot) => setPendingDeleteBot(bot)}
            />

            <div className="space-y-4 self-start">
              {/* Linked rooms overview */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4">
                  <div className="text-sm font-semibold">群聊连接概览</div>
                  <div className="mt-1 text-xs text-muted-foreground">只展示已经接入外部机器人的群聊。</div>
                </div>
                <div className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
                  {linkedRooms.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                      还没有已连接的群聊
                    </div>
                  ) : (
                    linkedRooms.map((room) => {
                      const roomBindings = botsByRoomId.get(room.id) ?? []
                      return (
                        <div key={room.id} className="rounded-lg border border-border bg-muted/30 px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{room.name}</div>
                              <div className="mt-1 text-[11px] text-muted-foreground">
                                已连接 {roomBindings.length} 个机器人
                              </div>
                            </div>
                            <div className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                              在线桥接
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {roomBindings.map((item) => (
                              <span
                                key={item.id}
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] text-gray-700"
                              >
                                <span className="font-medium">{item.name}</span>
                                <span className="text-gray-400">·</span>
                                <span>{platformLabel(platforms, item.platform)}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Recent events */}
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-4">
                  <div className="text-sm font-semibold">最近同步事件</div>
                  <div className="mt-1 text-xs text-muted-foreground">展示最近一次流入或流出的消息情况。</div>
                </div>
                <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                  {events.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                      暂无事件
                    </div>
                  ) : (
                    events.map((event: BridgeEvent) => (
                      <div key={event.id} className="rounded-xl border border-border bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                                {platformLabel(platforms, event.platform)}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
                                {event.direction === 'inbound'
                                  ? <ArrowDownLeft className="size-3.5 text-emerald-600" />
                                  : <ArrowUpRight className="size-3.5 text-blue-600" />}
                                {event.direction === 'inbound' ? '流入' : '流出'}
                              </span>
                            </div>
                            <div className="mt-2 line-clamp-3 text-[12px] leading-5 text-foreground">
                              {event.contentPreview || '这次同步还没有拿到可展示的消息内容。'}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <Clock3 className="size-3" />
                                {formatEventTime(event.createdAt)}
                              </span>
                              {event.agentName && <span>助手：{event.agentName}</span>}
                              {event.errorMsg ? (
                                <span className="text-red-500">{event.errorMsg}</span>
                              ) : (
                                <span className="truncate max-w-[160px]">会话：{event.externalId}</span>
                              )}
                            </div>
                          </div>
                          <span className={cn(
                            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            event.status === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500',
                          )}>
                            {event.status === 'success' ? (
                              <span className="inline-flex items-center gap-1">
                                <Check className="size-3.5" />
                                成功
                              </span>
                            ) : '失败'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rebind confirmation dialog (Fix #66: safe null check) */}
      <AlertDialog open={!!pendingRebind} onOpenChange={(open) => !open && setPendingRebind(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认换绑机器人</AlertDialogTitle>
            <AlertDialogDescription>
              这个机器人当前绑定在「{pendingRebind?.fromRoomName}」，确认后会自动解绑并改绑到「{pendingRebind?.toRoomName}」。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-500 hover:bg-blue-600"
              onClick={() => {
                if (!pendingRebind) return
                const rebindBot = bots.find((bot) => bot.id === pendingRebind.botId)
                if (!rebindBot) {
                  toast.error('机器人已不存在')
                  setPendingRebind(null)
                  return
                }
                void handleBindBot(rebindBot, pendingRebind.chatRoomId, true)
                setPendingRebind(null)
              }}
            >
              确认换绑
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={!!pendingDeleteBot}
        onOpenChange={(open) => !open && setPendingDeleteBot(null)}
        title="删除机器人实例"
        description={`确定删除「${pendingDeleteBot?.name ?? ''}」吗？删除后需要重新录入凭证。`}
        confirmText="删除"
        onConfirm={async () => {
          if (!pendingDeleteBot) return
          await handleDeleteBot(pendingDeleteBot)
          setPendingDeleteBot(null)
        }}
        icon={Trash2}
      />
    </div>
  )
}
