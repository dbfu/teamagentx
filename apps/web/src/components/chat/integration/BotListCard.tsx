import { useTranslation } from 'react-i18next'
import { type ChatRoom } from '@/lib/agent-api'
import { type BridgeBot, type BridgePlatformDefinition } from '@/lib/bridge-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { Bot, Link2, MoreHorizontal, Plus, Search, Trash2, Unplug } from 'lucide-react'
import type { CSSProperties } from 'react'

interface BotListCardProps {
  bots: BridgeBot[]
  filteredBots: BridgeBot[]
  botSearch: string
  rooms: ChatRoom[]
  platforms: BridgePlatformDefinition[]
  editingBotId: string | null
  pendingBotIds: Set<string>
  baseUrl: string
  noDragStyle: CSSProperties
  onBotSearchChange: (value: string) => void
  onCreateBot: () => void
  onStartEditBot: (bot: BridgeBot) => void
  onToggleBot: (bot: BridgeBot) => void
  onUnbindBot: (bot: BridgeBot) => void
  onSelectRoom: (bot: BridgeBot, roomId: string) => void
  onCopyWebhook: (bot: BridgeBot) => void
  onDeleteBot: (bot: BridgeBot) => void
}

/** Returns the webhook URL for platforms that require a public endpoint. */
function buildWebhookUrl(baseUrl: string, bot: BridgeBot, platforms: BridgePlatformDefinition[]) {
  if (!baseUrl) return ''
  const platformDef = platforms.find((p) => p.key === bot.platform)
  if (!platformDef?.requiresPublicWebhook) return ''
  return `${baseUrl.replace(/\/$/, '')}/api/bridge/webhook/${bot.platform}/${bot.id}`
}

type BindingRoomOption = Pick<ChatRoom, 'id' | 'name' | 'avatar'>

function RoomBindingLabel({ room }: { room: BindingRoomOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <GroupAvatarImage
        avatar={room.avatar ?? room.id}
        alt={room.name}
        className="size-5 rounded-full"
      />
      <span className="min-w-0 flex-1 truncate">{room.name}</span>
    </span>
  )
}

function NoRoomBindingLabel() {
  const { t } = useTranslation()
  return <span className="truncate text-muted-foreground">{t('integration.notBound')}</span>
}

export function BotListCard({
  bots,
  filteredBots,
  botSearch,
  rooms,
  platforms,
  editingBotId,
  pendingBotIds,
  baseUrl,
  noDragStyle,
  onBotSearchChange,
  onCreateBot,
  onStartEditBot,
  onToggleBot,
  onUnbindBot,
  onSelectRoom,
  onCopyWebhook,
  onDeleteBot,
}: BotListCardProps) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">{t('integration.botListTitle')}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {t('integration.botListHint', { count: bots.length })}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto" style={noDragStyle}>
            <button
              onClick={onCreateBot}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
            >
              <Plus className="size-4" />
              {t('integration.createBotInstance')}
            </button>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input
                value={botSearch}
                onChange={(event) => onBotSearchChange(event.target.value)}
                placeholder={t('integration.searchBotPlaceholder')}
                className="w-full rounded-lg border border-gray-200 bg-background py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {bots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-sm text-muted-foreground">
              {t('integration.noBotsHint')}
            </div>
          ) : filteredBots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-sm text-muted-foreground">
              {t('integration.noMatchingBots', { search: botSearch })}
            </div>
          ) : (
            filteredBots.map((bot) => {
              const isPending = pendingBotIds.has(bot.id)
              const webhookUrl = buildWebhookUrl(baseUrl, bot, platforms)
              const hasBoundRoomInList = Boolean(
                bot.chatRoomId && rooms.some((room) => room.id === bot.chatRoomId),
              )
              const selectedRoom: BindingRoomOption | null = bot.chatRoomId
                ? rooms.find((room) => room.id === bot.chatRoomId) ?? {
                    id: bot.chatRoomId,
                    name: bot.chatRoom?.name ?? t('integration.boundRoomFallback'),
                    avatar: bot.chatRoomId,
                  }
                : null
              return (
                <div
                  key={bot.id}
                  className={cn(
                    'rounded-xl border bg-background transition-colors',
                    editingBotId === bot.id ? 'border-blue-300 bg-blue-50/30' : 'border-border hover:border-gray-300',
                    isPending && 'opacity-60',
                  )}
                >
                  <div className="flex items-center gap-0 divide-x divide-border">
                    {/* Bot info area */}
                    <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
                      <div className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl',
                        editingBotId === bot.id ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600',
                      )}>
                        <Bot className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{bot.name}</span>
                          {editingBotId === bot.id && (
                            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              {t('integration.editing')}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="flex items-center gap-1 text-[11px]">
                            <span className={cn(
                              'size-1.5 rounded-full',
                              bot.enabled ? 'bg-green-500' : 'bg-gray-300',
                            )} />
                            <span className={bot.enabled ? 'text-green-700' : 'text-gray-500'}>
                              {bot.enabled ? t('integration.enabled') : t('integration.disabled')}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Room binding area */}
                    <div className="flex w-[220px] shrink-0 items-center px-4 py-3" style={noDragStyle}>
                      <div className="flex w-full items-center gap-1.5">
                        <Select
                          value={bot.chatRoomId ?? '__none__'}
                          disabled={isPending}
                          onValueChange={(nextRoomId) => {
                            if (nextRoomId === '__none__') {
                              onUnbindBot(bot)
                              return
                            }
                            onSelectRoom(bot, nextRoomId)
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="min-w-0 flex-1 rounded-lg border-gray-200 bg-background text-xs focus:border-blue-500"
                          >
                            {selectedRoom ? <RoomBindingLabel room={selectedRoom} /> : <NoRoomBindingLabel />}
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              <NoRoomBindingLabel />
                            </SelectItem>
                            {bot.chatRoomId && !hasBoundRoomInList && (
                              <SelectItem value={bot.chatRoomId}>
                                {selectedRoom ? <RoomBindingLabel room={selectedRoom} /> : t('integration.boundRoomFallback')}
                              </SelectItem>
                            )}
                            {rooms.map((room) => (
                              <SelectItem key={room.id} value={room.id}>
                                <RoomBindingLabel room={room} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {bot.chatRoomId && (
                          <button
                            disabled={isPending}
                            onClick={() => onUnbindBot(bot)}
                            title={t('integration.unbind')}
                            className="shrink-0 rounded-lg border border-gray-200 p-1.5 text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                          >
                            <Unplug className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Action area */}
                    <div className="flex shrink-0 items-center gap-1.5 px-3 py-3" style={noDragStyle}>
                      <button
                        disabled={isPending}
                        onClick={() => onStartEditBot(bot)}
                        className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                      >
                        {t('integration.edit')}
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            disabled={isPending}
                            className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => onToggleBot(bot)}>
                            {bot.enabled ? t('integration.disableBot') : t('integration.enableBot')}
                          </DropdownMenuItem>
                          {webhookUrl && (
                            <DropdownMenuItem onClick={() => onCopyWebhook(bot)}>
                              <Link2 className="size-3.5" />
                              {t('integration.copyWebhook')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onDeleteBot(bot)}
                          >
                            <Trash2 className="size-3.5" />
                            {t('integration.deleteBot')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
