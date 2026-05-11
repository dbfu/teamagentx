import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChatRoom, chatRoomApi } from '@/lib/agent-api'
import { bridgeApi, ExternalChannel, Platform } from '@/lib/bridge-api'
import { groupAvatarOptions, GroupAvatarImage, normalizeGroupAvatarIndex } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { Eraser, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WorkDirCard, type FolderOpenTarget } from './work-dir-card'

const PLATFORMS: { key: Platform; label: string; emoji: string }[] = [
  { key: 'telegram', label: 'Telegram', emoji: '✈️' },
  { key: 'feishu', label: '飞书', emoji: '🪶' },
  { key: 'dingtalk', label: '钉钉', emoji: '📌' },
  { key: 'wecom', label: '企业微信', emoji: '💬' },
  { key: 'qq', label: 'QQ', emoji: '🐧' },
]


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

  // 外部平台接入
  const [channels, setChannels] = useState<ExternalChannel[]>([])
  const [activePlatform, setActivePlatform] = useState<string | null>(null)
  const [bindCode, setBindCode] = useState<{ code: string; expiresIn: number } | null>(null)
  const [isGettingCode, setIsGettingCode] = useState(false)

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
    bridgeApi.listChannels().then((all) => {
      setChannels(all.filter((ch) => ch.chatRoomId === chatRoom.id))
    }).catch(() => {})
    setActivePlatform(null)
    setBindCode(null)
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

  const handleGetBindCode = async () => {
    if (!activePlatform) return
    setIsGettingCode(true)
    try {
      const result = await bridgeApi.getBindCode(activePlatform as Platform, chatRoom.id)
      setBindCode(result)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '生成失败')
    } finally {
      setIsGettingCode(false)
    }
  }

  const handleDeleteChannel = async (channel: ExternalChannel) => {
    const label = PLATFORMS.find((p) => p.key === channel.platform)?.label ?? channel.platform
    if (!window.confirm(`确定要删除「${label}」的接入（${channel.externalId}）吗？`)) return
    try {
      await bridgeApi.deleteChannel(channel.id)
      setChannels((prev) => prev.filter((ch) => ch.id !== channel.id))
      toast.success(`已删除 ${label} 接入`)
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
              群主发送未 @ 助手的消息时，会自动触发该助手。
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
            <label className="mb-2 block text-sm font-medium text-muted-foreground">外部平台接入</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => {
                const linked = channels.find((ch) => ch.platform === p.key)
                const isActive = activePlatform === p.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      if (linked) {
                        handleDeleteChannel(linked)
                      } else {
                        setActivePlatform(isActive ? null : p.key)
                        setBindCode(null)
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                      linked
                        ? 'border-green-500 text-green-700 hover:bg-green-50'
                        : isActive
                        ? 'border-primary text-primary bg-primary/5'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                  >
                    <span>{p.emoji}</span>
                    <span>{p.label}</span>
                    {linked && <span className="text-green-500">●</span>}
                  </button>
                )
              })}
            </div>

            {activePlatform && !channels.find((ch) => ch.platform === activePlatform) && (
              <div className="mt-3 space-y-2">
                {!bindCode ? (
                  <button
                    type="button"
                    onClick={handleGetBindCode}
                    disabled={isGettingCode}
                    className="w-full rounded-lg bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {isGettingCode ? '生成中...' : '获取绑定码'}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      在 {PLATFORMS.find((p) => p.key === activePlatform)?.label} 群中发送以下命令完成绑定：
                    </p>
                    <div className="rounded-lg border border-border bg-muted px-3 py-3 text-center">
                      <span className="font-mono text-lg font-bold tracking-widest select-all">
                        /bind {bindCode.code}
                      </span>
                    </div>
                    <p className="text-xs text-center text-muted-foreground">15 分钟内有效</p>
                    <button
                      type="button"
                      onClick={() => setBindCode(null)}
                      className="w-full text-xs text-muted-foreground hover:text-foreground"
                    >
                      重新获取
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => { setActivePlatform(null); setBindCode(null) }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
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
