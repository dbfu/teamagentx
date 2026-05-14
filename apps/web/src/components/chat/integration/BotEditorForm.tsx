import { type ChatRoom } from '@/lib/agent-api'
import { type BridgeBot, type BridgePlatformDefinition, type BridgePlatformPlaybook, type Platform } from '@/lib/bridge-api'
import { cn } from '@/lib/utils'
import { Loader2, Plug2 } from 'lucide-react'
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

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="text-sm font-semibold text-foreground">
          {editingBotId ? '编辑机器人实例' : '新建机器人实例'}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {editingBotId
            ? '修改完成后保存；如果不想继续编辑，可以直接取消。'
            : '录入平台凭证后，可以直接绑定到目标群聊。'}
        </div>
      </div>

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
          <select
            id="bot-draft-room"
            value={draftChatRoomId}
            onChange={(event) => onDraftChatRoomIdChange(event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            style={noDragStyle}
          >
            <option value="__none__">暂不绑定</option>
            {rooms.map((room) => {
              const count = botsByRoomId.get(room.id)?.length ?? 0
              return (
                <option key={room.id} value={room.id}>
                  {room.name}{count > 0 ? `（已连 ${count} 个机器人）` : ''}
                </option>
              )
            })}
          </select>
        </div>
      )}

      <button
        onClick={onSave}
        disabled={savingBot}
        className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        style={noDragStyle}
      >
        {savingBot ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            保存中…
          </span>
        ) : editingBotId ? '更新机器人实例' : '创建机器人实例'}
      </button>

      {editingBotId && (
        <button
          onClick={onCancel}
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          style={noDragStyle}
        >
          取消编辑，返回新建
        </button>
      )}

      {playbook && (
        <div className="mt-2 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Plug2 className="size-4 text-primary" />
            {playbook.title} 接入说明
          </div>
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
        </div>
      )}
    </div>
  )
}
