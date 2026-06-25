import { AgentSpeechConfig, ChatRoom, agentApi, chatRoomApi, type AgentThinkingMode } from '@/lib/agent-api'
import { useChatAreaStore } from '@/stores/chat-store'
import { ChatAreaHeader } from './chat-area-header'
import { ChatMessagesList } from './chat-messages-list'
import { ChatInputArea } from './chat-input-area'
import { ChatSidePanel } from './chat-side-panel'
import { AddAgentDialog } from './dialogs/add-agent-dialog'
import { CreateAssistantModal } from './create-assistant-modal'
import { ClearMessagesDialog } from './dialogs/clear-messages-dialog'
import { RoomRulesDialog } from './dialogs/room-rules-dialog'
import { RoomDispatchRulesDialog } from './dialogs/room-dispatch-rules-dialog'
import { RoomEnvVarsDialog } from './dialogs/room-env-vars-dialog'
import { StopAllTasksDialog } from './dialogs/stop-all-tasks-dialog'
import { ScreenshotModal } from './screenshot-modal'
import { MessageArchivesModal } from './message-archives-modal'
import { CustomCommandModal } from './dialogs/custom-command-modal'
import { useSocketStore, useChatRoomStore } from '@/stores'
import { useChatStore } from '@/stores/chat-store'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useQuickChatLocalSessionHint } from './hooks/use-quick-chat-local-session-hint'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { AtSign } from 'lucide-react'
import { toast } from 'sonner'

interface ChatAreaProps {
  chatRoom?: ChatRoom
  onChatRoomChange?: () => void
  onDeleteChatRoom?: (chatRoomId: string) => void
  isMobile?: boolean
}

