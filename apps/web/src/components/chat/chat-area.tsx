import { ChatRoom } from '@/lib/agent-api'
import { useChatAreaStore } from '@/stores/chat-store'
import { ChatAreaHeader } from './chat-area-header'
import { ChatMessagesList } from './chat-messages-list'
import { ChatInputArea } from './chat-input-area'
import { ChatSidePanel } from './chat-side-panel'
import { AddAgentDialog } from './dialogs/add-agent-dialog'
import { ClearMessagesDialog } from './dialogs/clear-messages-dialog'
import { RoomRulesDialog } from './dialogs/room-rules-dialog'
import { RoomEnvVarsDialog } from './dialogs/room-env-vars-dialog'
import { StopAllTasksDialog } from './dialogs/stop-all-tasks-dialog'
import { ScreenshotModal } from './screenshot-modal'
import { MessageArchivesModal } from './message-archives-modal'
import { CustomCommandModal } from './dialogs/custom-command-modal'
import { useSocketStore, useChatRoomStore } from '@/stores'
import { useChatStore } from '@/stores/chat-store'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { AtSign } from 'lucide-react'

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
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const [showRoomRules, setShowRoomRules] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showScreenshot, setShowScreenshot] = useState(false)
  const [showCustomCommands, setShowCustomCommands] = useState(false)
  const [showMessageArchives, setShowMessageArchives] = useState(false)
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

  if (!chatRoom) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--surface)] text-muted-foreground">
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
    } else if (sidePanelMode === 'reply-detail' || sidePanelMode === 'room-settings' || sidePanelMode === 'execution-detail') {
      // reply-detail/room-settings/execution-detail 关闭时直接关闭面板
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
    setSidePanelMode('task-board')
  }

  const handleOpenMessageArchives = () => {
    setShowMessageArchives(true)
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
          onOpenEnvVars={() => setShowEnvVars(true)}
          onOpenCustomCommands={() => setShowCustomCommands(true)}
          onScreenshot={() => setShowScreenshot(true)}
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
