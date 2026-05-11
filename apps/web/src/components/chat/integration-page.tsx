import { agentApi, chatRoomApi, type Agent, type ChatRoom } from '@/lib/agent-api'
import { bridgeApi, type ExternalChannel, type Platform, type CreateChannelRequest } from '@/lib/bridge-api'
import { cn } from '@/lib/utils'
import { Check, Copy, Globe, Plus, Settings, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

const PLATFORMS: { key: Platform; label: string; emoji: string; color: string }[] = [
  { key: 'telegram', label: 'Telegram', emoji: '✈️', color: '#0088cc' },
  { key: 'feishu', label: '飞书', emoji: '🪶', color: '#1664FF' },
  { key: 'dingtalk', label: '钉钉', emoji: '📌', color: '#FF6400' },
  { key: 'wecom', label: '企业微信', emoji: '💬', color: '#07C160' },
  { key: 'qq', label: 'QQ', emoji: '🐧', color: '#12B7F5' },
]

const GROUP_ID_HINTS: Record<Platform, string> = {
  telegram: 'Telegram Chat ID（如 -100123456789）',
  feishu: '飞书 open_chat_id（如 oc_xxxxx）',
  dingtalk: '钉钉群 conversationId',
  wecom: '企业微信群 chat_id',
  qq: 'QQ 群号',
}

const SHOW_BOT_TOKEN: Platform[] = ['telegram', 'feishu']

interface CreateFormData {
  externalId: string
  chatRoomId: string
  botToken: string
  defaultAgentId: string
}

export function IntegrationPage() {
  const [activePlatform, setActivePlatform] = useState<Platform>('telegram')
  const [channels, setChannels] = useState<ExternalChannel[]>([])
  const [webhookUrls, setWebhookUrls] = useState<Record<Platform, string> | null>(null)
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingChannel, setEditingChannel] = useState<ExternalChannel | null>(null)
  const [formData, setFormData] = useState<CreateFormData>({
    externalId: '',
    chatRoomId: '',
    botToken: '',
    defaultAgentId: '',
  })

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    loadChannels()
  }, [activePlatform])

  const loadInitial = async () => {
    setIsLoading(true)
    const [roomsRes, agentsRes, urlsRes] = await Promise.all([
      chatRoomApi.getAll(),
      agentApi.getAll(),
      bridgeApi.getWebhookUrls().catch(() => null),
    ])
    if (roomsRes.success && roomsRes.data) setChatRooms(roomsRes.data)
    if (agentsRes.success && agentsRes.data) setAgents(agentsRes.data)
    if (urlsRes) setWebhookUrls(urlsRes)
    setIsLoading(false)
  }

  const loadChannels = async () => {
    const data = await bridgeApi.listChannels(activePlatform)
    setChannels(data)
  }

  const handleCopyWebhook = async () => {
    const url = webhookUrls?.[activePlatform]
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const openCreate = () => {
    setEditingChannel(null)
    setFormData({ externalId: '', chatRoomId: '', botToken: '', defaultAgentId: '' })
    setShowCreateForm(true)
  }

  const openEdit = (ch: ExternalChannel) => {
    setEditingChannel(ch)
    setFormData({
      externalId: ch.externalId,
      chatRoomId: ch.chatRoomId,
      botToken: ch.botToken ?? '',
      defaultAgentId: ch.defaultAgentId ?? '',
    })
    setShowCreateForm(true)
  }

  const handleSubmit = async () => {
    if (!formData.externalId.trim() || !formData.chatRoomId) {
      toast.error('请填写群组 ID 并选择 TeamAgentX 房间')
      return
    }
    setIsSubmitting(true)
    try {
      if (editingChannel) {
        await bridgeApi.updateChannel(editingChannel.id, {
          botToken: formData.botToken || undefined,
          defaultAgentId: formData.defaultAgentId || undefined,
        })
        toast.success('连接已更新')
      } else {
        const payload: CreateChannelRequest = {
          platform: activePlatform,
          externalId: formData.externalId.trim(),
          chatRoomId: formData.chatRoomId,
          botToken: formData.botToken || undefined,
          defaultAgentId: formData.defaultAgentId || undefined,
        }
        await bridgeApi.createChannel(payload)
        toast.success('连接已创建')
      }
      setShowCreateForm(false)
      await loadChannels()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该连接？')) return
    try {
      await bridgeApi.deleteChannel(id)
      toast.success('已删除')
      await loadChannels()
    } catch {
      toast.error('删除失败')
    }
  }

  const handleToggleEnabled = async (ch: ExternalChannel) => {
    try {
      await bridgeApi.updateChannel(ch.id, { enabled: !ch.enabled })
      await loadChannels()
    } catch {
      toast.error('更新失败')
    }
  }

  const platformInfo = PLATFORMS.find(p => p.key === activePlatform)!
  const webhookUrl = webhookUrls?.[activePlatform]

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 h-14 shrink-0">
        <div className="flex items-center gap-2">
          <Globe className="size-5 text-primary" />
          <h1 className="text-base font-semibold">外部平台集成</h1>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
        >
          <Plus className="size-4" />
          新增连接
        </button>
      </div>

      {/* Platform tabs */}
      <div className="flex gap-1 border-b border-border px-6 pt-3">
        {PLATFORMS.map(p => (
          <button
            key={p.key}
            onClick={() => setActivePlatform(p.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
              activePlatform === p.key
                ? 'border border-b-0 border-border bg-card text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{p.emoji}</span>
            {p.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
            加载中...
          </div>
        ) : (
          <div className="max-w-4xl space-y-6">
            {/* Webhook URL section */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-1.5 text-sm font-medium text-gray-700">
                {platformInfo.emoji} {platformInfo.label} Webhook 地址
              </div>
              {webhookUrl ? (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 break-all">
                    {webhookUrl}
                  </code>
                  <button
                    onClick={handleCopyWebhook}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 shrink-0"
                  >
                    {copiedUrl ? <Check className="size-4 text-green-500" /> : <Copy className="size-4" />}
                    {copiedUrl ? '已复制' : '复制'}
                  </button>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">无法获取 Webhook 地址，请检查服务配置</div>
              )}
            </div>

            {/* Channels */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-700">
                  已连接的群组
                  <span className="ml-1.5 text-muted-foreground">({channels.length})</span>
                </h2>
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600"
                >
                  <Plus className="size-3.5" />
                  添加新群组
                </button>
              </div>

              {channels.length === 0 ? (
                <EmptyState platform={platformInfo} onAdd={openCreate} />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {channels.map(ch => (
                    <ChannelCard
                      key={ch.id}
                      channel={ch}
                      platformColor={platformInfo.color}
                      onEdit={() => openEdit(ch)}
                      onDelete={() => handleDelete(ch.id)}
                      onToggle={() => handleToggleEnabled(ch)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Form Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <button
              onClick={() => setShowCreateForm(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
            >
              <X className="size-4" />
            </button>

            <h2 className="mb-4 text-base font-semibold">
              {editingChannel ? '编辑连接' : `新增 ${platformInfo.emoji} ${platformInfo.label} 群组`}
            </h2>

            <div className="space-y-4">
              {/* External ID */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  群组 ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.externalId}
                  onChange={e => setFormData(f => ({ ...f, externalId: e.target.value }))}
                  disabled={!!editingChannel}
                  placeholder={GROUP_ID_HINTS[activePlatform]}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {GROUP_ID_HINTS[activePlatform]}
                </p>
              </div>

              {/* ChatRoom */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  TeamAgentX 房间 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.chatRoomId}
                  onChange={e => setFormData(f => ({ ...f, chatRoomId: e.target.value }))}
                  disabled={!!editingChannel}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">请选择房间...</option>
                  {chatRooms.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Bot Token - only for certain platforms */}
              {SHOW_BOT_TOKEN.includes(activePlatform) && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Bot Token
                  </label>
                  <input
                    type="text"
                    value={formData.botToken}
                    onChange={e => setFormData(f => ({ ...f, botToken: e.target.value }))}
                    placeholder={activePlatform === 'telegram' ? '从 @BotFather 获取' : '飞书应用 token'}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Default Agent */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  默认助手
                </label>
                <select
                  value={formData.defaultAgentId}
                  onChange={e => setFormData(f => ({ ...f, defaultAgentId: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">不指定</option>
                  {agents.filter(a => a.isActive).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-60"
              >
                {isSubmitting ? '保存中...' : editingChannel ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState({
  platform,
  onAdd,
}: {
  platform: { emoji: string; label: string; key: Platform }
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card py-12 text-center">
      <div className="mb-3 text-4xl">{platform.emoji}</div>
      <p className="mb-1 font-medium text-gray-700">尚未连接任何 {platform.label} 群组</p>
      <p className="mb-4 text-sm text-muted-foreground">
        配置 Webhook 后，将群组连接到 TeamAgentX 即可开始收发消息
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
      >
        <Plus className="size-4" />
        添加群组
      </button>
    </div>
  )
}

function ChannelCard({
  channel,
  platformColor,
  onEdit,
  onDelete,
  onToggle,
}: {
  channel: ExternalChannel
  platformColor: string
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      {/* Top: group ID */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">群组 ID</p>
          <p className="truncate text-sm font-medium text-foreground" title={channel.externalId}>
            {channel.externalId}
          </p>
        </div>
        <span
          className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: channel.enabled ? platformColor : '#d1d5db' }}
        />
      </div>

      {/* Room */}
      <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-foreground font-medium truncate">{channel.chatRoom.name}</span>
      </div>

      {/* Default agent */}
      {channel.defaultAgent && (
        <div className="mb-3 text-xs text-muted-foreground">
          默认助手：{channel.defaultAgent.name}
        </div>
      )}

      {/* Status + actions */}
      <div className="mt-auto flex items-center justify-between pt-3 border-t border-border">
        <button
          onClick={onToggle}
          className={cn(
            'text-xs font-medium transition-colors',
            channel.enabled ? 'text-green-600 hover:text-green-700' : 'text-gray-400 hover:text-gray-600'
          )}
        >
          {channel.enabled ? '● 已启用' : '○ 已停用'}
        </button>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="设置"
          >
            <Settings className="size-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-500"
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
