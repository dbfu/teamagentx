import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Globe, Plug, Terminal } from 'lucide-react'
import { connectorApi, type Connector } from '@/lib/connector-api'

interface AssistantConnectorsTabProps {
  agentId: string
}

export function AssistantConnectorsTab({ agentId }: AssistantConnectorsTabProps) {
  const navigate = useNavigate()
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const [allRes, bindingRes] = await Promise.all([
          connectorApi.getAll(),
          connectorApi.getAgentConnectors(agentId),
        ])
        if (cancelled) return
        if (allRes.success && allRes.data) setConnectors(allRes.data)
        if (bindingRes.success && bindingRes.data) {
          setEnabledIds(
            new Set(bindingRes.data.filter((b) => b.enabled).map((b) => b.connectorId)),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [agentId])

  const toggle = async (connectorId: string) => {
    const next = new Set(enabledIds)
    if (next.has(connectorId)) next.delete(connectorId)
    else next.add(connectorId)
    setEnabledIds(next)
    setSaving(true)
    try {
      const res = await connectorApi.setAgentConnectors(agentId, Array.from(next))
      if (!res.success) {
        toast.error(res.error || '保存失败')
        // 回滚
        setEnabledIds(enabledIds)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">连接器</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            选择该助手启用的 MCP 连接器，仅显示全局已启用的连接器。
          </p>
        </div>
        <button
          onClick={() => navigate('/connectors')}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          管理连接器
        </button>
      </div>

      {connectors.filter((c) => c.enabled).length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-muted/50 py-16">
          <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
            <Plug className="size-8 text-muted-foreground" />
          </div>
          <h3 className="mb-2 text-lg font-medium text-foreground">没有可用的连接器</h3>
          <p className="mb-6 text-sm text-muted-foreground">先在「连接器」页面创建并启用连接器。</p>
          <button
            onClick={() => navigate('/connectors')}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
          >
            前往创建
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {connectors
            .filter((c) => c.enabled)
            .map((connector) => {
              const checked = enabledIds.has(connector.id)
              return (
                <div
                  key={connector.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/5">
                      {connector.transport === 'http' ? (
                        <Globe className="size-5 text-primary" />
                      ) : (
                        <Terminal className="size-5 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="truncate font-medium text-foreground">{connector.displayName}</h4>
                      <p className="truncate text-xs text-muted-foreground">
                        {connector.description || connector.name}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => toggle(connector.id)}
                    disabled={saving}
                    className={`ml-2 h-5 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                      checked ? 'bg-blue-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`block size-4 rounded-full bg-white transition-transform ${
                        checked ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
