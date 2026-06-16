import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Server, X } from 'lucide-react'
import { connectorApi } from '@/lib/connector-api'

interface ConnectorConfigModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  mode?: 'merge' | 'replace'
}

const EMPTY_CONFIG = `{
  "mcpServers": {}
}`

const PLACEHOLDER = `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "xxxx" }
    },
    "example-http": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer xxxx" }
    }
  }
}`

export function ConnectorConfigModal({ isOpen, onClose, onSuccess, mode = 'replace' }: ConnectorConfigModalProps) {
  const [text, setText] = useState(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const isMergeMode = mode === 'merge'

  useEffect(() => {
    if (!isOpen) return
    if (isMergeMode) {
      setText(EMPTY_CONFIG)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    connectorApi
      .getConfig()
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setText(JSON.stringify(res.data, null, 2))
        } else {
          setText(EMPTY_CONFIG)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, isMergeMode])

  if (!isOpen) return null

  const handleSave = async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      toast.error('JSON 格式错误，请检查')
      return
    }
    const mcpServers = (parsed as { mcpServers?: unknown })?.mcpServers
    if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
      toast.error('缺少 mcpServers 对象')
      return
    }
    setSaving(true)
    try {
      const res = isMergeMode
        ? await connectorApi.mergeConfig(mcpServers as Record<string, unknown>)
        : await connectorApi.saveConfig(mcpServers as Record<string, unknown>)
      if (res.success) {
        toast.success(isMergeMode ? '已添加' : '已保存')
        onSuccess()
      } else {
        toast.error(res.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <Server className="size-5 text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {isMergeMode ? '新建连接器' : '配置 MCP'}
              </h2>
              <p className="text-xs text-gray-500">
                {isMergeMode
                  ? '粘贴包含 mcpServers 的 JSON，保存后只追加其中的新连接器'
                  : '编辑完整 ~/.teamagentx/mcp.json，保存后覆盖同步为连接器'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-5 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {isMergeMode ? '添加' : '保存'}
            </button>
            <button onClick={onClose} className="ml-1 text-gray-400 hover:text-gray-600">
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* 编辑区 */}
        <div className="flex min-h-0 flex-1 flex-col p-4">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              加载中…
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className="flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed text-gray-800 focus:border-blue-500 focus:outline-none"
            />
          )}
          <p className="mt-3 text-xs text-gray-400">
            {isMergeMode
              ? '只会追加本次 JSON 里的新 mcpServers 条目；同名连接器会被拒绝。'
              : '这里是完整配置；删除条目会移除对应连接器。'}
          </p>
        </div>
      </div>
    </div>
  )
}
