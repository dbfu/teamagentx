import { Agent, agentApi, chatRoomApi } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { getRandomGroupAvatarIndex, GroupAvatarImage, groupAvatarOptions } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { Check, FolderOpen, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (chatRoomId: string) => void
  ownerId?: string
}

export function CreateGroupModal({ isOpen, onClose, onSuccess, ownerId }: CreateGroupModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [selectedAvatarIndex, setSelectedAvatarIndex] = useState(() => getRandomGroupAvatarIndex())
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen) {
      loadAgents()
    }
  }, [isOpen])

  const loadAgents = async () => {
    const response = await agentApi.getActive()
    if (response.success && response.data) {
      setAgents(response.data.filter((agent) => agent.agentLevel !== 'system'))
    }
  }

  if (!isOpen) return null

  const toggleAgent = (agentId: string) => {
    const newSelected = new Set(selectedAgentIds)
    if (newSelected.has(agentId)) {
      newSelected.delete(agentId)
    } else {
      newSelected.add(agentId)
    }
    setSelectedAgentIds(newSelected)
  }

  const handleSelectFolder = async () => {
    if (!window.electronAPI?.isElectron) return
    const result = await window.electronAPI.selectFolder()
    if (result.success && result.path) {
      setWorkDir(result.path)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    try {
      // 创建群组（传入 ownerId 以自动成为群主）
      const createResponse = await chatRoomApi.create({
        name: name.trim(),
        avatar: String(selectedAvatarIndex),
        description: description.trim() || undefined,
        workDir: workDir.trim() || null,
        ownerId,
        agentTriggerMode: 'coordinator',
      })

      if (!createResponse.success || !createResponse.data) {
        toast.error(createResponse.error || '创建群组失败')
        return
      }

      const chatRoomId = createResponse.data.id

      // 添加选中的助手
      for (const agentId of selectedAgentIds) {
        await chatRoomApi.addAgent(chatRoomId, {
          agentId,
          role: 'MEMBER',
        })
      }

      // 重置表单
      setName('')
      setDescription('')
      setWorkDir('')
      setSelectedAvatarIndex(getRandomGroupAvatarIndex())
      setSelectedAgentIds(new Set())
      onSuccess?.(chatRoomId)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-120 shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <GroupAvatarImage avatar={selectedAvatarIndex} className="size-9 rounded-full" />
            <h2 className="text-lg font-semibold text-foreground">创建群组</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="max-h-[50vh] overflow-y-auto p-6">
            {/* Name */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                群组名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入群组名称"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* Avatar selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">头像</label>
              <div className="grid max-h-64 grid-cols-6 gap-2 overflow-y-auto rounded-lg border border-input bg-background p-2">
                {groupAvatarOptions.map((index) => (
                  <button
                    key={index}
                    type="button"
                    aria-label={`选择头像 ${index + 1}`}
                    onClick={() => setSelectedAvatarIndex(index)}
                    className={cn(
                      'relative flex size-12 items-center justify-center rounded-full transition-all hover:ring-2 hover:ring-primary/30',
                      selectedAvatarIndex === index && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    )}
                  >
                    <GroupAvatarImage avatar={index} className="size-12 rounded-full" />
                    {selectedAvatarIndex === index && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-white shadow-sm">
                        <Check className="size-3" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">群组描述</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="请输入群组描述"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* Work directory */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">工作目录</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workDir}
                  onChange={(e) => setWorkDir(e.target.value)}
                  placeholder="留空使用默认群目录"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                {window.electronAPI?.isElectron && (
                  <button
                    type="button"
                    onClick={handleSelectFolder}
                    className="flex items-center justify-center rounded-lg border border-input px-3 py-2 text-muted-foreground hover:bg-accent"
                    title="选择目录"
                  >
                    <FolderOpen className="size-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                群内所有助手共享这个运行目录
              </p>
            </div>

            {/* Agents selection */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">选择助手</label>
              {agents.length === 0 ? (
                <div className="rounded-lg border border-input bg-background p-4 text-center text-sm text-muted-foreground">
                  暂无可用助手
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-input bg-background">
                  {agents.map((agent) => {
                    const isSelected = selectedAgentIds.has(agent.id)
                    return (
                      <div
                        key={agent.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 transition-colors',
                          isSelected ? 'bg-primary/5' : 'hover:bg-accent'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleAgent(agent.id)}
                          className="flex flex-1 items-center gap-3 text-left"
                        >
                          <AgentAvatarImage avatar={agent.avatar} className="size-6" />
                          <div className="flex-1 w-0 min-w-0">
                            <div className="text-sm font-medium text-foreground">{agent.name}</div>
                            {agent.description && (
                              <div className="truncate  text-xs text-muted-foreground">{agent.description}</div>
                            )}
                          </div>
                          <div
                            className={cn(
                              'flex size-5 items-center justify-center rounded border transition-colors',
                              isSelected
                                ? 'border-primary bg-primary text-white'
                                : 'border-border'
                            )}
                          >
                            {isSelected && <Check className="size-3" />}
                          </div>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-input bg-background px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '创建中...' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
