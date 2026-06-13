import { Button } from '@/components/ui/button'
import { agentApi, type LocalClaudeSession } from '@/lib/agent-api'
import { cn } from '@/lib/utils'
import { CheckCircle2, Clock, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

type LocalSessionTool = 'claude' | 'codex'

interface ClaudeLocalSessionsPanelProps {
  chatRoomId: string
  tool?: LocalSessionTool
  onSwitched?: () => void
}

const TOOL_LABELS: Record<LocalSessionTool, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8)
}

export function ClaudeLocalSessionsPanel({
  chatRoomId,
  tool = 'claude',
  onSwitched,
}: ClaudeLocalSessionsPanelProps) {
  const toolLabel = TOOL_LABELS[tool]
  const [workDir, setWorkDir] = useState('')
  const [sessions, setSessions] = useState<LocalClaudeSession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  )

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = tool === 'codex'
        ? await agentApi.listLocalCodexSessions(chatRoomId)
        : await agentApi.listLocalClaudeSessions(chatRoomId)
      if (!response.success || !response.data) {
        throw new Error(response.error || `扫描 ${toolLabel} 本地会话失败`)
      }
      setWorkDir(response.data.workDir)
      setCurrentSessionId(response.data.currentSessionId)
      setSessions(response.data.sessions)
      setSelectedSessionId(response.data.currentSessionId || response.data.sessions[0]?.sessionId || null)
    } catch (err) {
      const message = err instanceof Error ? err.message : `扫描 ${toolLabel} 本地会话失败`
      setError(message)
      setSessions([])
      setSelectedSessionId(null)
    } finally {
      setLoading(false)
    }
  }, [chatRoomId, tool, toolLabel])

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const handleSwitch = async () => {
    if (!selectedSessionId) return
    setSwitching(true)
    try {
      const response = tool === 'codex'
        ? await agentApi.switchLocalCodexSession(chatRoomId, selectedSessionId)
        : await agentApi.switchLocalClaudeSession(chatRoomId, selectedSessionId)
      if (!response.success || !response.data) {
        throw new Error(response.error || `切换 ${toolLabel} 会话失败`)
      }
      setCurrentSessionId(response.data.claudeSession.sessionId)
      setSessions((previous) =>
        previous.map((session) => ({
          ...session,
          isCurrent: session.sessionId === response.data?.claudeSession.sessionId,
        })),
      )
      toast.success(`已切换到「${response.data.claudeSession.title}」，导入 ${response.data.importedCount} 条历史消息`)
      onSwitched?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `切换 ${toolLabel} 会话失败`)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/70 px-1 pb-3">
        <div className="line-clamp-2 break-all text-xs text-muted-foreground">
          {workDir || `扫描当前快速对话工作目录下的 ${toolLabel} CLI 历史会话`}
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border/70 px-1 py-3">
        <div className="text-sm text-muted-foreground">
          {loading ? '扫描中' : `${sessions.length} 个会话`}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => void loadSessions()}
          disabled={loading || switching}
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          刷新
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-2 py-3 pr-1">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </div>
          )}

          {!loading && !error && sessions.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              未找到该目录下的 {toolLabel} 本地会话
            </div>
          )}

          {loading && sessions.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在扫描本地会话
            </div>
          )}

          {sessions.map((session) => {
            const selected = session.sessionId === selectedSessionId
            const current = session.sessionId === currentSessionId || session.isCurrent

            return (
              <button
                key={session.sessionId}
                type="button"
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                  selected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-border bg-background hover:border-blue-200 hover:bg-muted/50',
                )}
                onClick={() => setSelectedSessionId(session.sessionId)}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {session.title || '未命名会话'}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {formatSessionTime(session.lastModified)}
                      </span>
                      <span>{shortSessionId(session.sessionId)}</span>
                      {session.gitBranch && <span>{session.gitBranch}</span>}
                    </div>
                  </div>
                  {current && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                      <CheckCircle2 className="size-3" />
                      当前
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-border/70 px-1 pt-3">
        <Button
          type="button"
          className="w-full bg-blue-500 hover:bg-blue-600"
          onClick={() => void handleSwitch()}
          disabled={!selectedSession || switching}
        >
          {switching && <Loader2 className="mr-2 size-4 animate-spin" />}
          设为当前会话
        </Button>
      </div>
    </div>
  )
}
