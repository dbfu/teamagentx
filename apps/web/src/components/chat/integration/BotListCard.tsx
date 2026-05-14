import { type ChatRoom } from '@/lib/agent-api'
import { type BridgeBot, type BridgePlatformDefinition } from '@/lib/bridge-api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Bot, Link2, MoreHorizontal, Search, Trash2, Unplug } from 'lucide-react'
import type { CSSProperties } from 'react'

interface BotListCardProps {
  bots: BridgeBot[]
  filteredBots: BridgeBot[]
  botSearch: string
  rooms: ChatRoom[]
  platforms: BridgePlatformDefinition[]
  platformInfo: BridgePlatformDefinition | null
  editingBotId: string | null
  pendingBotIds: Set<string>
  baseUrl: string
  noDragStyle: CSSProperties
  onBotSearchChange: (value: string) => void
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

export function BotListCard({
  bots,
  filteredBots,
  botSearch,
  rooms,
  platforms,
  platformInfo,
  editingBotId,
  pendingBotIds,
  baseUrl,
  noDragStyle,
  onBotSearchChange,
  onStartEditBot,
  onToggleBot,
  onUnbindBot,
  onSelectRoom,
  onCopyWebhook,
  onDeleteBot,
}: BotListCardProps) {
  return (
    <div className="flex min-h-0 flex-col rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">机器人实例列表</div>
            <div className="mt-1 text-xs text-muted-foreground">
              当前平台共 {bots.length} 个机器人实例，展示群聊绑定、状态和快捷操作。
            </div>
          </div>
          <div className="relative w-full lg:w-72" style={noDragStyle}>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input
              value={botSearch}
              onChange={(event) => onBotSearchChange(event.target.value)}
              placeholder="搜索机器人、群聊或平台"
              className="w-full rounded-lg border border-gray-200 bg-background pl-9 pr-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-3">
          {bots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-sm text-muted-foreground">
              当前平台还没有机器人实例。左侧保存凭证后，这里会立刻显示列表。
            </div>
          ) : filteredBots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-sm text-muted-foreground">
              没有找到匹配"{botSearch}"的机器人实例。
            </div>
          ) : (
            filteredBots.map((bot) => {
              const isPending = pendingBotIds.has(bot.id)
              const webhookUrl = buildWebhookUrl(baseUrl, bot, platforms)
              return (
                <div
                  key={bot.id}
                  className={cn(
                    'rounded-xl border bg-background px-4 py-3 transition-colors',
                    editingBotId === bot.id ? 'border-blue-300 bg-blue-50/40' : 'border-border',
                    isPending && 'opacity-60',
                  )}
                >
                  <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_minmax(180px,220px)_auto] xl:items-center">
                    <div className="min-w-[240px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                          <Bot className="size-4" />
                        </div>
                        <div className="truncate text-sm font-semibold">{bot.name}</div>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                          {platformInfo?.label ?? bot.platform}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[11px]',
                            bot.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600',
                          )}
                        >
                          {bot.enabled ? '启用中' : '已停用'}
                        </span>
                        {editingBotId === bot.id && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                            正在编辑
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 flex items-center gap-2" style={noDragStyle}>
                      <select
                        value={bot.chatRoomId ?? '__none__'}
                        disabled={isPending}
                        onChange={(event) => {
                          const nextRoomId = event.target.value
                          if (nextRoomId === '__none__') {
                            onUnbindBot(bot)
                            return
                          }
                          onSelectRoom(bot, nextRoomId)
                        }}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
                      >
                        <option value="__none__">未绑定群聊</option>
                        {rooms.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                      {bot.chatRoomId && (
                        <button
                          disabled={isPending}
                          onClick={() => onUnbindBot(bot)}
                          className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Unplug className="mr-1 inline size-3.5" />
                          解绑
                        </button>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1.5" style={noDragStyle}>
                      <button
                        disabled={isPending}
                        onClick={() => onStartEditBot(bot)}
                        className="rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        编辑
                      </button>

                      <div className="hidden 2xl:flex 2xl:flex-nowrap 2xl:items-center 2xl:gap-1.5">
                        <button
                          disabled={isPending}
                          onClick={() => onToggleBot(bot)}
                          className="rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {bot.enabled ? '停用' : '启用'}
                        </button>

                        {webhookUrl && (
                          <button
                            onClick={() => onCopyWebhook(bot)}
                            className="rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            <Link2 className="mr-1 inline size-3.5" />
                            Webhook
                          </button>
                        )}

                        <button
                          disabled={isPending}
                          onClick={() => onDeleteBot(bot)}
                          className="rounded-lg border border-red-200 px-2 py-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          删除
                        </button>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            disabled={isPending}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-2 text-xs text-gray-600 hover:bg-gray-50 2xl:hidden disabled:opacity-50"
                          >
                            <MoreHorizontal className="size-3.5" />
                            更多
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 2xl:hidden">
                          <DropdownMenuItem onClick={() => onToggleBot(bot)}>
                            {bot.enabled ? '停用机器人' : '启用机器人'}
                          </DropdownMenuItem>
                          {webhookUrl && (
                            <DropdownMenuItem onClick={() => onCopyWebhook(bot)}>
                              <Link2 className="size-3.5" />
                              复制 Webhook
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => onDeleteBot(bot)}
                          >
                            <Trash2 className="size-3.5" />
                            删除机器人
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
