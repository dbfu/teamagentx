import { useEffect, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Globe, Pencil, Plug, Plus, Terminal, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { connectorApi, type Connector } from '@/lib/connector-api'
import { ConnectorConfigModal } from './connector-config-modal'

const ELECTRON_DRAG_STYLE = window.electronAPI?.isElectron
  ? { WebkitAppRegion: 'drag' as const }
  : undefined

const NO_DRAG_STYLE = window.electronAPI?.isElectron
  ? { WebkitAppRegion: 'no-drag' as const }
  : undefined

export function ConnectorPage() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [configMode, setConfigMode] = useState<'merge' | 'replace'>('merge')
  const [pendingDeleteConnector, setPendingDeleteConnector] = useState<Connector | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await connectorApi.getAll()
      if (res.success && res.data) setConnectors(res.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleToggle = async (connector: Connector) => {
    const res = await connectorApi.setStatus(connector.id, !connector.enabled)
    if (res.success) {
      setConnectors((prev) =>
        prev.map((c) => (c.id === connector.id ? { ...c, enabled: !c.enabled } : c)),
      )
    } else {
      toast.error(res.error || '操作失败')
    }
  }

  const handleDelete = async () => {
    if (!pendingDeleteConnector) return
    setDeleting(true)
    try {
      const res = await connectorApi.delete(pendingDeleteConnector.id)
      if (res.success) {
        toast.success('已删除')
        setConnectors((prev) => prev.filter((c) => c.id !== pendingDeleteConnector.id))
        setPendingDeleteConnector(null)
      } else {
        toast.error(res.error || '删除失败')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--surface)]">
      <div
        className="flex h-[52px] shrink-0 items-center border-b border-border bg-[var(--surface-raised)] px-4"
        style={ELECTRON_DRAG_STYLE as CSSProperties}
      >
        <div className="flex items-center gap-2" style={ELECTRON_DRAG_STYLE as CSSProperties}>
          <Plug className="size-4 text-primary" />
          <span className="text-base font-semibold text-foreground">MCP</span>
        </div>
        <div
          className="ml-auto flex items-center gap-1.5"
          style={NO_DRAG_STYLE as CSSProperties}
        >
          <button
            onClick={() => {
              setConfigMode('merge')
              setConfigOpen(true)
            }}
            className="ta-button-primary h-8 px-3 text-xs"
          >
            <Plus className="size-4" />
            新建 MCP
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="ta-page-section">
          <p className="text-sm text-muted-foreground">
            全局注册 MCP 服务，助手可在「MCP」标签页按需启用。
          </p>
        </div>
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
        ) : connectors.length === 0 ? (
          <div className="ta-page-section flex flex-col items-center justify-center text-muted-foreground">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
              <Plug className="size-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-foreground">还没有 MCP</h3>
            <p className="mb-6 text-sm text-muted-foreground">创建一个 MCP 服务，扩展助手的工具能力。</p>
            <button
              onClick={() => {
                setConfigMode('merge')
                setConfigOpen(true)
              }}
              className="ta-button-primary"
            >
              <Plus className="size-4" />
              新建 MCP
            </button>
          </div>
        ) : (
          <div className="ta-page-section grid grid-cols-1 gap-4 md:grid-cols-2">
            {connectors.map((connector) => (
              <div
                key={connector.id}
                className="group flex items-center justify-between rounded-xl border border-border bg-card p-5 transition-all hover:border-primary/20 hover:shadow-lg"
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
                    <div className="flex items-center gap-2">
                      <h4 className="truncate font-medium text-foreground">{connector.displayName}</h4>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {connector.name}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {connector.transport === 'http'
                        ? connector.url
                        : connector.command}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {/* 全局开关 */}
                  <button
                    onClick={() => handleToggle(connector)}
                    title={connector.enabled ? '已启用' : '已停用'}
                    className={`mr-1 h-5 w-10 rounded-full transition-colors ${
                      connector.enabled ? 'bg-blue-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`block size-4 rounded-full bg-white transition-transform ${
                        connector.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <button
                    onClick={() => {
                      setConfigMode('replace')
                      setConfigOpen(true)
                    }}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                    title="编辑完整 JSON"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => setPendingDeleteConnector(connector)}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="删除"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {configOpen && (
        <ConnectorConfigModal
          isOpen={configOpen}
          mode={configMode}
          onClose={() => setConfigOpen(false)}
          onSuccess={() => {
            setConfigOpen(false)
            load()
          }}
        />
      )}
      <ConfirmDialog
        open={!!pendingDeleteConnector}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteConnector(null)
        }}
        title="删除 MCP"
        description={`确定删除 MCP「${pendingDeleteConnector?.displayName ?? ''}」吗？已绑定该 MCP 的助手将无法继续使用它。`}
        confirmText="删除"
        onConfirm={handleDelete}
        loading={deleting}
        icon={Trash2}
      />
    </div>
  )
}
