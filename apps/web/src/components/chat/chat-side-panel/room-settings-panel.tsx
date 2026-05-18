import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChatRoom, chatRoomApi } from '@/lib/agent-api'
import { bridgeApi, BridgeBot } from '@/lib/bridge-api'
import { groupAvatarOptions, GroupAvatarImage, normalizeGroupAvatarIndex } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { Bot, Eraser, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WorkDirCard, type FolderOpenTarget } from './work-dir-card'

interface RoomSettingsPanelProps {
  chatRoom: ChatRoom
  onChatRoomChange: () => void
  onDeleteChatRoom: () => void
  onClearMessages: () => void
}

export function RoomSettingsPanel({
  chatRoom,
  onChatRoomChange,
  onDeleteChatRoom,
  onClearMessages,
}: RoomSettingsPanelProps) {
  // 解析当前头像索引
  const currentIconIndex = normalizeGroupAvatarIndex(chatRoom.avatar)

  const [name, setName] = useState(chatRoom.name)
  const [description, setDescription] = useState(chatRoom.description || '')
  const [rules, setRules] = useState(chatRoom.rules || '')
  const [workDir, setWorkDir] = useState(chatRoom.workDir || '')
  const [defaultAgentId, setDefaultAgentId] = useState(chatRoom.defaultAgentId || '')
  const [agentTriggerMode, setAgentTriggerMode] = useState(chatRoom.agentTriggerMode || 'auto')
  const [selectedIconIndex, setSelectedIconIndex] = useState(currentIconIndex)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // 外部平台机器人绑定
  const [roomBots, setRoomBots] = useState<BridgeBot[]>([])

  // 编辑状态
  const [editingName, setEditingName] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [editingRules, setEditingRules] = useState(false)
  const [editingWorkDir, setEditingWorkDir] = useState(false)
  const [workDirDraft, setWorkDirDraft] = useState(chatRoom.workDir || '')
  const [openingFolder, setOpeningFolder] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const descInputRef = useRef<HTMLInputElement>(null)
  const rulesInputRef = useRef<HTMLTextAreaElement>(null)
  const selectableAgents = (chatRoom.chatRoomAgents || []).filter((roomAgent) => roomAgent.agent)
  const hasSelectedDefaultAgent = selectableAgents.some((roomAgent) => roomAgent.agent?.id === defaultAgentId)

  useEffect(() => {
    setName(chatRoom.name)
    setDescription(chatRoom.description || '')
    setRules(chatRoom.rules || '')
    setWorkDir(chatRoom.workDir || '')
    setWorkDirDraft(chatRoom.workDir || '')
    setDefaultAgentId(chatRoom.defaultAgentId || '')
    setAgentTriggerMode(chatRoom.agentTriggerMode || 'auto')
    setSelectedIconIndex(normalizeGroupAvatarIndex(chatRoom.avatar))
  }, [chatRoom.id, chatRoom.name, chatRoom.description, chatRoom.rules, chatRoom.workDir, chatRoom.defaultAgentId, chatRoom.agentTriggerMode, chatRoom.avatar])

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [editingName])

  useEffect(() => {
    if (editingDescription && descInputRef.current) {
      descInputRef.current.focus()
    }
  }, [editingDescription])

  useEffect(() => {
    if (editingRules && rulesInputRef.current) {
      rulesInputRef.current.focus()
    }
  }, [editingRules])

  useEffect(() => {
    bridgeApi.listBots().then((allBots) => {
      setRoomBots(allBots.filter((bot) => bot.chatRoomId === chatRoom.id))
    }).catch(() => {})
  }, [chatRoom.id])

  const handleSave = async (updates: { name?: string; avatar?: string; description?: string; rules?: string; workDir?: string | null; defaultAgentId?: string | null; agentTriggerMode?: 'auto' | 'manual' }) => {
    setSaving(true)
    try {
      const response = await chatRoomApi.update(chatRoom.id, updates)
      if (response.success) {
        onChatRoomChange()
        return true
      } else {
        toast.error(response.error || '保存失败')
        return false
      }
    } finally {
      setSaving(false)
    }
  }

  const handleNameBlur = () => {
    setEditingName(false)
    if (name.trim() && name !== chatRoom.name) {
      handleSave({ name: name.trim() })
    } else {
      setName(chatRoom.name) // 恢复原值
    }
  }

  const handleDescriptionBlur = () => {
    setEditingDescription(false)
    if (description !== (chatRoom.description || '')) {
      handleSave({ description: description.trim() || undefined })
    } else {
      setDescription(chatRoom.description || '') // 恢复原值
    }
  }

  const handleSelectIcon = (index: number) => {
    setSelectedIconIndex(index)
    handleSave({ avatar: String(index) })
  }

  const handleDefaultAgentChange = (value: string) => {
    const nextAgentId = value === '__none__' ? '' : value
    setDefaultAgentId(nextAgentId)
    handleSave({ defaultAgentId: nextAgentId || null })
  }

  const handleTriggerModeChange = (value: 'auto' | 'manual') => {
    setAgentTriggerMode(value)
    handleSave({ agentTriggerMode: value })
  }

  const handleDeleteChannel = async (channel: BridgeBot) => {
    if (!window.confirm(`确定要解绑机器人「${channel.name}」吗？`)) return
    try {
      await bridgeApi.unbindBot(channel.id)
      setRoomBots((prev) => prev.filter((ch) => ch.id !== channel.id))
      toast.success(`已解绑 ${channel.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const defaultWorkDir = `~/.teamagentx/workspace/${chatRoom.id}`
  const displayWorkDir = workDir || defaultWorkDir

  const handleStartEditWorkDir = () => {
    setWorkDirDraft(workDir)
    setEditingWorkDir(true)
  }

  const handleSelectWorkDir = async () => {
    if (!window.electronAPI?.isElectron) return
    const result = await window.electronAPI.selectFolder()
    if (result.success && result.path) {
      setWorkDirDraft(result.path)
    }
  }

  const handleOpenWorkDir = async (target: FolderOpenTarget = 'system') => {
    if (!window.electronAPI?.isElectron || !displayWorkDir) return
    setOpeningFolder(true)
    try {
      const result = await window.electronAPI.openFolder(displayWorkDir, target)
      if (!result?.success) {
        toast.error(result?.error || '打开目录失败')
      }
    } catch {
      toast.error('打开目录失败')
    } finally {
      setOpeningFolder(false)
    }
  }

  const handleSaveWorkDir = async () => {
    const nextWorkDir = workDirDraft.trim()
    const saved = await handleSave({ workDir: nextWorkDir || null })
    if (saved) {
      setWorkDir(nextWorkDir)
      setEditingWorkDir(false)
    }
  }

  const handleDelete = async () => {
    setSaving(true)
    try {
      const response = await chatRoomApi.delete(chatRoom.id)
      if (response.success) {
        onDeleteChatRoom()
      } else {
        toast.error(response.error || '删除失败')
      }
    } finally {
      setSaving(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <div className="flex h-full flex-col -mx-3 -my-3">
      {/* 可滚动内容区域 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-4">
        {/* 头像预览 */}
        <div className="flex flex-col items-center py-4">
          <GroupAvatarImage avatar={selectedIconIndex} className="size-16 rounded-full" />
        </div>

        {/* 群名称 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">群组名称</label>
          {editingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  setName(chatRoom.name)
                  setEditingName(false)
                }
              }}
              placeholder="请输入群组名称"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              disabled={saving}
            />
          ) : (
            <div
              className="flex cursor-pointer items-center justify-between rounded-lg border border-input px-3 py-2 hover:bg-accent"
              onClick={() => setEditingName(true)}
            >
              <span className="text-sm text-foreground">{chatRoom.name || '未命名'}</span>
              <Pencil className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* 头像选择 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">头像</label>
          <div className="grid max-h-40 grid-cols-6 gap-1 overflow-y-auto rounded-lg border border-input bg-background p-2">
            {groupAvatarOptions.map((index) => (
              <button
                key={index}
                type="button"
                onClick={() => handleSelectIcon(index)}
                disabled={saving}
                className={cn(
                  'flex size-10 items-center justify-center rounded-lg transition-colors',
                  selectedIconIndex === index
                    ? 'bg-primary/10 ring-2 ring-primary'
                    : 'hover:bg-accent'
                )}
              >
                <GroupAvatarImage avatar={index} className="size-8 rounded-full" />
              </button>
            ))}
          </div>
        </div>

        {/* 群描述 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">群组描述</label>
          {editingDescription ? (
            <input
              ref={descInputRef}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  setDescription(chatRoom.description || '')
                  setEditingDescription(false)
                }
              }}
              placeholder="请输入群组描述"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              disabled={saving}
            />
          ) : (
            <div
              className="flex cursor-pointer items-center justify-between rounded-lg border border-input px-3 py-2 hover:bg-accent"
              onClick={() => setEditingDescription(true)}
            >
              <span className="text-sm text-foreground">{chatRoom.description || '暂无描述'}</span>
              <Pencil className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* 工作目录 */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-muted-foreground">工作目录</label>
            {workDir && <span className="text-xs font-medium text-blue-600">自定义</span>}
          </div>
          <WorkDirCard
            displayWorkDir={displayWorkDir}
            defaultWorkDir={defaultWorkDir}
            isEditing={editingWorkDir}
            editingWorkDir={workDirDraft}
            isElectron={window.electronAPI?.isElectron ?? false}
            openingFolder={openingFolder}
            savingSettings={saving}
            onEditingWorkDirChange={setWorkDirDraft}
            onStartEdit={handleStartEditWorkDir}
            onCancelEdit={() => setEditingWorkDir(false)}
            onSave={handleSaveWorkDir}
            onSelectFolder={handleSelectWorkDir}
            onOpenFolder={handleOpenWorkDir}
            onCopy={() => {
              navigator.clipboard.writeText(displayWorkDir)
              toast.success('工作目录路径已复制')
            }}
          />
        </div>

        {/* 默认接收助手 */}
        {!chatRoom.isQuickChatRoom && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">默认接收助手</label>
            <div className="text-xs text-muted-foreground mb-2">
              成员发送未 @ 助手的消息时，会自动触发该助手。
            </div>
            <Select
              value={defaultAgentId || '__none__'}
              onValueChange={handleDefaultAgentChange}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="不设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">不设置</SelectItem>
                {defaultAgentId && !hasSelectedDefaultAgent && (
                  <SelectItem value={defaultAgentId}>已失效的默认助手</SelectItem>
                )}
                {selectableAgents.map((roomAgent) => (
                  <SelectItem key={roomAgent.agent!.id} value={roomAgent.agent!.id}>
                    {roomAgent.agent!.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 助手触发模式 */}
        {!chatRoom.isQuickChatRoom && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">助手触发模式</label>
            <div className="text-xs text-muted-foreground mb-2">
              自动模式：助手消息中的 @ 会触发其他助手执行任务。<br />
              手动模式：助手消息中的 @ 不会触发其他助手，仅作提及。
            </div>
            <Select
              value={agentTriggerMode}
              onValueChange={(v) => handleTriggerModeChange(v as 'auto' | 'manual')}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">自动模式（推荐）</SelectItem>
                <SelectItem value="manual">手动模式</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 群规则 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">群规则</label>
          <div className="text-xs text-muted-foreground mb-2">
            群规则会注入到群内所有助手的上下文中，指导助手的行为。
          </div>
          {editingRules ? (
            <textarea
              ref={rulesInputRef}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              onBlur={() => {
                setEditingRules(false)
                if (rules !== (chatRoom.rules || '')) {
                  handleSave({ rules: rules.trim() || undefined })
                }
              }}
              placeholder="输入群规则，例如：&#10;- 所有回复使用中文&#10;- 代码需要添加注释&#10;- 重要决策需要说明理由"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50 min-h-[100px] resize-y"
              disabled={saving}
            />
          ) : (
            <div
              className="flex cursor-pointer items-start justify-between rounded-lg border border-input px-3 py-2 hover:bg-accent min-h-[60px]"
              onClick={() => setEditingRules(true)}
            >
              <span className="text-sm text-foreground whitespace-pre-wrap flex-1">
                {chatRoom.rules || '暂无规则，点击添加'}
              </span>
              <Pencil className="size-4 text-muted-foreground shrink-0 ml-2 mt-0.5" />
            </div>
          )}
        </div>

        {/* 快速对话提示 */}
        {chatRoom.isQuickChatRoom && (
          <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            这是一个快速对话群聊，消息会直接发送给助手，无需 @ 提及。
          </div>
        )}

        {/* 外部平台接入 */}
        {!chatRoom.isQuickChatRoom && (
          <div className="border-t border-border pt-4 mt-4">
            <label className="mb-2 block text-sm font-medium text-muted-foreground">外部平台机器人绑定</label>
            <p className="mb-3 text-xs text-muted-foreground">机器人只负责外部平台通信。当前群聊可以同时连接多个平台机器人，消息会同步到这些已连接机器人。</p>
            {roomBots.length > 0 ? (
              <div className="space-y-2">
                {roomBots.map((bot) => (
                  <div key={bot.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        bot.enabled ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500',
                      )}>
                        <Bot className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{bot.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700">{bot.platform}</span>
                          <span className="text-gray-300">•</span>
                          <span className={cn('inline-flex items-center gap-1', bot.enabled ? 'text-green-600' : 'text-gray-500')}>
                            <span className={cn('size-1.5 rounded-full', bot.enabled ? 'bg-green-500' : 'bg-gray-400')} />
                            {bot.enabled ? '启用中' : '已停用'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteChannel(bot)}
                      className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                    >
                      解绑
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                当前群聊还没有绑定机器人。你可以在频道页创建机器人实例后直接绑定到这里，或者在群里让“外部平台接入助手”拿到凭证后自动绑定当前群聊。
              </div>
            )}
          </div>
        )}
      </div>

      {/* 固定在底部的按钮 */}
      <div className="shrink-0 border-t border-border px-4 -mb-6 py-4">
        <div className="flex gap-3">
          <button
            onClick={onClearMessages}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            <Eraser className="size-4" />
            清空消息
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            删除对话
          </button>
        </div>
      </div>

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="删除对话"
        description={`确定要删除「${chatRoom.name}」吗？此操作无法撤销。`}
        confirmText="删除"
        onConfirm={handleDelete}
        icon={Trash2}
      />
    </div>
  )
}
