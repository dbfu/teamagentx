import { type ChatRoom } from '@/lib/agent-api'
import { type BridgeBot, type BridgePlatformDefinition, type BridgePlatformPlaybook, type Platform } from '@/lib/bridge-api'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2, Plug2, Unlink } from 'lucide-react'
import type { CSSProperties } from 'react'

interface BotEditorFormProps {
  activePlatform: Platform
  platformInfo: BridgePlatformDefinition | null
  playbook: BridgePlatformPlaybook | null
  editingBotId: string | null
  botName: string
  botFields: Record<string, string>
  draftChatRoomId: string
  rooms: ChatRoom[]
  botsByRoomId: Map<string, BridgeBot[]>
  savingBot: boolean
  noDragStyle: CSSProperties
  onBotNameChange: (value: string) => void
  onFieldChange: (key: string, value: string) => void
  onDraftChatRoomIdChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}

function RoomSelectLabel({ room, count }: { room: ChatRoom; count: number }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <GroupAvatarImage
        avatar={room.avatar ?? room.id}
        alt={room.name}
        className="size-6 rounded-full"
      />
      <span className="min-w-0 flex-1 truncate">{room.name}</span>
      {count > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground">
          已连 {count} 个机器人
        </span>
      )}
    </span>
  )
}

function NoRoomSelectLabel() {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
        <Unlink className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate">暂不绑定</span>
    </span>
  )
}

/**
 * Form for creating or editing a bridge bot instance.
 * Secret fields (field.secret === true) are never pre-filled on edit.
 */
export function BotEditorForm({
  activePlatform,
  platformInfo,
  playbook,
  editingBotId,
  botName,
  botFields,
  draftChatRoomId,
  rooms,
  botsByRoomId,
  savingBot,
  noDragStyle,
  onBotNameChange,
  onFieldChange,
  onDraftChatRoomIdChange,
  onSave,
  onCancel,
}: BotEditorFormProps) {
  const activeFields = platformInfo?.configFields ?? []
  const selectedDraftRoom = rooms.find((room) => room.id === draftChatRoomId) ?? null

  return (
    <div className="space-y-4">
      {playbook && (
        <Collapsible defaultOpen className="rounded-lg border border-border bg-card">
          <CollapsibleTrigger
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold text-foreground [&[data-state=open]>svg]:rotate-180"
            style={noDragStyle}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <Plug2 className="size-4 shrink-0 text-primary" />
              <span className="truncate">{playbook.title} 接入说明</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border px-4 py-3">
            <a
              href={activePlatform === 'feishu' ? 'https://open.feishu.cn/page/openclaw?form=multiAgent' : undefined}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'mb-3 block text-xs text-blue-600',
                activePlatform === 'feishu' ? 'hover:underline' : 'pointer-events-none hidden',
              )}
              style={noDragStyle}
            >
              飞书快捷创建机器人入口
            </a>
            <div className="space-y-3 text-xs text-muted-foreground">
              <div>
                <div className="mb-1 font-medium text-foreground">需要凭证</div>
                {playbook.requiredCredentials.map((item) => (
                  <div key={item.key}>• {item.label}：{item.howToGet}</div>
                ))}
              </div>
              <div>
                <div className="mb-1 font-medium text-foreground">接入后效果</div>
                <div>• 一个机器人实例最多绑定一个群聊</div>
                <div>• 一个群聊可以同时绑定多个平台机器人</div>
                <div>• 机器人收到的任意会话消息都会进入绑定群聊</div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div>
        <label htmlFor="bot-name" className="mb-1.5 block text-sm font-medium text-gray-700">
          机器人实例名称
        </label>
        <input
          id="bot-name"
          value={botName}
          onChange={(event) => onBotNameChange(event.target.value)}
          placeholder="例如：飞书客服机器人"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          style={noDragStyle}
        />
      </div>

      {activeFields.map((field) => (
        <div key={field.key}>
          <label
            htmlFor={`bot-field-${field.key}`}
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            {field.label}
          </label>
          <input
            id={`bot-field-${field.key}`}
            type={field.secret ? 'password' : 'text'}
            value={botFields[field.key] ?? ''}
            onChange={(event) => onFieldChange(field.key, event.target.value)}
            placeholder={editingBotId && field.secret ? '留空则保持不变' : `请输入${field.label}`}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            style={noDragStyle}
          />
        </div>
      ))}

      {!editingBotId && (
        <div>
          <label
            htmlFor="bot-draft-room"
            className="mb-1.5 block text-sm font-medium text-gray-700"
          >
            创建后直接绑定群聊
          </label>
          <Select
            value={draftChatRoomId}
            onValueChange={onDraftChatRoomIdChange}
          >
            <SelectTrigger
              id="bot-draft-room"
              className="h-11 w-full rounded-lg border-gray-200 focus:border-blue-500"
              style={noDragStyle}
            >
              {selectedDraftRoom ? (
                <RoomSelectLabel
                  room={selectedDraftRoom}
                  count={botsByRoomId.get(selectedDraftRoom.id)?.length ?? 0}
                />
              ) : (
                <NoRoomSelectLabel />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="py-2">
                <NoRoomSelectLabel />
              </SelectItem>
              {rooms.map((room) => {
                const count = botsByRoomId.get(room.id)?.length ?? 0
                return (
                  <SelectItem key={room.id} value={room.id} className="py-2">
                    <RoomSelectLabel room={room} count={count} />
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          disabled={savingBot}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          style={noDragStyle}
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={savingBot}
          className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
          style={noDragStyle}
        >
          {savingBot ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              保存中…
            </span>
          ) : editingBotId ? '更新机器人实例' : '创建机器人实例'}
        </button>
      </div>
    </div>
  )
}