export function ChatArea({ chatRoom, onChatRoomChange, onDeleteChatRoom, isMobile }: ChatAreaProps) {
  const { t } = useTranslation()
  const { user: currentUser, stopAgent, completeTodo } = useSocketStore()
  const todos = useSocketStore((s) => s.todos)
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId)
  const loadAllAgents = useChatStore((s) => s.loadAllAgents)
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const [showRoomRules, setShowRoomRules] = useState(false)
  const [showDispatchRules, setShowDispatchRules] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showScreenshot, setShowScreenshot] = useState(false)
  const [showCustomCommands, setShowCustomCommands] = useState(false)
  const [showMessageArchives, setShowMessageArchives] = useState(false)
  const [showCreateAssistant, setShowCreateAssistant] = useState(false)
  const [showStopAllConfirm, setShowStopAllConfirm] = useState(false)
  const [stopAllTargetAgentIds, setStopAllTargetAgentIds] = useState<string[]>([])
  const [visibleOwnerMentionTodoIds, setVisibleOwnerMentionTodoIds] = useState<Set<string>>(new Set())
  const completingVisibleTodoIdsRef = useRef<Set<string>>(new Set())
  const {
    setInputValue,
    messages,
    loading,
    loadingOlderMessages,
    hasOlderMessages,
    typingAgents,
    completedAgents,
    mentionAgents,
    agentStatuses,

    sidePanelMode,
    setSidePanelMode,
    executionRecords,
    recordsLoading,
    selectedRecord,
    setSelectedRecord,
    selectedRoomAgent,
    setSelectedRoomAgent,
    streamingViewAgent,
    setStreamingViewAgent,
    selectedReplyMessage,
    getReplies,

    showAddAgent,
    setShowAddAgent,
    addingAgentIds,
    showClearConfirm,
    setShowClearConfirm,
    clearing,
    availableAgents,

    handleSend,
    handleKeyDown,
    handleAddAgents,
    handleClearMessages,
    deleteMessage,
    deleteMessages,
    handleAgentAvatarClick,
    handleTypingAgentClick,
    handleReplyClick,
    handleExecutionDetailClick,
    messagesEndRef,
    loadExecutionRecords,
    contextLoading,
    contextInfo,
    executionDetailRecord,
    executionDetailLoading,
    pendingImages,
    handleImageSelect,
    removePendingImage,
    restoreStreamEventsFromRecord,
    loadOlderMessages,
  } = useChatAreaStore(chatRoom, onChatRoomChange)

  const activeTaskAgentIds = useMemo(() => {
    if (!chatRoom) return []

    const ids = new Set<string>()
    const currentMessageIds = new Set(messages.map((message) => message.id))
    for (const roomAgent of chatRoom.chatRoomAgents ?? []) {
      const agentId = roomAgent.agent?.id ?? roomAgent.agentId
      if (!agentId) continue

      const status = agentStatuses.get(agentId)
      if (status === 'executing' || status === 'busy') {
        ids.add(agentId)
      }
    }

    for (const [messageId, agents] of typingAgents) {
      if (!currentMessageIds.has(messageId)) continue
      for (const agent of agents) {
        if (agent.status !== 'cancelled') {
          ids.add(agent.agentId)
        }
      }
    }

    return [...ids]
  }, [agentStatuses, chatRoom, messages, typingAgents])

  const streamingMessageStartTime = useMemo(() => {
    if (!streamingViewAgent) return undefined

    const message = messages.find((item) => item.id === streamingViewAgent.messageId)
    if (!message) return undefined

    const timestamp = new Date(message.time).getTime()
    return Number.isFinite(timestamp) ? timestamp : undefined
  }, [messages, streamingViewAgent])

  const pendingOwnerMentionTodos = useMemo(() => {
    if (!chatRoom) return []
    return todos
      .filter((todo) => todo.chatRoomId === chatRoom.id && todo.status === 'pending')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [chatRoom, todos])
  const ownerMentionTodos = useMemo(
    () => pendingOwnerMentionTodos.filter((todo) => !visibleOwnerMentionTodoIds.has(todo.id)),
    [pendingOwnerMentionTodos, visibleOwnerMentionTodoIds],
  )
  const ownerMentionTodo = ownerMentionTodos[0] ?? null

  useEffect(() => {
    if (!chatRoom || pendingOwnerMentionTodos.length === 0) {
      setVisibleOwnerMentionTodoIds(new Set())
      return
    }

    let frameId: number | null = null

    const isMessageVisible = (messageId: string) => {
      const escapedId = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(messageId)
        : messageId.replace(/"/g, '\\"')
      const element = document.querySelector(`[data-message-id="${escapedId}"]`)
      if (!element) return false

      const rect = element.getBoundingClientRect()
      const topLimit = isMobile ? 56 : 72
      const bottomLimit = window.innerHeight - (isMobile ? 96 : 112)
      return rect.bottom > topLimit && rect.top < bottomLimit
    }

    const checkVisibleMentions = () => {
      frameId = null
      const visibleIds = new Set<string>()

      for (const todo of pendingOwnerMentionTodos) {
        if (!isMessageVisible(todo.messageId)) continue

        visibleIds.add(todo.id)
        if (!completingVisibleTodoIdsRef.current.has(todo.id)) {
          completingVisibleTodoIdsRef.current.add(todo.id)
          completeTodo(todo.id)
        }
      }

      setVisibleOwnerMentionTodoIds((previousIds) => {
        if (
          previousIds.size === visibleIds.size
          && [...visibleIds].every((id) => previousIds.has(id))
        ) {
          return previousIds
        }
        return visibleIds
      })
    }

    const scheduleCheck = () => {
      if (frameId !== null) return
      frameId = requestAnimationFrame(checkVisibleMentions)
    }

    scheduleCheck()
    document.addEventListener('scroll', scheduleCheck, true)
    window.addEventListener('resize', scheduleCheck)

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      document.removeEventListener('scroll', scheduleCheck, true)
      window.removeEventListener('resize', scheduleCheck)
    }
  }, [chatRoom, completeTodo, isMobile, pendingOwnerMentionTodos])

  const handleOwnerMentionClick = () => {
    if (!ownerMentionTodo) return

    setScrollToMessageId(ownerMentionTodo.messageId)
    completeTodo(ownerMentionTodo.id)
  }

  const handleStopAllTasks = () => {
    if (!chatRoom || activeTaskAgentIds.length === 0) return

    setStopAllTargetAgentIds(activeTaskAgentIds)
    setShowStopAllConfirm(true)
  }

  const confirmStopAllTasks = () => {
    if (!chatRoom || stopAllTargetAgentIds.length === 0) return

    setStreamingViewAgent(null)
    setSidePanelMode(null)
    for (const agentId of stopAllTargetAgentIds) {
      stopAgent(chatRoom.id, agentId)
    }
    setStopAllTargetAgentIds([])
    setShowStopAllConfirm(false)
  }

  const handleStopAllConfirmOpenChange = (open: boolean) => {
    setShowStopAllConfirm(open)
    if (!open) {
      setStopAllTargetAgentIds([])
    }
  }

  // 任务执行中按 Esc 直接取消（无需弹框确认），输入框回填由 ChatInputArea 处理
  const handleCancelExecutingTasks = () => {
    if (!chatRoom || activeTaskAgentIds.length === 0) return
    setStreamingViewAgent(null)
    setSidePanelMode(null)
    for (const agentId of activeTaskAgentIds) {
      stopAgent(chatRoom.id, agentId)
    }
  }

  const handleShowLocalSessions = useCallback((tool: 'claude' | 'codex') => {
    setSelectedRoomAgent(null)
    setSidePanelMode(tool === 'codex' ? 'codex-local-sessions' : 'claude-local-sessions')
  }, [setSelectedRoomAgent, setSidePanelMode])

  // 首次进入空白快速对话时，检测当前项目是否存在 Claude / Codex 本地会话并提示
  useQuickChatLocalSessionHint({
    chatRoom,
    messagesEmpty: messages.length === 0,
    loading,
    onShowSessions: handleShowLocalSessions,
  })

  if (!chatRoom) {
    return (
      <div className="relative flex flex-1 items-center justify-center bg-[var(--surface)] text-muted-foreground">
        {!isMobile && window.electronAPI?.isElectron && (
          <div
            aria-hidden="true"
            className="absolute left-0 right-0 top-0 h-12"
            style={{ WebkitAppRegion: 'drag' } as CSSProperties}
          />
        )}
        {t('chat.selectGroupToChat')}
      </div>
    )
  }

  const handleSidePanelClose = () => {
    // record-detail 关闭时返回历史列表
    if (sidePanelMode === 'record-detail') {
      setSidePanelMode('history')
    } else if (sidePanelMode === 'context' || sidePanelMode === 'history') {
      // context/history 关闭时返回助手详情
      setSidePanelMode('agent-detail')
    } else if (sidePanelMode === 'reply-detail' || sidePanelMode === 'room-settings' || sidePanelMode === 'execution-detail' || sidePanelMode === 'claude-local-sessions' || sidePanelMode === 'codex-local-sessions') {
      // reply-detail/room-settings/execution-detail/claude/codex-local-sessions 关闭时直接关闭面板
      setSidePanelMode(null)
    } else {
      setSidePanelMode(null)
      setStreamingViewAgent(null)
    }
  }

  const handleOpenRoomSettings = () => {
    setSidePanelMode('room-settings')
  }

  const handleOpenCronTasks = () => {
    setSelectedRoomAgent(null)
    setSidePanelMode('cron-tasks')
  }

  const handleOpenTaskBoard = () => {
    setSelectedRoomAgent(null)
    setSidePanelMode(useChatStore.getState().sidePanelMode === 'task-board' ? null : 'task-board')
  }

  const handleOpenMessageArchives = () => {
    setShowMessageArchives(true)
  }

  const handleOpenClaudeLocalSessions = () => {
    setSelectedRoomAgent(null)
    setSidePanelMode('claude-local-sessions')
  }

  const handleOpenCodexLocalSessions = () => {
    setSelectedRoomAgent(null)
    setSidePanelMode('codex-local-sessions')
  }

  const handleDeleteChatRoom = () => {
    if (chatRoom) {
      setSidePanelMode(null)
      selectRoom('')  // 清除选中的群聊
      onChatRoomChange?.()
      onDeleteChatRoom?.(chatRoom.id)
    }
  }

  const handleStopAgent = (agentId: string, messageId?: string) => {
    if (chatRoom) {
      stopAgent(chatRoom.id, agentId, messageId)
    }
  }

  // 处理点击助手名称自动 @
  const handleMentionAgent = (_agentId: string, agentName: string) => {
    // 惰性读取当前输入值，避免订阅 inputValue 导致输入时整片消息列表重渲染
    const draft = chatRoom?.id
      ? useChatStore.getState().inputDraftsByRoom[chatRoom.id] ?? ''
      : useChatStore.getState().inputValue
    const currentValue = draft.trim()
    // 如果输入框已有内容且不以空格结尾，添加空格
    const prefix = currentValue && !currentValue.endsWith(' ') ? `${currentValue} ` : currentValue
    // 添加 @助手名 和一个空格
    setInputValue(`${prefix}@${agentName} `, chatRoom?.id)
  }

  const handleOpenCreateAssistant = () => {
    setShowAddAgent(false)
    setShowCreateAssistant(true)
  }

  const handleCreateAssistant = async (data: {
    name: string
    avatar: string
    description: string
    prompt: string
    type: 'builtin' | 'acp'
    acpTool: string
    proxyConfig?: string | null
    codexModel?: string | null
    codexFastMode?: boolean
    claudeModel?: string | null
    thinkingMode?: AgentThinkingMode | null
    categoryId: string | null
    llmProviderId: string | null
    fallbackLlmProviderIds: string[]
    speechConfig: AgentSpeechConfig | null
    imageGeneration?: { enabled: boolean; llmProviderId: string | null }
  }): Promise<boolean> => {
    if (!chatRoom) return false

    const createResponse = await agentApi.create({
      name: data.name,
      avatar: data.avatar,
      description: data.description,
      prompt: data.prompt,
      type: data.type,
      acpTool: data.acpTool || undefined,
      proxyConfig: data.proxyConfig || null,
      codexModel: data.codexModel || null,
      codexFastMode: Boolean(data.codexFastMode),
      claudeModel: data.claudeModel || null,
      thinkingMode: data.thinkingMode || 'high',
      categoryId: data.categoryId || undefined,
      llmProviderId: data.llmProviderId || undefined,
      fallbackLlmProviderIds: data.fallbackLlmProviderIds,
      speechConfig: data.speechConfig,
      imageGeneration: data.imageGeneration,
    })

    if (!createResponse.success || !createResponse.data) {
      toast.error(createResponse.error || t('assistant.createFailed'))
      return false
    }

    await loadAllAgents()

    const addResponse = await chatRoomApi.addAgent(chatRoom.id, {
      agentId: createResponse.data.id,
    })

    if (!addResponse.success) {
      toast.error(t('chat.agentsPanel.createdButAddFailed'))
      await Promise.resolve(onChatRoomChange?.())
      return true
    }

    toast.success(t('chat.agentsPanel.createdAndAdded'))
    await Promise.resolve(onChatRoomChange?.())
    await loadAllAgents()
    return true
  }

  const isTaskBoardOpen = sidePanelMode === 'task-board'

  return (
    <div className={cn("flex flex-1 flex-col bg-background", isMobile ? "min-h-0" : "")}>
      {/* Header - 移动端不显示，由 MobileChatDetailPage 提供 */}
      {!isMobile && (
        <ChatAreaHeader
          chatRoom={chatRoom}
          messages={messages}
          onShowAddAgent={setShowAddAgent}
          onToggleAgentsPanel={() => setSidePanelMode(sidePanelMode === 'agents' ? null : 'agents')}
          onOpenRoomSettings={handleOpenRoomSettings}
          onClearMessages={() => setShowClearConfirm(true)}
          onOpenCronTasks={handleOpenCronTasks}
          onOpenTaskBoard={handleOpenTaskBoard}
          onOpenMessageArchives={handleOpenMessageArchives}
          taskBoardActive={isTaskBoardOpen}
          hasActiveTasks={activeTaskAgentIds.length > 0}
          onStopAllTasks={handleStopAllTasks}
          onOpenRoomRules={() => setShowRoomRules(true)}
          onOpenDispatchRules={() => setShowDispatchRules(true)}
          onOpenEnvVars={() => setShowEnvVars(true)}
          onOpenCustomCommands={() => setShowCustomCommands(true)}
          onScreenshot={() => setShowScreenshot(true)}
          onOpenClaudeLocalSessions={handleOpenClaudeLocalSessions}
          onOpenCodexLocalSessions={handleOpenCodexLocalSessions}
        />
      )}

      {/* Messages, Input and Side Panel */}
      <div className={cn("flex flex-1", isMobile ? "min-h-0" : "overflow-hidden")}>
        {/* Messages and Input area */}
        {!isTaskBoardOpen && (
          <div className="relative flex flex-1 flex-col min-w-0 bg-background">
            {ownerMentionTodo && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
                <button
                  type="button"
                  onClick={handleOwnerMentionClick}
                  className="pointer-events-auto flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 shadow-lg shadow-orange-500/10 transition-colors hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/80 dark:text-orange-200 dark:hover:bg-orange-900/80"
                >
                  <AtSign className="size-3.5" />
                  <span>
                    {ownerMentionTodos.length > 1
                      ? t('chat.ownerMentionCount', { count: ownerMentionTodos.length })
                      : t('chat.ownerMentionSingle', { name: ownerMentionTodo.triggerAgentName })}
                  </span>
                </button>
              </div>
            )}

            {/* Messages */}
            <ChatMessagesList
              chatRoomId={chatRoom.id}
              messages={messages}
              loading={loading}
              loadingOlderMessages={loadingOlderMessages}
              hasOlderMessages={hasOlderMessages}
              messagesEndRef={messagesEndRef}
              typingAgents={typingAgents}
              mentionAgents={mentionAgents}
              onAgentAvatarClick={handleAgentAvatarClick}
              onTypingAgentClick={handleTypingAgentClick}
              onMentionClick={handleAgentAvatarClick}
              onReplyClick={handleReplyClick}
              onExecutionDetailClick={handleExecutionDetailClick}
              onMentionAgent={handleMentionAgent}
              onDeleteMessage={deleteMessage}
              onDeleteMessages={deleteMessages}
              onLoadOlderMessages={loadOlderMessages}
              currentUser={currentUser}
              isSidePanelOpen={!isMobile && sidePanelMode !== null}
            />

            {/* Input area */}
            <ChatInputArea
              chatRoomId={chatRoom.id}
              chatRoomWorkDir={chatRoom.workDir}
              chatRoomName={chatRoom.name}
              handleKeyDown={handleKeyDown}
              handleSend={handleSend}
              isTaskExecuting={activeTaskAgentIds.length > 0}
              onCancelExecutingTasks={handleCancelExecutingTasks}
              mentionAgents={mentionAgents}
              onMentionClick={handleAgentAvatarClick}
              pendingImages={pendingImages}
              onImageSelect={handleImageSelect}
              onImageRemove={removePendingImage}
            />
          </div>
        )}

        {/* Side Panel */}
        <ChatSidePanel
          open={sidePanelMode !== null}
          sidePanelMode={sidePanelMode}
          onClose={handleSidePanelClose}
          chatRoom={chatRoom}
          selectedRoomAgent={selectedRoomAgent}
          setSelectedRoomAgent={setSelectedRoomAgent}
          setSidePanelMode={setSidePanelMode}
          setStreamingViewAgent={setStreamingViewAgent}
          streamingViewAgent={streamingViewAgent}
          streamingMessageStartTime={streamingMessageStartTime}
          completedAgents={completedAgents}
          agentStatuses={agentStatuses}
          recordsLoading={recordsLoading}
          executionRecords={executionRecords}
          selectedRecord={selectedRecord}
          setSelectedRecord={setSelectedRecord}
          selectedReplyMessage={selectedReplyMessage}
          getReplies={getReplies}
          mentionAgents={mentionAgents}
          loadExecutionRecords={loadExecutionRecords}
          contextLoading={contextLoading}
          contextInfo={contextInfo}
          onChatRoomChange={onChatRoomChange}
          onDeleteChatRoom={handleDeleteChatRoom}
          onClearMessages={() => setShowClearConfirm(true)}
          onStopAgent={handleStopAgent}
          executionDetailRecord={executionDetailRecord}
          executionDetailLoading={executionDetailLoading}
          restoreStreamEventsFromRecord={restoreStreamEventsFromRecord}
          isMobile={isMobile}
          onInsertMention={handleMentionAgent}
        />
      </div>

      {/* Add Agent Dialog */}
      <AddAgentDialog
        open={showAddAgent}
        onClose={() => setShowAddAgent(false)}
        availableAgents={availableAgents}
        addingAgentIds={addingAgentIds}
        onAddAgents={handleAddAgents}
        onCreateAssistant={handleOpenCreateAssistant}
      />

      <CreateAssistantModal
        isOpen={showCreateAssistant}
        onClose={() => setShowCreateAssistant(false)}
        onSubmit={handleCreateAssistant}
        submitLabel={t('common.createAndAdd')}
      />

      {/* Clear Messages Confirm Dialog */}
      <ClearMessagesDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        clearing={clearing}
        onClear={handleClearMessages}
      />

      <MessageArchivesModal
        open={showMessageArchives}
        onOpenChange={setShowMessageArchives}
        chatRoom={chatRoom}
        currentUser={currentUser}
      />

      {/* Stop All Tasks Confirm Dialog */}
      <StopAllTasksDialog
        open={showStopAllConfirm}
        onOpenChange={handleStopAllConfirmOpenChange}
        taskCount={stopAllTargetAgentIds.length}
        onConfirm={confirmStopAllTasks}
      />

      {/* Room Rules Dialog */}
      <RoomRulesDialog
        isOpen={showRoomRules}
        onClose={() => setShowRoomRules(false)}
        chatRoom={chatRoom}
        onChatRoomChange={onChatRoomChange || (() => {})}
      />

      {/* Room Dispatch Rules Dialog */}
      <RoomDispatchRulesDialog
        isOpen={showDispatchRules}
        onClose={() => setShowDispatchRules(false)}
        chatRoom={chatRoom}
        onChatRoomChange={onChatRoomChange || (() => {})}
      />

      {/* Room Env Vars Dialog */}
      <RoomEnvVarsDialog
        isOpen={showEnvVars}
        onClose={() => setShowEnvVars(false)}
        chatRoom={chatRoom}
        onChatRoomChange={onChatRoomChange || (() => {})}
      />

      {/* Custom Commands Modal */}
      <CustomCommandModal
        isOpen={showCustomCommands}
        onClose={() => setShowCustomCommands(false)}
        chatRoomId={chatRoom.id}
      />

      {/* Screenshot Modal */}
      <ScreenshotModal
        open={showScreenshot}
        onOpenChange={setShowScreenshot}
        messages={messages}
        roomName={chatRoom.name}
        roomAvatar={chatRoom.avatar}
        isQuickChatRoom={chatRoom.isQuickChatRoom}
        mentionAgents={mentionAgents}
        currentUser={currentUser ? {
          username: currentUser.username,
          avatar: currentUser.avatar,
          avatarColor: currentUser.avatarColor,
        } : { username: '用户' }}
      />
    </div>
  )
}
