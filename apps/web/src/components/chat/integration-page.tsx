import { agentApi, chatRoomApi, type Agent, type ChatRoom } from '@/lib/agent-api'
import { bridgeApi, type BridgeEvent, type ExternalChannel, type Platform, type PlatformConfig, type CreateChannelRequest } from '@/lib/bridge-api'
import { cn } from '@/lib/utils'
import { Check, ChevronDown, ChevronRight, Copy, Globe, Plus, Settings, Trash2, X } from 'lucide-react'
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

// 支持自动建群的平台（只需全局填一次凭证）
const AUTO_CREATE_PLATFORMS: Platform[] = ['telegram', 'feishu', 'dingtalk', 'wecom', 'qq']

const PLATFORM_CONFIG_FIELDS: Record<Platform, { key: string; label: string; secret?: boolean }[]> = {
  telegram: [{ key: 'botToken', label: 'Bot Token', secret: true }],
  feishu: [
    { key: 'appId', label: 'App ID' },
    { key: 'appSecret', label: 'App Secret', secret: true },
  ],
  dingtalk: [
    { key: 'appKey', label: 'App Key' },
    { key: 'appSecret', label: 'App Secret', secret: true },
    { key: 'robotCode', label: 'Robot Code' },
  ],
  wecom: [
    { key: 'corpId', label: 'Corp ID' },
    { key: 'agentSecret', label: 'Agent Secret', secret: true },
  ],
  qq: [
    { key: 'appId', label: 'App ID' },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
  ],
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
  // 平台全局配置（自动建群用）
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null)
  const [configForm, setConfigForm] = useState<Record<string, string>>({ defaultAgentId: '' })
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  // 最近事件
  const [events, setEvents] = useState<BridgeEvent[]>([])
  const [eventsOpen, setEventsOpen] = useState(false)

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    loadChannels()
    setConfigForm({ defaultAgentId: '' })
    setPlatformConfig(null)
    if (AUTO_CREATE_PLATFORMS.includes(activePlatform)) {
      loadPlatformConfig()
    }
    loadEvents()
  }, [activePlatform])

  const loadEvents = async () => {
    const data = await bridgeApi.listEvents(activePlatform, 20).catch(() => [])
    setEvents(data)
  }

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

  const loadPlatformConfig = async () => {
    const cfg = await bridgeApi.getPlatformConfig(activePlatform).catch(() => null)
    if (cfg) {
      setPlatformConfig(cfg)
      setConfigForm({ defaultAgentId: cfg.defaultAgentId ?? '' })
    }
  }

  const handleSaveConfig = async () => {
    setIsSavingConfig(true)
    try {
      const defaultAgentId = configForm.defaultAgentId || null
      let cfg: PlatformConfig
      if (activePlatform === 'telegram') {
        cfg = await bridgeApi.setPlatformConfig('telegram', {
          botToken: configForm.botToken || undefined,
          defaultAgentId,
        })
      } else {
        const fields = PLATFORM_CONFIG_FIELDS[activePlatform]
        const configData: Record<string, unknown> = {}
        for (const field of fields) {
          if (configForm[field.key]) {
            configData[field.key] = configForm[field.key]
          }
        }
        cfg = await bridgeApi.setPlatformConfig(activePlatform, {
          config: Object.keys(configData).length > 0 ? configData : undefined,
          defaultAgentId,
        })
      }
      setPlatformConfig(cfg)
      // 清空 secret 字段
      setConfigForm(f => {
        const next = { ...f }
        const fields = PLATFORM_CONFIG_FIELDS[activePlatform]
        for (const field of fields) {
          if (field.secret) next[field.key] = ''
        }
        return next
      })
      toast.success('配置已保存，将机器人拉入群后会自动建立连接')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setIsSavingConfig(false)
    }
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
        {!AUTO_CREATE_PLATFORMS.includes(activePlatform) && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white hover:bg-blue-600"
          >
            <Plus className="size-4" />
            新增连接
          </button>
        )}
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

            {/* 自动建群配置（所有平台） */}
            {AUTO_CREATE_PLATFORMS.includes(activePlatform) && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                <div className="mb-3">
                  <p className="text-sm font-medium text-gray-800">🤖 自动建群配置</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    填写平台凭证后，将机器人拉入任意群，系统自动建立连接，无需手动填写群 ID。
                    {(platformConfig?.botToken || platformConfig?.hasConfig) && (
                      <span className="ml-1 font-medium text-green-600">✓ 已配置</span>
                    )}
                  </p>
                </div>
                <div className="space-y-3">
                  {PLATFORM_CONFIG_FIELDS[activePlatform].map(field => (
                    <div key={field.key}>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">
                        {field.label}
                        {platformConfig?.hasConfig && field.secret && (
                          <span className="ml-1 text-xs font-normal text-green-600">（已设置，留空不修改）</span>
                        )}
                        {activePlatform === 'telegram' && field.key === 'botToken' && platformConfig?.botToken && (
                          <span className="ml-1 text-xs font-normal text-green-600">（已设置，留空不修改）</span>
                        )}
                      </label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={configForm[field.key] ?? ''}
                        onChange={e => setConfigForm(f => ({ ...f, [field.key]: e.target.value }))}
                        placeholder={
                          (field.secret && (platformConfig?.hasConfig || (activePlatform === 'telegram' && platformConfig?.botToken)))
                            ? '留空不修改'
                            : field.label
                        }
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-gray-700">默认助手</label>
                    <select
                      value={configForm.defaultAgentId ?? ''}
                      onChange={e => setConfigForm(f => ({ ...f, defaultAgentId: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="">不指定</option>
                      {agents.filter(a => a.isActive).map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleSaveConfig}
                    disabled={isSavingConfig}
                    className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {isSavingConfig ? '保存中...' : '保存配置'}
                  </button>
                </div>
              </div>
            )}

            {/* Channels */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-700">
                  已连接的群组
                  <span className="ml-1.5 text-muted-foreground">({channels.length})</span>
                </h2>
                {!AUTO_CREATE_PLATFORMS.includes(activePlatform) && (
                  <button
                    onClick={openCreate}
                    className="flex items-center gap-1 text-sm text-blue-500 hover:text-blue-600"
                  >
                    <Plus className="size-3.5" />
                    添加新群组
                  </button>
                )}
              </div>

              {channels.length === 0 ? (
                <EmptyState platform={platformInfo} isAutoCreate={AUTO_CREATE_PLATFORMS.includes(activePlatform)} onAdd={openCreate} />
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

            {/* Recent Events */}
            <div className="border-t border-border pt-4">
              <button
                onClick={() => setEventsOpen(o => !o)}
                className="flex w-full items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
              >
                <span>
                  最近事件
                  <span className="ml-1.5 font-normal text-muted-foreground">({events.length})</span>
                </span>
                {eventsOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              </button>
              {eventsOpen && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                  {events.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">暂无事件记录</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-gray-50 text-left text-muted-foreground">
                          <th className="px-3 py-2 font-medium">时间</th>
                          <th className="px-3 py-2 font-medium">方向</th>
                          <th className="px-3 py-2 font-medium">状态</th>
                          <th className="px-3 py-2 font-medium">来源群组</th>
                          <th className="px-3 py-2 font-medium">助手</th>
                          <th className="px-3 py-2 font-medium">错误</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map(ev => (
                          <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-gray-50">
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {new Date(ev.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td className="px-3 py-2">
                              {ev.direction === 'inbound' ? '入站' : '出站'}
                            </td>
                            <td className="px-3 py-2">
                              {ev.status === 'success' ? '✅' : '❌'}
                            </td>
                            <td className="max-w-[120px] truncate px-3 py-2 text-muted-foreground" title={ev.externalId}>
                              {ev.externalId}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {ev.agentName ?? '—'}
                            </td>
                            <td className="max-w-[160px] truncate px-3 py-2 text-red-500" title={ev.errorMsg ?? ''}>
                              {ev.errorMsg ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
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
  isAutoCreate,
  onAdd,
}: {
  platform: { emoji: string; label: string; key: Platform }
  isAutoCreate: boolean
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card py-12 text-center">
      <div className="mb-3 text-4xl">{platform.emoji}</div>
      <p className="mb-1 font-medium text-gray-700">尚未连接任何 {platform.label} 群组</p>
      {isAutoCreate ? (
        <p className="text-sm text-muted-foreground">
          保存凭证配置后，将机器人拉入群，群组会自动出现在这里
        </p>
      ) : (
        <>
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
        </>
      )}
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
