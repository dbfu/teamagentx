import { agentApi } from '@/lib/agent-api'
import { Button } from '@/components/ui/button'
import { Loader2, Save, RotateCcw, Brain, MapPin } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface MemoryEditorProps {
  label: string
  description: string
  icon: React.ReactNode
  content: string
  filePath: string
  loading: boolean
  saving: boolean
  onChange: (value: string) => void
  onSave: () => void
  onReset: () => void
}

function MemoryEditor({
  label,
  description,
  icon,
  content,
  filePath,
  loading,
  saving,
  onChange,
  onSave,
  onReset,
}: MemoryEditorProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
          <div>
            <div className="font-medium text-sm text-foreground">{label}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={loading || saving}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="size-3" />
            重置
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={loading || saving}
            className="gap-1.5 text-xs bg-blue-500 hover:bg-blue-600"
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
            保存
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder="暂无记忆内容，助手会在对话中自动积累..."
          className="w-full min-h-[200px] resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none bg-muted/30 placeholder:text-muted-foreground/50"
        />
      )}

      {filePath && (
        <div className="text-xs text-muted-foreground truncate" title={filePath}>
          文件：{filePath}
        </div>
      )}
    </div>
  )
}

interface AssistantMemoryTabProps {
  agentId: string
  chatRoomId?: string
  chatRoomName?: string
}

export function AssistantMemoryTab({ agentId, chatRoomId, chatRoomName }: AssistantMemoryTabProps) {
  const [globalContent, setGlobalContent] = useState('')
  const [globalFilePath, setGlobalFilePath] = useState('')
  const [globalOriginal, setGlobalOriginal] = useState('')
  const [globalLoading, setGlobalLoading] = useState(true)
  const [globalSaving, setGlobalSaving] = useState(false)

  const [roomContent, setRoomContent] = useState('')
  const [roomFilePath, setRoomFilePath] = useState('')
  const [roomOriginal, setRoomOriginal] = useState('')
  const [roomLoading, setRoomLoading] = useState(false)
  const [roomSaving, setRoomSaving] = useState(false)

  const loadGlobalMemory = useCallback(async () => {
    setGlobalLoading(true)
    try {
      const res = await agentApi.getMemory(agentId)
      if (res.success && res.data) {
        setGlobalContent(res.data.content)
        setGlobalOriginal(res.data.content)
        setGlobalFilePath(res.data.filePath)
      }
    } catch {
      toast.error('加载全局记忆失败')
    } finally {
      setGlobalLoading(false)
    }
  }, [agentId])

  const loadRoomMemory = useCallback(async () => {
    if (!chatRoomId) return
    setRoomLoading(true)
    try {
      const res = await agentApi.getRoomMemory(agentId, chatRoomId)
      if (res.success && res.data) {
        setRoomContent(res.data.content)
        setRoomOriginal(res.data.content)
        setRoomFilePath(res.data.filePath)
      }
    } catch {
      toast.error('加载房间记忆失败')
    } finally {
      setRoomLoading(false)
    }
  }, [agentId, chatRoomId])

  useEffect(() => {
    loadGlobalMemory()
  }, [loadGlobalMemory])

  useEffect(() => {
    loadRoomMemory()
  }, [loadRoomMemory])

  const saveGlobalMemory = async () => {
    setGlobalSaving(true)
    try {
      const res = await agentApi.updateMemory(agentId, globalContent)
      if (res.success) {
        setGlobalOriginal(globalContent)
        toast.success('全局记忆已保存')
      } else {
        toast.error(res.error || '保存失败')
      }
    } finally {
      setGlobalSaving(false)
    }
  }

  const saveRoomMemory = async () => {
    if (!chatRoomId) return
    setRoomSaving(true)
    try {
      const res = await agentApi.updateRoomMemory(agentId, chatRoomId, roomContent)
      if (res.success) {
        setRoomOriginal(roomContent)
        toast.success('房间记忆已保存')
      } else {
        toast.error(res.error || '保存失败')
      }
    } finally {
      setRoomSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="text-sm text-muted-foreground">
        助手的长期记忆存储在本地文件中，在对话中可通过指令让助手主动写入。全局记忆跨所有群生效，房间记忆仅在当前群生效。
      </div>

      <MemoryEditor
        label="全局记忆"
        description="跨所有群聊生效"
        icon={<Brain className="size-4" />}
        content={globalContent}
        filePath={globalFilePath}
        loading={globalLoading}
        saving={globalSaving}
        onChange={setGlobalContent}
        onSave={saveGlobalMemory}
        onReset={() => setGlobalContent(globalOriginal)}
      />

      {chatRoomId && (
        <MemoryEditor
          label={`房间记忆${chatRoomName ? `（${chatRoomName}）` : ''}`}
          description="仅在当前群聊生效"
          icon={<MapPin className="size-4" />}
          content={roomContent}
          filePath={roomFilePath}
          loading={roomLoading}
          saving={roomSaving}
          onChange={setRoomContent}
          onSave={saveRoomMemory}
          onReset={() => setRoomContent(roomOriginal)}
        />
      )}
    </div>
  )
}
