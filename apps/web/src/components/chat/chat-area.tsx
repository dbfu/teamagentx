import { ChatRoom } from '@/lib/agent-api'
import { useChatAreaStore } from '@/stores/chat-store'
import { ChatAreaHeader } from './chat-area-header'
import { ChatMessagesList } from './chat-messages-list'
import { ChatInputArea } from './chat-input-area'
import { ChatSidePanel } from './chat-side-panel'
import { AddAgentDialog } from './dialogs/add-agent-dialog'
import { ClearMessagesDialog } from './dialogs/clear-messages-dialog'
import { RoomRulesDialog } from './dialogs/room-rules-dialog'
import { ScreenshotModal } from './screenshot-modal'
import { useSocketStore, useChatRoomStore } from '@/stores'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ChatAreaProps {
  chatRoom?: ChatRoom
  onChatRoomChange?: () => void
  onDeleteChatRoom?: (chatRoomId: string) => void
  isMobile?: boolean
}

export function ChatArea({ chatRoom, onChatRoomChange, onDeleteChatRoom, isMobile }: ChatAreaProps) {
  const { user: currentUser, stopAgent } = useSocketStore()
  const selectRoom = useChatRoomStore((s) => s.selectRoom)
  const [showRoomRules, setShowRoomRules] = useState(false)
  const [showScreenshot, setShowScreenshot] = useState(false)
  const {
    inputValue,
    setInputValue,
    messages,
    loading,
    typingAgents,
    streamEvents,
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
    addingAgentId,
    showClearConfirm,
    setShowClearConfirm,
    clearing,
    availableAgents,

    handleSend,
    handleKeyDown,
    handleAddAgent,
    handleClearMessages,
    handleAgentAvatarClick,
    handleTypingAgentClick,
    handleReplyClick,
    handleExecutionDetailClick,
    findReplyTo,
    replyCounts,
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
  } = useChatAreaStore(chatRoom, onChatRoomChange)

  if (!chatRoom) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[var(--surface)] text-muted-foreground">
        选择一个群聊开始对话
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

  const handleDeleteChatRoom = () => {
    if (chatRoom) {
      setSidePanelMode(null)
      selectRoom('')  // 清除选中的群聊
      onChatRoomChange?.()
      onDeleteChatRoom?.(chatRoom.id)
    }
  }

  const handleStopAgent = (agentId: string) => {
    if (chatRoom) {
      setStreamingViewAgent(null)
      setSidePanelMode(null)
      stopAgent(chatRoom.id, agentId)
    }
  }

  // 处理点击助手名称自动 @
  const handleMentionAgent = (_agentId: string, agentName: string) => {
    const currentValue = inputValue.trim()
    // 如果输入框已有内容且不以空格结尾，添加空格
    const prefix = currentValue && !currentValue.endsWith(' ') ? `${currentValue} ` : currentValue
    // 添加 @助手名 和一个空格
    setInputValue(`${prefix}@${agentName} `)
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
          taskBoardActive={isTaskBoardOpen}
          onOpenRoomRules={() => setShowRoomRules(true)}
          onScreenshot={() => setShowScreenshot(true)}
        />
      )}

      {/* Messages, Input and Side Panel */}
      <div className={cn("flex flex-1", isMobile ? "min-h-0" : "overflow-hidden")}>
        {/* Messages and Input area */}
        {!isTaskBoardOpen && (
          <div className="flex flex-1 flex-col min-w-0 bg-background">
            {/* Messages */}
            <ChatMessagesList
              chatRoomId={chatRoom.id}
              messages={messages}
              loading={loading}
              messagesEndRef={messagesEndRef}
              typingAgents={typingAgents}
              streamEvents={streamEvents}
              mentionAgents={mentionAgents}
              replyCounts={replyCounts}
              findReplyTo={findReplyTo}
              onAgentAvatarClick={handleAgentAvatarClick}
              onTypingAgentClick={handleTypingAgentClick}
              onMentionClick={handleAgentAvatarClick}
              onReplyClick={handleReplyClick}
              onExecutionDetailClick={handleExecutionDetailClick}
              onMentionAgent={handleMentionAgent}
              currentUser={currentUser}
            />

            {/* Input area */}
            <ChatInputArea
              chatRoomName={chatRoom.name}
              handleKeyDown={handleKeyDown}
              handleSend={handleSend}
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
          completedAgents={completedAgents}
          streamEvents={streamEvents}
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
        addingAgentId={addingAgentId}
        onAddAgent={handleAddAgent}
      />

      {/* Clear Messages Confirm Dialog */}
      <ClearMessagesDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        clearing={clearing}
        onClear={handleClearMessages}
      />

      {/* Room Rules Dialog */}
      <RoomRulesDialog
        isOpen={showRoomRules}
        onClose={() => setShowRoomRules(false)}
        chatRoom={chatRoom}
        onChatRoomChange={onChatRoomChange || (() => {})}
      />

      {/* Screenshot Modal */}
      <ScreenshotModal
        open={showScreenshot}
        onOpenChange={setShowScreenshot}
        messages={messages}
        roomName={chatRoom.name}
        roomAvatar={chatRoom.avatar}
        roomAvatarColor={chatRoom.avatarColor}
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
