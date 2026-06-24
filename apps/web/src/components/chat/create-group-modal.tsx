import { Agent, agentApi, chatRoomApi } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { getRandomGroupAvatarIndex, GroupAvatarImage, groupAvatarOptions } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { FolderOpen, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { AvatarSelector } from './avatar-selector'
import { AddAgentDialog } from './dialogs/add-agent-dialog'

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (chatRoomId: string) => void
  ownerId?: string
}

export function CreateGroupModal({ isOpen, onClose, onSuccess, ownerId }: CreateGroupModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [workDir, setWorkDir] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState(() => String(getRandomGroupAvatarIndex()))
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set())
  const [showAgentDialog, setShowAgentDialog] = useState(false)
  const [loading, setLoading] = useState(false)

  // 已选助手（按加载到的助手列表过滤）
  const selectedAgents = useMemo(
    () => agents.filter((agent) => selectedAgentIds.has(agent.id)),
    [agents, selectedAgentIds]
  )

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
        avatar: selectedAvatar,
        description: description.trim() || undefined,
        workDir: workDir.trim() || null,
        ownerId,
        // 默认使用智能协作模式
        agentTriggerMode: 'coordinator',
        // 未选择业务助手时，由群助手发送与首次引导一致的介绍消息。
        introduceGroupAssistant: selectedAgentIds.size === 0,
      })

      if (!createResponse.success || !createResponse.data) {
        toast.error(t('chat.createGroupFailed'))
        return
      }

      const chatRoomId = createResponse.data.id

      // 添加选中的助手
      const agentIds = Array.from(selectedAgentIds)
      if (agentIds.length > 0) {
        await chatRoomApi.addAgents(chatRoomId, {
          agentIds,
          role: 'MEMBER',
        })
      }

      // 自由协作模式下：只选了一个助手时，将其设为默认接收助手；
      // 选了多个助手时不设置默认接收助手。
      if (agentIds.length === 1) {
        await chatRoomApi.update(chatRoomId, { defaultAgentId: agentIds[0] })
      }

      // 重置表单
      setName('')
      setDescription('')
      setWorkDir('')
      setSelectedAvatar(String(getRandomGroupAvatarIndex()))
      setSelectedAgentIds(new Set())
      onSuccess?.(chatRoomId)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-[36rem] shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <GroupAvatarImage avatar={selectedAvatar} className="size-9 rounded-full" />
            <h2 className="text-lg font-semibold text-foreground">{t('chat.createGroupTitle')}</h2>
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
                {t('chat.groupName')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('chat.groupNamePlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* Avatar selection */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('assistant.avatar')}</label>
              <AvatarSelector
                value={selectedAvatar}
                onChange={setSelectedAvatar}
                options={groupAvatarOptions}
                optionAriaLabel={(index) => t('assistant.selectAvatar') + ' ' + (index + 1)}
                renderAvatar={(avatar, className) => (
                  <GroupAvatarImage avatar={avatar} className={cn('rounded-full', className)} />
                )}
              />
            </div>

            {/* Description */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('chat.groupDescription')}</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('chat.groupDescriptionPlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* Work directory */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('chat.workDirectory')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workDir}
                  onChange={(e) => setWorkDir(e.target.value)}
                  placeholder={t('chat.workDirectoryPlaceholder')}
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                {window.electronAPI?.isElectron && (
                  <button
                    type="button"
                    onClick={handleSelectFolder}
                    className="flex items-center justify-center rounded-lg border border-input px-3 py-2 text-muted-foreground hover:bg-accent"
                    title={t('chat.selectDirectory')}
                  >
                    <FolderOpen className="size-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('chat.workDirectoryHint')}
              </p>
            </div>

            {/* Agents selection */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('chat.selectAssistants')}</label>
              {selectedAgents.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center gap-2 rounded-lg border border-input bg-background py-1.5 pl-2 pr-1"
                    >
                      <AgentAvatarImage avatar={agent.avatar} className="size-6" />
                      <span className="text-sm text-foreground">{agent.name}</span>
                      <button
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowAgentDialog(true)}
                    className="flex items-center gap-1 rounded-lg border border-dashed border-input bg-background px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    <Plus className="size-4" />
                    {t('chat.selectAssistants')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAgentDialog(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input bg-background px-3 py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary"
                >
                  <Plus className="size-4" />
                  {t('chat.selectAssistants')}
                </button>
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
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('common.creating') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>

    {/* 选择助手弹框 */}
    <AddAgentDialog
      open={showAgentDialog}
      onClose={() => setShowAgentDialog(false)}
      availableAgents={agents}
      addingAgentIds={new Set()}
      initialSelectedIds={selectedAgentIds}
      confirmLabel={t('common.confirm')}
      onAddAgents={async (ids) => {
        setSelectedAgentIds(new Set(ids))
        setShowAgentDialog(false)
      }}
    />
    </>
  )
}
