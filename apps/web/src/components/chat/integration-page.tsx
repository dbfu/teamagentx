import { bridgeApi, type BridgeEvent, type BridgePlatformDefinition, type BridgePlatformPlaybook, type ExternalChannel, type Platform, type PlatformConfig } from '@/lib/bridge-api'
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
import { cn } from '@/lib/utils'
import { AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Copy, Globe, Loader2, Pencil, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'


export function IntegrationPage() {
  const [activePlatform, setActivePlatform] = useState<Platform>('telegram')
  const [platforms, setPlatforms] = useState<BridgePlatformDefinition[]>([])
  const [channels, setChannels] = useState<ExternalChannel[]>([])
  const [webhookUrls, setWebhookUrls] = useState<Partial<Record<Platform, string>> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copiedUrl, setCopiedUrl] = useState(false)
  // 平台凭证配置
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null)
  const [configForm, setConfigForm] = useState<Record<string, string>>({})
  const [isSavingConfig, setIsSavingConfig] = useState(false)
  const [isEditingConfig, setIsEditingConfig] = useState(false)
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  // 配置手册
  const [playbook, setPlaybook] = useState<BridgePlatformPlaybook | null>(null)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  // 最近事件
  const [events, setEvents] = useState<BridgeEvent[]>([])
  const [eventsOpen, setEventsOpen] = useState(false)
  // 公网地址配置
  const [baseUrl, setBaseUrl] = useState('')
  const [baseUrlInput, setBaseUrlInput] = useState('')
  const [isEditingBaseUrl, setIsEditingBaseUrl] = useState(false)
  const [isSavingBaseUrl, setIsSavingBaseUrl] = useState(false)

  const platformInfo = platforms.find(p => p.key === activePlatform) ?? null
  const activePlatformFields = platformInfo?.configFields ?? []
  const isConfigured = !!(platformConfig?.botToken || platformConfig?.hasConfig)

  useEffect(() => {
    loadInitial()
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setConfigForm({})
      setPlatformConfig(null)
      setIsEditingConfig(false)
      setPlaybook(null)
      const [chns, cfg, evts, pb] = await Promise.all([
        bridgeApi.listChannels(activePlatform).catch(() => [] as ExternalChannel[]),
        bridgeApi.getPlatformConfig(activePlatform).catch(() => null),
        bridgeApi.listEvents(activePlatform, 20).catch(() => [] as BridgeEvent[]),
        bridgeApi.getPlaybook(activePlatform).catch(() => null),
      ])
      if (cancelled) return
      setChannels(chns)
      setPlatformConfig(cfg)
      setEvents(evts)
      setPlaybook(pb)
    }
    load()
    return () => { cancelled = true }
  }, [activePlatform])

  const loadInitial = async () => {
    setIsLoading(true)
    try {
      const [platformDefs, urlsRes, sysCfg] = await Promise.all([
        bridgeApi.listPlatforms().catch(() => []),
        bridgeApi.getWebhookUrls().catch(() => null),
        bridgeApi.getSystemConfig().catch(() => ({ baseUrl: '' })),
      ])
      setPlatforms(platformDefs)
      if (urlsRes) setWebhookUrls(urlsRes)
      setBaseUrl(sysCfg.baseUrl)
      setBaseUrlInput(sysCfg.baseUrl)
      if (platformDefs.length > 0 && !platformDefs.find(p => p.key === activePlatform)) {
        setActivePlatform(platformDefs[0].key)
      }
    } catch (e) {
      console.error('加载失败', e)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveBaseUrl = async () => {
    setIsSavingBaseUrl(true)
    try {
      const result = await bridgeApi.setSystemConfig(baseUrlInput.trim())
      setBaseUrl(result.baseUrl)
      setBaseUrlInput(result.baseUrl)
      setIsEditingBaseUrl(false)
      const urls = await bridgeApi.getWebhookUrls().catch(() => null)
      if (urls) setWebhookUrls(urls)
      toast.success('公网地址已保存')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setIsSavingBaseUrl(false)
    }
  }

  const loadChannels = async () => {
    const data = await bridgeApi.listChannels(activePlatform)
    setChannels(data)
  }

  const handleSaveConfig = async () => {
    setIsSavingConfig(true)
    try {
      const configData: Record<string, unknown> = {}
      for (const field of activePlatformFields) {
        if (configForm[field.key]) configData[field.key] = configForm[field.key].trim()
      }
      const usesBotToken = activePlatformFields.some(f => f.key === 'botToken')
      const cfg = await bridgeApi.setPlatformConfig(activePlatform, {
        botToken: usesBotToken ? (configForm.botToken?.trim() || undefined) : undefined,
        config: Object.keys(configData).length > 0 ? configData : undefined,
      })
      setPlatformConfig(cfg)
      setConfigForm({})
      setIsEditingConfig(false)
      toast.success('凭证已保存，可在房间设置中生成绑定码完成群聊映射')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setIsSavingConfig(false)
    }
  }

  const handleClearConfig = async () => {
    const channelCount = channels.length
    setIsSavingConfig(true)
    try {
      if (channelCount > 0) {
        await Promise.all(channels.map(channel => bridgeApi.deleteChannel(channel.id)))
      }
      const cfg = await bridgeApi.setPlatformConfig(activePlatform, {
        botToken: '',
        config: null,
      })
      setChannels([])
      setPlatformConfig(cfg)
      setConfigForm({})
      setIsEditingConfig(false)
      setClearDialogOpen(false)
      toast.success(channelCount > 0 ? `平台配置已清空，并删除了 ${channelCount} 个群聊映射` : '平台配置已清空')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '清空失败')
    } finally {
      setIsSavingConfig(false)
    }
  }

  const handleCopyWebhook = async () => {
    const url = webhookUrls?.[activePlatform]
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2000)
    } catch {
      toast.error('复制失败，请手动复制')
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

  const webhookUrl = webhookUrls?.[activePlatform]

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center border-b border-border px-6 h-14 shrink-0">
        <Globe className="size-5 text-primary mr-2" />
        <h1 className="text-base font-semibold">外部平台集成</h1>
      </div>

      {/* 公网地址配置 */}
      <div className="border-b border-border px-6 py-3 bg-muted/30">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">服务公网地址</span>
          {isEditingBaseUrl ? (
            <>
              <input
                className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none bg-background"
                placeholder="https://your-domain.com"
                value={baseUrlInput}
                onChange={e => setBaseUrlInput(e.target.value)}
                onKeyDown={e => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') handleSaveBaseUrl(); if (e.key === 'Escape') { setIsEditingBaseUrl(false); setBaseUrlInput(baseUrl) } }}
                autoFocus
              />
              <button
                onClick={handleSaveBaseUrl}
                disabled={isSavingBaseUrl}
                className="shrink-0 rounded bg-blue-500 px-2.5 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {isSavingBaseUrl ? '保存中…' : '保存'}
              </button>
              <button
                onClick={() => { setIsEditingBaseUrl(false); setBaseUrlInput(baseUrl) }}
                className="shrink-0 rounded border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <span className={cn('flex-1 text-xs', baseUrl ? 'text-foreground font-mono' : 'text-muted-foreground italic')}>
                {baseUrl || '未配置（企业微信 / QQ webhook 需要）'}
              </span>
              <button
                onClick={() => { setIsEditingBaseUrl(true); setBaseUrlInput(baseUrl) }}
                className="shrink-0 flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                <Pencil className="size-3" />
                {baseUrl ? '修改' : '配置'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Platform tabs */}
      <div className="flex gap-1 border-b border-border px-6 pt-3">
        {platforms.map(p => (
          <button
            key={p.key}
            onClick={() => setActivePlatform(p.key)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
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
          <div className="max-w-4xl space-y-5">
            {/* 连接方式说明 */}
            {(activePlatform === 'feishu' || activePlatform === 'dingtalk') ? (
              <div className="rounded-xl border border-green-100 bg-green-50 p-4 flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🔌</span>
                <div>
                  <p className="text-sm font-medium text-green-800">WebSocket 长连接模式</p>
                  <p className="mt-0.5 text-xs text-green-700">
                    {activePlatform === 'feishu' ? '飞书' : '钉钉'}填写凭证后，服务端自动建立长连接接收消息，<strong>无需公网地址或 ngrok</strong>。
                  </p>
                </div>
              </div>
            ) : activePlatform === 'telegram' ? (
              <div className="rounded-xl border border-green-100 bg-green-50 p-4 flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">🔌</span>
                <div>
                  <p className="text-sm font-medium text-green-800">Polling 轮询模式</p>
                  <p className="mt-0.5 text-xs text-green-700">
                    Telegram 使用长轮询主动拉取消息，<strong>无需公网地址</strong>。已注册 Webhook 时自动切换为 Webhook 模式。
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 flex items-start gap-3">
                <span className="text-lg leading-none mt-0.5">⚠️</span>
                <div>
                  <p className="text-sm font-medium text-amber-800">需要公网地址</p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    {activePlatform === 'wecom' ? '企业微信' : 'QQ'} 仅支持 Webhook 回调，需要服务器有公网 IP 或使用{' '}
                    <a href="https://ngrok.com" target="_blank" rel="noopener noreferrer" className="underline">ngrok</a>
                    {' / '}
                    <a href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/" target="_blank" rel="noopener noreferrer" className="underline">Cloudflare Tunnel</a>
                    {' '}暴露本地端口。
                  </p>
                  <div className="mt-2">
                    <p className="text-xs font-medium text-amber-800 mb-1">Webhook 回调地址：</p>
                    {webhookUrl ? (
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-xs text-gray-600 break-all">
                          {webhookUrl}
                        </code>
                        <button
                          onClick={handleCopyWebhook}
                          className="flex items-center gap-1 rounded border border-amber-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-amber-50 shrink-0"
                        >
                          {copiedUrl ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                          {copiedUrl ? '已复制' : '复制'}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-600">无法获取地址，请检查服务配置</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 平台凭证配置 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">🔗 平台凭证</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    填写后，到房间设置里生成绑定码，在外部群发送 /bind CODE 完成绑定
                  </p>
                </div>
                {isConfigured && !isEditingConfig && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditingConfig(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      <Pencil className="size-3" />
                      修改
                    </button>
                    <button
                      onClick={() => setClearDialogOpen(true)}
                      disabled={isSavingConfig}
                      className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="size-3" />
                      清空
                    </button>
                  </div>
                )}
              </div>

              {/* 已配置展示态 */}
              {isConfigured && !isEditingConfig ? (
                <div className="space-y-2">
                  {activePlatformFields.map(field => (
                    <div key={field.key} className="flex items-center gap-3 rounded-lg bg-gray-50 px-3 py-2">
                      <span className="w-28 shrink-0 text-xs text-muted-foreground">{field.label}</span>
                      <span className="text-sm font-mono text-gray-700">
                        {field.secret ? '••••••••' : (platformConfig?.configValues?.[field.key] || '••••••••')}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      <Check className="size-3" />
                      凭证已配置
                    </span>
                  </div>
                </div>
              ) : (
                /* 编辑/填写态 */
                <div className="space-y-3">
                  {activePlatformFields.map(field => (
                    <div key={field.key}>
                      <label className="mb-1.5 block text-sm font-medium text-gray-700">{field.label}</label>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        value={configForm[field.key] ?? ''}
                        onChange={e => setConfigForm(f => ({ ...f, [field.key]: e.target.value }))}
                        placeholder={isEditingConfig && field.secret ? '留空不修改' : field.label}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveConfig}
                      disabled={isSavingConfig}
                      className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                    >
                      {isSavingConfig ? '保存中...' : '保存凭证'}
                    </button>
                    {isEditingConfig && (
                      <button
                        onClick={() => { setIsEditingConfig(false); setConfigForm({}) }}
                        className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 配置指南（playbook） */}
            {playbook && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <button
                  onClick={() => setPlaybookOpen(o => !o)}
                  className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span>📖</span>
                    配置指南 — {playbook.consoleName}
                  </span>
                  {playbookOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                </button>
                {playbookOpen && (
                  <div className="border-t border-border px-5 py-4 space-y-4 text-sm">
                    {/* 前置条件 */}
                    {playbook.prerequisites.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">前置条件</p>
                        <ul className="space-y-1">
                          {playbook.prerequisites.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                              <span className="mt-0.5 text-blue-400 shrink-0">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 控制台步骤 */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        第一步：在 {playbook.consoleName} 完成配置
                      </p>
                      <ol className="space-y-2">
                        {playbook.consoleSteps.map((step, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-600">
                              {i + 1}
                            </span>
                            <PlaybookStepText text={step} />
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* 绑定步骤 */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        第二步：绑定到 TeamAgentX
                      </p>
                      <ol className="space-y-2">
                        {playbook.bindSteps.map((step, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-[11px] font-bold text-green-600">
                              {i + 1}
                            </span>
                            <PlaybookStepText text={step} />
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* 注意事项 */}
                    {playbook.notes.length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3">
                        <p className="text-xs font-semibold text-amber-700 mb-1.5">注意事项</p>
                        <ul className="space-y-1">
                          {playbook.notes.map((note, i) => (
                            <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                              <span className="shrink-0 mt-0.5">⚠️</span>
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 已连接群组 */}
            <div>
              <h2 className="mb-3 text-sm font-medium text-gray-700">
                已连接的群组
                <span className="ml-1.5 text-muted-foreground">({channels.length})</span>
              </h2>

              {channels.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-card py-12 text-center">
                  <div className="mb-3 text-4xl">{platformInfo?.emoji}</div>
                  <p className="mb-1 font-medium text-gray-700">尚未连接任何 {platformInfo?.label} 群组</p>
                  <p className="text-sm text-muted-foreground">
                    先配置平台凭证，再到房间设置里生成绑定码，在外部群发送 /bind CODE 完成绑定
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {channels.map(ch => (
                    <ChannelCard
                      key={ch.id}
                      channel={ch}
                      platformColor={platformInfo?.color ?? '#2563eb'}
                      onDelete={() => handleDelete(ch.id)}
                      onToggle={() => handleToggleEnabled(ch)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 最近事件 */}
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
                          <th scope="col" className="px-3 py-2 font-medium">时间</th>
                          <th scope="col" className="px-3 py-2 font-medium">方向</th>
                          <th scope="col" className="px-3 py-2 font-medium">状态</th>
                          <th scope="col" className="px-3 py-2 font-medium">来源群组</th>
                          <th scope="col" className="px-3 py-2 font-medium">助手</th>
                          <th scope="col" className="px-3 py-2 font-medium">错误</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map(ev => (
                          <tr key={ev.id} className="border-b border-border last:border-0 hover:bg-gray-50">
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {new Date(ev.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                                ev.direction === 'inbound'
                                  ? 'bg-blue-100 text-blue-700'
                                  : 'bg-purple-100 text-purple-700'
                              )}>
                                {ev.direction === 'inbound' ? '↓ 入站' : '↑ 出站'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                                ev.status === 'success'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                              )}>
                                {ev.status === 'success' ? '✓ 成功' : '✗ 失败'}
                              </span>
                            </td>
                            <td className="max-w-[120px] truncate px-3 py-2 text-muted-foreground font-mono" title={ev.externalId}>
                              {ev.externalId}
                            </td>
                            <td className="px-3 py-2">
                              {ev.agentName ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                  <Bot className="size-2.5" />
                                  {ev.agentName}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
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

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader className="text-left">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
                <AlertTriangle className="size-5 text-red-500" />
              </div>
              <div className="space-y-1">
                <AlertDialogTitle className="text-base">
                  清空 {platformInfo?.label ?? '当前平台'} 接入配置
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm leading-6">
                  这会删除当前平台的凭证，并移除所有已绑定的群聊映射。清空后，这些群聊需要重新绑定才能继续使用。
                </AlertDialogDescription>
              </div>
            </div>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {channels.length > 0
                ? `即将删除 ${channels.length} 个已绑定群聊：`
                : '当前没有已绑定群聊，会只清空平台凭证。'}
            </div>

            {channels.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50">
                <div className="divide-y divide-gray-200">
                  {channels.map(channel => (
                    <div key={channel.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800">{channel.chatRoom.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{channel.externalId}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-gray-500">
                        已绑定
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSavingConfig}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void handleClearConfig()
              }}
              className="bg-red-500 text-white hover:bg-red-600"
              disabled={isSavingConfig}
            >
              {isSavingConfig && <Loader2 className="mr-2 size-4 animate-spin" />}
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 步骤文本：将 `code` 包裹内容渲染为代码样式，支持 **bold** */
function PlaybookStepText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <span className="text-sm text-gray-700 leading-relaxed">{children}</span>,
        code: ({ children }) => (
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800">{children}</code>
        ),
        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-700">{children}</a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

function ChannelCard({
  channel,
  platformColor,
  onDelete,
  onToggle,
}: {
  channel: ExternalChannel
  platformColor: string
  onDelete: () => void
  onToggle: () => void
}) {
  return (
    <div className={cn(
      'relative flex flex-col rounded-xl border border-border bg-card overflow-hidden transition-opacity',
      !channel.enabled && 'opacity-60'
    )}>
      {/* 平台色左边条 */}
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ backgroundColor: platformColor }} />

      <div className="pl-4 pr-4 pt-4 pb-3 flex flex-col gap-2.5">
        {/* 群组名（房间） */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate leading-tight" title={channel.chatRoom.name}>
              {channel.chatRoom.name}
            </p>
            <p className="mt-0.5 text-[11px] font-mono text-muted-foreground truncate" title={channel.externalId}>
              {channel.externalId}
            </p>
          </div>
          <button
            onClick={onDelete}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-500 transition-colors"
            title="删除"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>

      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between border-t border-border px-4 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-xs font-medium transition-colors"
        >
          <span className={cn(
            'inline-block h-2 w-2 rounded-full transition-colors',
            channel.enabled ? 'bg-green-500' : 'bg-gray-300'
          )} />
          <span className={channel.enabled ? 'text-green-600' : 'text-gray-400'}>
            {channel.enabled ? '已启用' : '已停用'}
          </span>
        </button>
        <span className="text-[10px] text-muted-foreground">
          {new Date(channel.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
        </span>
      </div>
    </div>
  )
}
