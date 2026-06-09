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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
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

const PLATFORM_ICON_URLS: Record<Platform, string> = {
  telegram: 'https://cdn.simpleicons.org/telegram/0088cc',
  feishu: 'https://cdn.jsdelivr.net/gh/callback-io/allogo@main/public/logos/feishu/icon.svg',
  dingtalk: 'https://api.iconify.design/ant-design:dingtalk-outlined.svg?color=%231675FF',
  wecom: 'https://api.iconify.design/tdesign:logo-wecom.svg?color=%2307C160',
  qq: 'https://cdn.simpleicons.org/qq/12B7F5',
}

export function IntegrationPage() {
  const { t } = useTranslation()
  const [activePlatform, setActivePlatform] = useState<Platform>('telegram')
  const { platforms, bots, rooms, playbook, events, baseUrl: loadedBaseUrl, loading, hasError, loadBots, reload } =
    useBridgeData(activePlatform)

  const [baseUrl, setBaseUrl] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [editingBaseUrl, setEditingBaseUrl] = useState(false)
  const [savingBaseUrl, setSavingBaseUrl] = useState(false)

  const [savingBot, setSavingBot] = useState(false)
  const [botEditorOpen, setBotEditorOpen] = useState(false)
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

  useEffect(() => {
    if (loading) return
    const nextBaseUrl = loadedBaseUrl ?? ''
    setBaseUrl(nextBaseUrl)
    if (!editingBaseUrl) {
      setBaseUrlInput(nextBaseUrl)
    }
  }, [editingBaseUrl, loadedBaseUrl, loading])

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
    setBotEditorOpen(false)
  }

  const startCreateBot = () => {
    if (editingBotId || botName.trim()) {
      if (!window.confirm(t('integration.discardChangesConfirm'))) return
    }
    setEditingBotId(null)
    setBotName(platformInfo?.label ? `${platformInfo.label} ${t('integration.bots')}` : '')
    setBotFields({})
    setDraftChatRoomId('__none__')
    setBotEditorOpen(true)
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
    setBotEditorOpen(true)
  }

  const handleBotEditorOpenChange = (open: boolean) => {
    if (open) {
      setBotEditorOpen(true)
      return
    }
    if (savingBot) return
    cancelBotEditor()
  }

  const handleSaveBot = async () => {
    if (!botName.trim()) {
      toast.error(t('integration.enterBotName'))
      return
    }
    const missingFields = activeFields
      .filter((field) => {
        if (field.optional) return false
        const value = botFields[field.key]?.trim()
        if (editingBotId && field.secret && !value) return false
        return !value
      })
      .map((field) => field.label)

    if (missingFields.length > 0) {
      toast.error(t('integration.fillRequiredFields', { fields: missingFields.join('、') }))
      return
    }
    setSavingBot(true)
    try {
      const configData: Record<string, unknown> = {}
      for (const field of activeFields) {
        const value = botFields[field.key]?.trim()
        if (field.key === 'botToken') continue
        if (value) {
          configData[field.key] = value
        }
      }

      if (editingBotId) {
        await bridgeApi.updateBot(editingBotId, {
          name: botName.trim(),
          config: Object.keys(configData).length > 0 ? configData : undefined,
          botToken: botFields.botToken?.trim() || undefined,
        })
        toast.success(t('integration.botUpdated'))
      } else {
        const targetRoomId = draftChatRoomId === '__none__' ? undefined : draftChatRoomId
        await bridgeApi.createBot({
          platform: activePlatform,
          name: botName.trim(),
          config: Object.keys(configData).length > 0 ? configData : undefined,
          botToken: botFields.botToken?.trim() || undefined,
          chatRoomId: targetRoomId,
        })
        toast.success(t('integration.botCreated'))
      }
      // After mutation only refetch bots (Fix #70)
      await loadBots(activePlatform)
      cancelBotEditor()
    } catch (error) {
      toast.error(t('integration.saveFailed'))
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
      toast.success(t('integration.botDeleted'))
      if (editingBotId === bot.id) cancelBotEditor()
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(t('integration.deleteFailed'))
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
      toast.error(t('integration.updateFailed'))
    } finally {
      removePending(bot.id)
    }
  }

  const handleBindBot = async (bot: BridgeBot, chatRoomId: string, forceRebind = false) => {
    addPending(bot.id)
    try {
      await bridgeApi.bindBot(bot.id, chatRoomId, forceRebind)
      toast.success(t('integration.bindUpdated'))
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(t('integration.bindFailed'))
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
      toast.error(t('integration.webhookNotNeeded'))
      return
    }
    const url = `${baseUrl.replace(/\/$/, '')}/api/bridge/webhook/${bot.platform}/${bot.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('integration.webhookCopied'))
    } catch {
      toast.error(t('integration.copyFailed'))
    }
  }

  const handleUnbindBot = async (bot: BridgeBot) => {
    addPending(bot.id)
    try {
      await bridgeApi.unbindBot(bot.id)
      toast.success(t('integration.unbound'))
      await loadBots(activePlatform)
    } catch (error) {
      toast.error(t('integration.unbindFailed'))
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
      toast.success(t('integration.publicUrlSaved'))
    } catch (error) {
      toast.error(t('integration.saveFailed'))
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
        <span>{t('integration.loadFailed')}</span>
        <button
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="size-3.5" />
          {t('integration.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div
        className="flex h-[52px] shrink-0 items-center border-b border-border bg-[var(--surface-raised)] px-4"
        style={ELECTRON_DRAG_STYLE}
      >
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <h1 className="text-base font-semibold">{t('integration.pageTitleAlt')}</h1>
        </div>
      </div>

      {/* Base URL bar */}
      <div className="border-b border-border bg-muted/30 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="shrink-0 text-xs text-muted-foreground">{t('integration.servicePublicUrl')}</span>
          {editingBaseUrl ? (
            <>
              <input
                className="flex-1 rounded-lg border border-gray-200 bg-background px-3 py-2 text-xs focus:border-blue-500 focus:outline-none"
                value={baseUrlInput}
                placeholder={t('integration.publicUrlPlaceholder')}
                onChange={(event) => setBaseUrlInput(event.target.value)}
                style={NO_DRAG_STYLE}
              />
              <button
                onClick={handleSaveBaseUrl}
                disabled={savingBaseUrl}
                className="rounded bg-blue-500 px-2.5 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                style={NO_DRAG_STYLE}
              >
                {savingBaseUrl ? t('common.saving') : t('common.save')}
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
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <>
              <span className={cn('flex-1 text-xs', baseUrl ? 'font-mono text-foreground' : 'italic text-muted-foreground')}>
                {baseUrl || t('integration.notConfigured')}
              </span>
              <button
                onClick={() => setEditingBaseUrl(true)}
                className="rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                style={NO_DRAG_STYLE}
              >
                <Pencil className="mr-1 inline size-3" />
                {baseUrl ? t('common.edit') : t('common.settings')}
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
        {platforms.map((platform) => {
          return (
            <button
              key={platform.key}
              role="tab"
              aria-selected={activePlatform === platform.key}
              onClick={() => setActivePlatform(platform.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium',
                activePlatform === platform.key
                  ? 'border-border bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              style={NO_DRAG_STYLE}
            >
              <img
                src={PLATFORM_ICON_URLS[platform.key]}
                alt=""
                aria-hidden="true"
                className="size-4 shrink-0 object-contain"
              />
              {platform.label}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-5">
        <div className="grid h-full gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <BotListCard
            bots={bots}
            filteredBots={filteredBots}
            botSearch={botSearch}
            rooms={rooms}
            platforms={platforms}
            editingBotId={editingBotId}
            pendingBotIds={pendingBotIds}
            baseUrl={baseUrl}
            noDragStyle={NO_DRAG_STYLE}
            onBotSearchChange={setBotSearch}
            onCreateBot={startCreateBot}
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
                <div className="text-sm font-semibold">{t('integration.linkedRoomsTitle')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('integration.linkedRoomsHint')}</div>
              </div>
              <div className="max-h-[220px] space-y-3 overflow-y-auto pr-1">
                {linkedRooms.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                    {t('integration.noLinkedRooms')}
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
                              {t('integration.connectedCount', { count: roomBindings.length })}
                            </div>
                          </div>
                          <div className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                            {t('integration.onlineBridge')}
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
                <div className="text-sm font-semibold">{t('integration.recentEventsTitle')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('integration.recentEventsHint')}</div>
              </div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {events.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                    {t('integration.noEvents')}
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
                              {event.direction === 'inbound' ? t('integration.inbound') : t('integration.outbound')}
                            </span>
                          </div>
                          <div className="mt-2 line-clamp-3 text-[12px] leading-5 text-foreground">
                            {event.contentPreview || t('integration.noContentPreview')}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="size-3" />
                              {formatEventTime(event.createdAt)}
                            </span>
                            {event.agentName && <span>{t('integration.agentLabel', { name: event.agentName })}</span>}
                            {event.errorMsg ? (
                              <span className="text-red-500">{event.errorMsg}</span>
                            ) : (
                              <span className="truncate max-w-[160px]">{t('integration.sessionLabel', { id: event.externalId })}</span>
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
                              {t('integration.success')}
                            </span>
                          ) : t('integration.failed')}
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

      <Dialog open={botEditorOpen} onOpenChange={handleBotEditorOpenChange}>
        <DialogContent
          className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl"
          style={NO_DRAG_STYLE}
        >
          <DialogHeader>
            <DialogTitle>{editingBotId ? t('integration.editBotInstance') : t('integration.newBotInstance')}</DialogTitle>
            <DialogDescription>
              {editingBotId
                ? t('integration.editBotHint')
                : t('integration.newBotHint', { platform: platformInfo?.label ?? t('integration.pageTitle') })}
            </DialogDescription>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>

      {/* Rebind confirmation dialog (Fix #66: safe null check) */}
      <AlertDialog open={!!pendingRebind} onOpenChange={(open) => !open && setPendingRebind(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('integration.confirmRebindBot')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('integration.rebindHint', { from: pendingRebind?.fromRoomName, to: pendingRebind?.toRoomName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-blue-500 hover:bg-blue-600"
              onClick={() => {
                if (!pendingRebind) return
                const rebindBot = bots.find((bot) => bot.id === pendingRebind.botId)
                if (!rebindBot) {
                  toast.error(t('integration.botNotFound'))
                  setPendingRebind(null)
                  return
                }
                void handleBindBot(rebindBot, pendingRebind.chatRoomId, true)
                setPendingRebind(null)
              }}
            >
              {t('integration.confirmRebind')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmDialog
        open={!!pendingDeleteBot}
        onOpenChange={(open) => !open && setPendingDeleteBot(null)}
        title={t('integration.deleteBotInstance')}
        description={t('integration.deleteBotConfirmWithName', { name: pendingDeleteBot?.name ?? '' })}
        confirmText={t('common.delete')}
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
