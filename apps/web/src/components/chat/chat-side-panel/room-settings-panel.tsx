import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChatRoom, chatRoomApi, type AgentTriggerMode } from '@/lib/agent-api'
import { bridgeApi, BridgeBot } from '@/lib/bridge-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { groupAvatarOptions, GroupAvatarImage } from '@/lib/group-avatars'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores'
import { Bot, Eraser, Pencil, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AvatarSelector } from '../avatar-selector'
import { WorkDirCard, type FolderOpenTarget } from './work-dir-card'
import { RoomEnvVarsEditor } from './room-env-vars-editor'

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
  const { t } = useTranslation()
  const [name, setName] = useState(chatRoom.name)
  const [description, setDescription] = useState(chatRoom.description || '')
  const [rules, setRules] = useState(chatRoom.rules || '')
  const [workDir, setWorkDir] = useState(chatRoom.workDir || '')
  const [defaultAgentId, setDefaultAgentId] = useState(chatRoom.defaultAgentId || '')
  // 智能协作（coordinator，兼容存量 auto）/ 手动（manual）
  const [agentTriggerMode, setAgentTriggerMode] = useState<AgentTriggerMode>(
    chatRoom.agentTriggerMode === 'manual' ? 'manual' : 'coordinator',
  )
  // 头像预览使用真实头像值（可能是自定义上传地址或预设索引），而不是归一化后的索引
  const [avatarValue, setAvatarValue] = useState<string | number | null | undefined>(chatRoom.avatar)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // 外部平台机器人绑定
  const [roomBots, setRoomBots] = useState<BridgeBot[]>([])
  const [showUnbindBotConfirm, setShowUnbindBotConfirm] = useState(false)
  const [pendingUnbindBot, setPendingUnbindBot] = useState<BridgeBot | null>(null)

  // 编辑状态
  const [editingName, setEditingName] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [editingRules, setEditingRules] = useState(false)
  const [editingWorkDir, setEditingWorkDir] = useState(false)
  const [workDirDraft, setWorkDirDraft] = useState(chatRoom.workDir || '')
  const [openingFolder, setOpeningFolder] = useState(false)
  const terminalOpenTarget = useUIStore((state) => state.terminalOpenTarget)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [rulesDirty, setRulesDirty] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const descInputRef = useRef<HTMLInputElement>(null)
  const rulesInputRef = useRef<HTMLTextAreaElement>(null)
  const selectableAgents = (chatRoom.chatRoomAgents || []).filter(
    (roomAgent) => roomAgent.agent && roomAgent.agent.agentLevel !== 'system'
  )
  const hasSelectedDefaultAgent = selectableAgents.some((roomAgent) => roomAgent.agent?.id === defaultAgentId)

  useEffect(() => {
    setName(chatRoom.name)
    setDescription(chatRoom.description || '')
    setRules(chatRoom.rules || '')
    setWorkDir(chatRoom.workDir || '')
    setWorkDirDraft(chatRoom.workDir || '')
    setDefaultAgentId(chatRoom.defaultAgentId || '')
    setAgentTriggerMode(chatRoom.agentTriggerMode === 'manual' ? 'manual' : 'coordinator')
    setAvatarValue(chatRoom.avatar)
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

  const handleSave = async (updates: { name?: string; avatar?: string; description?: string; rules?: string; workDir?: string | null; defaultAgentId?: string | null; agentTriggerMode?: AgentTriggerMode }) => {
    setSaving(true)
    try {
      const response = await chatRoomApi.update(chatRoom.id, updates)
      if (response.success) {
        onChatRoomChange()
        return true
      } else {
        toast.error(t('common.saveFailed'))
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

  const handleSelectAvatar = (avatar: string) => {
    setAvatarValue(avatar)
    handleSave({ avatar })
  }

  const handleDefaultAgentChange = (value: string) => {
    const nextAgentId = value === '__none__' ? '' : value
    setDefaultAgentId(nextAgentId)
    handleSave({ defaultAgentId: nextAgentId || null })
  }

  const handleTriggerModeChange = (value: AgentTriggerMode) => {
    setAgentTriggerMode(value)
    handleSave({ agentTriggerMode: value })
  }

  const handleDeleteChannel = (channel: BridgeBot) => {
    setPendingUnbindBot(channel)
    setShowUnbindBotConfirm(true)
  }

  const handleConfirmUnbindBot = async () => {
    if (!pendingUnbindBot) return
    try {
      await bridgeApi.unbindBot(pendingUnbindBot.id)
      setRoomBots((prev) => prev.filter((ch) => ch.id !== pendingUnbindBot.id))
      toast.success(t('chat.roomSettings.botUnbound', { name: pendingUnbindBot.name }))
    } catch (err) {
      toast.error(t('common.deleteFailed'))
    } finally {
      setShowUnbindBotConfirm(false)
      setPendingUnbindBot(null)
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
      const result = await window.electronAPI.openFolder(displayWorkDir, target, terminalOpenTarget)
      if (!result?.success) {
        toast.error(t('chat.roomSettings.openFolderFailed'))
      }
    } catch {
      toast.error(t('chat.roomSettings.openFolderFailed'))
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
        toast.error(t('common.deleteFailed'))
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
        {/* 头像预览（快速对话群聊头像跟随助手，不可修改，渲染方式需与聊天 header 一致） */}
        <div className="flex flex-col items-center py-4">
          {chatRoom.isQuickChatRoom ? (
            <AgentAvatarImage avatar={avatarValue ?? null} className="size-16 rounded-full" />
          ) : (
            <button
              type="button"
              onClick={() => setAvatarModalOpen(true)}
              className="group relative rounded-full transition-all hover:ring-2 hover:ring-primary/40 hover:ring-offset-2 hover:ring-offset-background"
              title={t('chat.roomSettings.changeAvatar')}
            >
              <GroupAvatarImage avatar={avatarValue} className="size-16 rounded-full" />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                <Pencil className="size-5" />
              </span>
            </button>
          )}
        </div>

        {/* 群名称 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t('chat.roomSettings.groupName')}</label>
          {editingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={(e) => {
                // 中文输入法选词回车时 isComposing 为 true，需忽略，避免误确认
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  setName(chatRoom.name)
                  setEditingName(false)
                }
              }}
              placeholder={t('chat.roomSettings.groupNamePlaceholder')}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              disabled={saving}
            />
          ) : (
            <div
              className="flex cursor-pointer items-center justify-between rounded-lg border border-input px-3 py-2 hover:bg-accent"
              onClick={() => setEditingName(true)}
            >
              <span className="text-sm text-foreground">{chatRoom.name || t('chat.roomSettings.unnamed')}</span>
              <Pencil className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* 群描述 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t('chat.roomSettings.groupDescription')}</label>
          {editingDescription ? (
            <input
              ref={descInputRef}
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              onKeyDown={(e) => {
                // 中文输入法选词回车时 isComposing 为 true，需忽略，避免误确认
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  setDescription(chatRoom.description || '')
                  setEditingDescription(false)
                }
              }}
              placeholder={t('chat.roomSettings.groupDescriptionPlaceholder')}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              disabled={saving}
            />
          ) : (
            <div
              className="flex cursor-pointer items-center justify-between rounded-lg border border-input px-3 py-2 hover:bg-accent"
              onClick={() => setEditingDescription(true)}
            >
              <span className="text-sm text-foreground">{chatRoom.description || t('chat.roomSettings.noDescription')}</span>
              <Pencil className="size-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* 工作目录 */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-sm font-medium text-muted-foreground">{t('chat.workDirectory')}</label>
            {workDir && <span className="text-xs font-medium text-blue-600">{t('chat.roomSettings.customWorkDir')}</span>}
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
              toast.success(t('chat.roomSettings.workDirCopied'))
            }}
          />
        </div>

        {/* 默认接收助手（智能协作模式下默认助手优先、群调度助手兜底） */}
        {!chatRoom.isQuickChatRoom && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t('chat.roomSettings.defaultAssistantLabel')}</label>
            <div className="text-xs text-muted-foreground mb-2">
              {t('chat.roomSettings.defaultAssistantHint')}
            </div>
            <Select
              value={defaultAgentId || '__none__'}
              onValueChange={handleDefaultAgentChange}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('chat.roomSettings.noDefault')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('chat.roomSettings.noDefault')}</SelectItem>
                {defaultAgentId && !hasSelectedDefaultAgent && (
                  <SelectItem value={defaultAgentId}>{t('chat.roomSettings.invalidDefaultAssistant')}</SelectItem>
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
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">{t('chat.roomSettings.triggerModeLabel')}</label>
            <div className="text-xs text-muted-foreground mb-2">
              {t('chat.roomSettings.triggerModeCoordinatorHint')}<br />
              {t('chat.roomSettings.triggerModeManualHint')}
            </div>
            <Select
              value={agentTriggerMode}
              onValueChange={(v) => handleTriggerModeChange(v as AgentTriggerMode)}
              disabled={saving}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="coordinator">{t('chat.roomSettings.triggerModeCoordinator')}</SelectItem>
                <SelectItem value="manual">{t('chat.roomSettings.triggerModeManual')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* 群规则 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-sm font-medium text-muted-foreground">{t('chat.roomSettings.rulesLabel')}</label>
            {!editingRules && (
              <button
                onClick={() => { setEditingRules(true); setRulesDirty(false) }}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
              >
                <Pencil className="size-3" />
                {t('common.edit')}
              </button>
            )}
          </div>
          <div className="text-xs text-muted-foreground mb-2">
            {t('chat.roomSettings.rulesHint')}
          </div>
          {editingRules ? (
            <div className="space-y-2">
              {/* 预设规则模板 */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: t('chat.roomSettings.ruleTemplateAntiLoop'), text: t('chat.roomSettings.ruleTemplateAntiLoopText') },
                  { label: t('chat.roomSettings.ruleTemplateAntiFanout'), text: t('chat.roomSettings.ruleTemplateAntiFanoutText') },
                  { label: t('chat.roomSettings.ruleTemplateUseChinese'), text: t('chat.roomSettings.ruleTemplateUseChineseText') },
                  { label: t('chat.roomSettings.ruleTemplateExplainReason'), text: t('chat.roomSettings.ruleTemplateExplainReasonText') },
                ].map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      const sep = rules.trim() ? '\n' : ''
                      setRules((prev) => prev.trim() + sep + '- ' + tpl.text)
                      setRulesDirty(true)
                    }}
                    className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10"
                  >
                    + {tpl.label}
                  </button>
                ))}
              </div>
              <textarea
                ref={rulesInputRef}
                value={rules}
                onChange={(e) => { setRules(e.target.value); setRulesDirty(true) }}
                placeholder={t('chat.roomSettings.rulesPlaceholder')}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50 min-h-[100px] resize-y"
                disabled={saving}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t('chat.roomSettings.rulesCharCount', { count: rules.length })}</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingRules(false)
                      setRules(chatRoom.rules || '')
                      setRulesDirty(false)
                    }}
                    className="rounded-lg border border-input px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
                    disabled={saving}
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await handleSave({ rules: rules.trim() || undefined })
                      if (ok) { setEditingRules(false); setRulesDirty(false) }
                    }}
                    disabled={saving || !rulesDirty}
                    className="flex items-center gap-1 rounded-lg bg-blue-500 px-3 py-1.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Save className="size-3" />
                    {t('common.save')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="cursor-pointer rounded-lg border border-input px-3 py-2 hover:bg-accent min-h-[60px]"
              onClick={() => { setEditingRules(true); setRulesDirty(false) }}
            >
              <span className="text-sm text-foreground whitespace-pre-wrap">
                {chatRoom.rules || <span className="text-muted-foreground">{t('chat.roomSettings.noRules')}</span>}
              </span>
            </div>
          )}
        </div>

        {/* 环境变量 */}
        <RoomEnvVarsEditor
          chatRoomId={chatRoom.id}
          envVars={chatRoom.envVars}
          onSaved={onChatRoomChange}
        />

        {/* 快速对话提示 */}
        {chatRoom.isQuickChatRoom && (
          <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            {t('chat.roomSettings.quickChatHint')}
          </div>
        )}

        {/* 外部平台接入 */}
        <div className="border-t border-border pt-4 mt-4">
          <label className="mb-2 block text-sm font-medium text-muted-foreground">{t('chat.roomSettings.botBindingLabel')}</label>
          <p className="mb-3 text-xs text-muted-foreground">{t('chat.roomSettings.botBindingHint')}</p>
          {roomBots.length > 0 ? (
            <div className="space-y-2">
              {roomBots.map((bot) => (
                  <div key={bot.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-lg',
                        bot.enabled ? 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400' : 'bg-muted text-muted-foreground',
                      )}>
                        <Bot className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">{bot.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">{bot.platform}</span>
                          <span className="text-muted-foreground/50">•</span>
                          <span className={cn('inline-flex items-center gap-1', bot.enabled ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
                            <span className={cn('size-1.5 rounded-full', bot.enabled ? 'bg-green-500 dark:bg-green-400' : 'bg-muted-foreground/50')} />
                            {bot.enabled ? t('chat.roomSettings.botEnabled') : t('chat.roomSettings.botDisabled')}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteChannel(bot)}
                      className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      {t('chat.roomSettings.unbindBot')}
                    </button>
                  </div>
                ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              {t('chat.roomSettings.noBotBinding')}
            </div>
          )}
        </div>
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
            {t('chat.roomSettings.clearMessagesBtn')}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            {t('chat.roomSettings.deleteChatBtn')}
          </button>
        </div>
      </div>

      {/* 头像选择弹框 */}
      {avatarModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAvatarModalOpen(false)}
        >
          <div
            className="w-full max-w-[34rem] rounded-2xl bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">{t('chat.roomSettings.changeGroupAvatar')}</h3>
              <button
                type="button"
                onClick={() => setAvatarModalOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5">
              <AvatarSelector
                value={avatarValue}
                onChange={handleSelectAvatar}
                options={groupAvatarOptions}
                optionAriaLabel={(index) => t('assistant.selectAvatarIndex', { index: index + 1 })}
                gridClassName="grid-cols-6 justify-items-center"
                renderAvatar={(avatar, className) => (
                  <GroupAvatarImage avatar={avatar} className={cn('rounded-full', className)} />
                )}
              />
            </div>
          </div>
        </div>
      )}

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('chat.roomSettings.deleteChatBtn')}
        description={t('chat.roomSettings.deleteChatConfirm', { name: chatRoom.name })}
        confirmText={t('common.delete')}
        onConfirm={handleDelete}
        icon={Trash2}
      />

      {/* 解绑机器人确认对话框 */}
      <ConfirmDialog
        open={showUnbindBotConfirm}
        onOpenChange={setShowUnbindBotConfirm}
        title={t('chat.roomSettings.unbindBot')}
        description={t('chat.roomSettings.unbindBotConfirm', { name: pendingUnbindBot?.name ?? '' })}
        confirmText={t('chat.roomSettings.unbindBot')}
        onConfirm={handleConfirmUnbindBot}
        icon={Trash2}
      />
    </div>
  )
}
