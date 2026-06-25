import { SidePanel } from '@/components/ui/side-panel'
import { AgentContextInfo, ChatRoom, debugApi, ExecutionRecord, Message } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { cn } from '@/lib/utils'
import { isStreamViewBlocked } from '@/lib/system-agents'
import { useChatStore, useThrottledStreamEvents, type SidePanelMode } from '@/stores/chat-store'
import type { AgentStatus } from '@/stores/socket-store'
import { Bot, ClipboardList, Clock, Info, List, Loader2, MessageSquareMore, MessagesSquare, Settings, Users } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentDetailPanel } from './agent-detail-panel'
import { AgentsPanel } from './agents-panel'
import { ClaudeLocalSessionsPanel } from './claude-local-sessions-panel'
import { ContextPanel } from './context-panel'
import { CronTasksPanel } from './cron-tasks-panel'
import { HistoryPanel } from './history-panel'
import { RecordDetailPanel } from './record-detail-panel'
import { ReplyDetailPanel } from './reply-detail-panel'
import { RoomSettingsPanel } from './room-settings-panel'
import { StreamPanel } from './stream-panel'
import { TaskBoardPanel } from './task-board-panel'
import { TaskQueuePanel } from './task-queue-panel'

// 记录从任务看板进入的面板来源
const TASK_BOARD_CHILD_MODES: SidePanelMode[] = ['stream', 'record-detail', 'task-queue']

// 记录从助手列表进入的面板来源
const AGENTS_CHILD_MODES: SidePanelMode[] = ['agent-detail', 'context', 'history', 'record-detail', 'stream', 'task-queue']

interface ChatSidePanelProps {
  open: boolean
  sidePanelMode: SidePanelMode
  onClose: () => void
  chatRoom: ChatRoom
  selectedRoomAgent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null
  setSelectedRoomAgent: (agent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null) => void
  setSidePanelMode: (mode: SidePanelMode) => void
  setStreamingViewAgent: (agent: { messageId: string; agentId: string; name: string } | null) => void
  streamingViewAgent: { messageId: string; agentId: string; name: string } | null
  streamingMessageStartTime?: number
  completedAgents: Set<string>
  agentStatuses?: Map<string, AgentStatus>
  recordsLoading: boolean
  executionRecords: ExecutionRecord[]
  selectedRecord: ExecutionRecord | null
  setSelectedRecord: (record: ExecutionRecord | null) => void
  selectedReplyMessage: Message | null
  getReplies: (messageId: string) => Message[]
  mentionAgents: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null }[]
  loadExecutionRecords: () => Promise<void>
  contextLoading: boolean
  contextInfo: AgentContextInfo | null
  onChatRoomChange?: () => void
  onDeleteChatRoom?: () => void
  onClearMessages?: () => void
  onStopAgent?: (agentId: string) => void
  executionDetailRecord?: ExecutionRecord | null
  executionDetailLoading?: boolean
  restoreStreamEventsFromRecord?: (agentId: string) => Promise<void>
  isMobile?: boolean
  onInsertMention?: (agentId: string, agentName: string) => void
}

export function ChatSidePanel({
  open,
  sidePanelMode,
  onClose,
  chatRoom,
  selectedRoomAgent,
  setSelectedRoomAgent,
  setSidePanelMode,
  setStreamingViewAgent,
  streamingViewAgent,
  streamingMessageStartTime,
  completedAgents,
  agentStatuses,
  recordsLoading,
  executionRecords,
  selectedRecord,
  setSelectedRecord,
  selectedReplyMessage,
  getReplies,
  mentionAgents,
  loadExecutionRecords,
  contextLoading,
  contextInfo,
  onChatRoomChange,
  onDeleteChatRoom,
  onClearMessages,
  onStopAgent,
  executionDetailRecord,
  executionDetailLoading,
  restoreStreamEventsFromRecord,
  isMobile,
  onInsertMention,
}: ChatSidePanelProps) {
  const { t } = useTranslation()
  // 仅打开流式面板时读取事件，关闭状态不启动轮询。
  const streamEvents = useThrottledStreamEvents(80, open && sidePanelMode === 'stream')
  // 来源保存在 store 中，避免跳转详情页导致组件卸载后丢失返回层级。
  const sidePanelOrigin = useChatStore((s) => s.sidePanelOrigin)
  const setSidePanelOrigin = useChatStore((s) => s.setSidePanelOrigin)
  // 任务看板点详情时，定位主聊天区到对应消息
  const setScrollToMessageId = useChatStore((s) => s.setScrollToMessageId)

  // 当从任务看板或助手列表进入子面板时，记录来源。
  useEffect(() => {
    if (sidePanelMode === 'task-board') {
      setSidePanelOrigin('task-board')
    } else if (sidePanelMode === 'agents') {
      setSidePanelOrigin('agents')
    } else if (sidePanelMode === null) {
      if (sidePanelOrigin) setSidePanelOrigin(null)
    } else if (
      (TASK_BOARD_CHILD_MODES.includes(sidePanelMode) && sidePanelOrigin !== 'task-board') ||
      (AGENTS_CHILD_MODES.includes(sidePanelMode) && sidePanelOrigin !== 'agents')
    ) {
      // 如果进入了子面板但来源不是预期的父面板，清除来源记录
      if (sidePanelOrigin) setSidePanelOrigin(null)
    }
  }, [sidePanelMode, sidePanelOrigin, setSidePanelOrigin])

  // 根据当前面板层级决定关闭行为
  const taskBoardExecutionRecord =
    sidePanelMode === 'execution-detail' && sidePanelOrigin === 'task-board'
      ? selectedRecord
      : null
  const visibleExecutionDetailRecord = taskBoardExecutionRecord ?? executionDetailRecord
  const isExecutionDetailLoading = !taskBoardExecutionRecord && executionDetailLoading

  const findRoomAgent = (agentId?: string | null) => {
    if (!agentId) return null
    return chatRoom.chatRoomAgents?.find(
      (item) => item.agentId === agentId || item.agent?.id === agentId
    )?.agent ?? null
  }

  // 助手详情页保存后会刷新群聊数据；同步当前选中助手，避免侧边栏继续显示旧名称或头像。
  useEffect(() => {
    if (!selectedRoomAgent?.id) return

    const roomAgent = chatRoom.chatRoomAgents?.find(
      (item) => item.agentId === selectedRoomAgent.id || item.agent?.id === selectedRoomAgent.id
    )
    if (!roomAgent?.agent) return

    const nextSelectedAgent = {
      id: roomAgent.agent.id,
      name: roomAgent.agent.name,
      avatar: roomAgent.agent.avatar,
      avatarColor: roomAgent.agent.avatarColor,
      description: roomAgent.agent.description,
      chatRoomAgentId: roomAgent.id,
      agentType: roomAgent.agent.type,
      agentLevel: roomAgent.agent.agentLevel,
      chatRoomId: chatRoom.id,
      injectGroupHistory: roomAgent.injectGroupHistory,
    }

    const hasChanged = Object.entries(nextSelectedAgent).some(([key, value]) => (
      selectedRoomAgent[key as keyof typeof selectedRoomAgent] !== value
    ))
    if (hasChanged) setSelectedRoomAgent(nextSelectedAgent)
  }, [chatRoom.id, chatRoom.chatRoomAgents, selectedRoomAgent?.id, setSelectedRoomAgent])

  // 当打开流式面板时，如果没有流式数据，尝试从 ExecutionRecord 恢复
  // 注意：restoreStreamEventsFromRecord 内部会过滤掉已完成的记录
  useEffect(() => {
    if (sidePanelMode === 'stream' && streamingViewAgent && restoreStreamEventsFromRecord) {
      const streamKey = `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}`
      const hasEvents = streamEvents.has(streamKey)

      // 如果已有流式数据，不需要恢复
      if (hasEvents) return

      // 尝试恢复（内部会检查记录状态，只恢复正在执行的）
      restoreStreamEventsFromRecord(streamingViewAgent.agentId)
    }
  }, [sidePanelMode, streamingViewAgent, streamEvents, restoreStreamEventsFromRecord])

  const getTitle = () => {
    switch (sidePanelMode) {
      case 'stream': return streamingViewAgent?.name ?? t('chat.assistant')
      case 'context': return t('chat.viewContext')
      case 'history': return t('chat.historyExecution')
      case 'record-detail': return t('chat.executionDetails')
      case 'reply-detail': return t('chat.messageReplies')
      case 'agent-detail': return selectedRoomAgent?.name ?? t('chat.assistant')
      case 'room-settings': return t('chat.groupSettings')
      case 'execution-detail': return t('chat.executionDetails')
      case 'cron-tasks': return t('chat.cronTasks')
      case 'task-queue': return t('chat.taskQueue')
      case 'task-board': return t('chat.taskBoardTitle')
      case 'claude-local-sessions': return 'Claude 本地会话'
      case 'codex-local-sessions': return 'Codex 本地会话'
      default: return t('chat.groupAssistants')
    }
  }

  const getIcon = () => {
    if (sidePanelMode === 'room-settings') {
      return <Settings className="size-4 text-muted-foreground" />
    }

    if (sidePanelMode === 'stream') {
      const completedKey = streamingViewAgent ? `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}` : ''
      return streamingViewAgent && completedAgents.has(completedKey) ? (
        <Bot className="size-4 text-green-500" />
      ) : (
        <Bot className="size-4 text-primary" />
      )
    }

    if (sidePanelMode === 'reply-detail') {
      return <MessageSquareMore className="size-4 text-primary" />
    }

    if (sidePanelMode === 'cron-tasks') {
      return <Clock className="size-4 text-orange-500" />
    }

    if (sidePanelMode === 'task-queue') {
      return <List className="size-4 text-blue-500" />
    }

    if (sidePanelMode === 'task-board') {
      return <ClipboardList className="size-4 text-blue-500" />
    }

    if (sidePanelMode === 'claude-local-sessions' || sidePanelMode === 'codex-local-sessions') {
      return <MessagesSquare className="size-4 text-blue-500" />
    }

    if (sidePanelMode === 'execution-detail') {
      if (!executionDetailRecord) {
        return <Info className="size-4 text-purple-500" />
      }

      const recordAgent = findRoomAgent(executionDetailRecord.agentId)
      return (
        <>
          <AgentAvatarImage
            avatar={recordAgent?.avatar ?? null}
            agentId={recordAgent?.id ?? executionDetailRecord.agentId}
            agentName={recordAgent?.name}
            agentLevel={recordAgent?.agentLevel}
            className="size-6"
          />
          <Bot className="size-4 text-primary" />
        </>
      )
    }

    if (sidePanelMode === 'record-detail' && selectedRecord) {
      const recordAgent = findRoomAgent(selectedRecord.agentId)
      return (
        <>
          <AgentAvatarImage
            avatar={recordAgent?.avatar ?? null}
            agentId={recordAgent?.id ?? selectedRecord.agentId}
            agentName={recordAgent?.name}
            agentLevel={recordAgent?.agentLevel}
            className="size-6"
          />
          <Bot className="size-4 text-primary" />
        </>
      )
    }

    if (sidePanelMode === 'context' || sidePanelMode === 'history' || sidePanelMode === 'agent-detail') {
      return (
        <>
          <AgentAvatarImage
            avatar={selectedRoomAgent?.avatar ?? null}
            agentId={selectedRoomAgent?.id}
            agentName={selectedRoomAgent?.name}
            agentLevel={selectedRoomAgent?.agentLevel}
            className="size-6"
          />
          <Bot className="size-4 text-primary" />
        </>
      )
    }

    return <Users className="size-4 text-muted-foreground" />
  }

  const handleSelectAgent = (agent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; agentLevel?: string; chatRoomId?: string; injectGroupHistory?: boolean }) => {
    if (isStreamViewBlocked(agent)) return
    setSelectedRoomAgent(agent)
    setSidePanelMode('agent-detail')
  }

  const handleViewHistory = async () => {
    setSidePanelMode('history')
    await loadExecutionRecords()
  }

  const handleSelectRecord = (record: ExecutionRecord) => {
    setSelectedRecord(record)
    setSidePanelMode('record-detail')
  }

  const handleViewStream = () => {
    if (selectedRoomAgent) {
      // 从 streamEvents 中找到正在执行任务的 messageId
      // streamEvents key 格式: ${messageId}_${agentId}
      const agentId = selectedRoomAgent.id
      let foundMessageId = ''

      // 查找该 agent 正在执行的流式数据（未完成）
      for (const [key] of streamEvents) {
        const [messageId, keyAgentId] = key.split('_')
        if (keyAgentId === agentId && !completedAgents.has(key)) {
          foundMessageId = messageId
          break
        }
      }

      setStreamingViewAgent({ messageId: foundMessageId, agentId: selectedRoomAgent.id, name: selectedRoomAgent.name })
      setSidePanelMode('stream')
    }
  }

  const handleViewTaskQueue = () => {
    setSidePanelMode('task-queue')
  }

  const handleAgentSettingsChange = (settings: { injectGroupHistory: boolean }) => {
    if (selectedRoomAgent) {
      setSelectedRoomAgent({
        ...selectedRoomAgent,
        injectGroupHistory: settings.injectGroupHistory,
      })
    }
    onChatRoomChange?.()
  }

  const handleViewStreamFromTaskQueue = (messageId: string, agentId: string, agentName: string) => {
    setStreamingViewAgent({ messageId, agentId, name: agentName })
    setSidePanelMode('stream')
    // 执行中任务：定位到触发消息
    if (messageId) setScrollToMessageId(messageId)
  }

  const handleViewExecutionRecordFromTaskBoard = async (executionRecordId: string, agentId: string, messageId?: string | null) => {
    const response = await debugApi.getExecutionRecords(chatRoom.id, agentId, 100)
    const record = response.data?.find((item) => item.id === executionRecordId)

    if (!response.success || !record) {
      console.error('[TaskBoard] 执行记录不可用:', response.error || executionRecordId)
      return
    }

    setSidePanelOrigin('task-board')
    setSelectedRecord(record)
    setSidePanelMode('execution-detail')

    // 已完成/失败任务：定位到该执行记录产生的首条消息
    if (messageId) setScrollToMessageId(messageId)
  }

  const handleViewTaskQueueFromTaskBoard = (agentId: string, messageId?: string | null) => {
    const roomAgent = chatRoom.chatRoomAgents?.find(
      (item) => item.agentId === agentId || item.agent?.id === agentId
    )

    if (!roomAgent?.agent) {
      console.error('[TaskBoard] 助手不可用:', agentId)
      return
    }

    setSelectedRoomAgent({
      id: roomAgent.agent.id,
      name: roomAgent.agent.name,
      avatar: roomAgent.agent.avatar,
      avatarColor: roomAgent.agent.avatarColor,
      description: roomAgent.agent.description,
      chatRoomAgentId: roomAgent.id,
      agentType: roomAgent.agent.type,
      agentLevel: roomAgent.agent.agentLevel,
      chatRoomId: chatRoom.id,
      injectGroupHistory: roomAgent.injectGroupHistory,
    })
    setSidePanelMode('task-queue')
    // 待执行/可恢复任务：定位到触发消息
    if (messageId) setScrollToMessageId(messageId)
  }

  // 根据当前面板层级决定关闭行为
  // 子面板点击 X 返回上一级，顶层面板点击 X 关闭侧拉
  const handleClose = () => {
    // 任务看板中打开的执行详情，点击 X 直接关闭，避免落回历史执行结果
    if (sidePanelMode === 'execution-detail' && sidePanelOrigin === 'task-board') {
      setSidePanelOrigin(null)
      setSelectedRecord(null)
      setSidePanelMode(null)
      return
    }

    // 从任务看板进入的子面板，返回任务看板
    if (TASK_BOARD_CHILD_MODES.includes(sidePanelMode) && sidePanelOrigin === 'task-board') {
      setSidePanelOrigin('task-board') // 保持来源，允许继续返回
      setSidePanelMode('task-board')
      return
    }

    // 从助手列表进入的子面板，返回助手列表
    if (AGENTS_CHILD_MODES.includes(sidePanelMode) && sidePanelOrigin === 'agents') {
      // agent-detail 直接返回 agents
      if (sidePanelMode === 'agent-detail') {
        setSidePanelOrigin(null)
        setSidePanelMode('agents')
        return
      }
      // 其他子面板（context/history/stream 等）返回 agent-detail
      setSidePanelOrigin('agents') // 保持来源标记
      setSidePanelMode('agent-detail')
      return
    }

    // 从助手详情进入的任务队列，返回助手详情（非任务看板来源）
    if (sidePanelMode === 'task-queue' && sidePanelOrigin !== 'task-board') {
      setSidePanelMode('agent-detail')
      return
    }

    // 其他情况关闭面板
    onClose()
  }

  return (
    <SidePanel
      open={open}
      onClose={handleClose}
      title={getTitle()}
      icon={getIcon()}
      isMobile={isMobile}
      className={cn(
        sidePanelMode === 'context' || sidePanelMode === 'history' || sidePanelMode === 'record-detail' || sidePanelMode === 'reply-detail' || sidePanelMode === 'execution-detail'
          ? 'pt-4 pb-4 pl-4 pr-3'
          : sidePanelMode === 'task-board'
            ? 'p-3'
            : sidePanelMode === 'stream'
              ? 'p-0'
              : 'pt-3 pb-3 pl-3 pr-3'
      )}
      overflow={sidePanelMode === 'room-settings' || sidePanelMode === 'task-board' || sidePanelMode === 'stream' || sidePanelMode === 'claude-local-sessions' || sidePanelMode === 'codex-local-sessions' ? 'hidden' : 'auto'}
      widthClass={sidePanelMode === 'task-board' ? 'w-full border-l-0' : undefined}
      resizable={sidePanelMode !== 'task-board'}
      defaultWidth={370}
      minWidth={320}
      maxWidth={760}
      storageKey="teamagentx.chatSidePanel.width"
    >
      {sidePanelMode === 'agents' && (
        <AgentsPanel
          chatRoom={chatRoom}
          agentStatuses={agentStatuses}
          onSelectAgent={handleSelectAgent}
          onAgentSettingsChange={onChatRoomChange}
          onInsertMention={onInsertMention}
        />
      )}

      {sidePanelMode === 'agent-detail' && (
        <AgentDetailPanel
          chatRoomId={chatRoom.id}
          selectedRoomAgent={selectedRoomAgent}
          agentStatus={selectedRoomAgent ? agentStatuses?.get(selectedRoomAgent.id) : undefined}
          hasExecutionRecords={executionRecords.length > 0}
          onViewHistory={handleViewHistory}
          onViewStream={handleViewStream}
          onViewTaskQueue={handleViewTaskQueue}
          onAgentSettingsChange={handleAgentSettingsChange}
        />
      )}

      {sidePanelMode === 'context' && (
        <ContextPanel
          contextLoading={contextLoading}
          contextInfo={contextInfo}
        />
      )}

      {sidePanelMode === 'history' && (
        <HistoryPanel
          recordsLoading={recordsLoading}
          executionRecords={executionRecords}
          onSelectRecord={handleSelectRecord}
        />
      )}

      {sidePanelMode === 'record-detail' && selectedRecord && (
        <RecordDetailPanel
          selectedRecord={selectedRecord}
        />
      )}

      {sidePanelMode === 'reply-detail' && selectedReplyMessage && (
        <ReplyDetailPanel
          selectedReplyMessage={selectedReplyMessage}
          replies={getReplies(selectedReplyMessage.id)}
          mentionAgents={mentionAgents}
        />
      )}

      {sidePanelMode === 'execution-detail' && isExecutionDetailLoading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          <span>{t('chat.loadingExecutionDetail')}</span>
        </div>
      )}

      {sidePanelMode === 'execution-detail' && visibleExecutionDetailRecord && !isExecutionDetailLoading && (
        <RecordDetailPanel
          selectedRecord={visibleExecutionDetailRecord}
        />
      )}

      {sidePanelMode === 'execution-detail' && !visibleExecutionDetailRecord && !isExecutionDetailLoading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <span>{t('chat.executionDetailUnavailable')}</span>
        </div>
      )}

      {open && sidePanelMode === 'stream' && (
        <StreamPanel
          streamingViewAgent={streamingViewAgent}
          messageStartTime={streamingMessageStartTime}
          completedAgents={completedAgents}
          streamEvents={streamEvents}
          chatRoomId={chatRoom.id}
          onStop={onStopAgent}
        />
      )}

      {sidePanelMode === 'cron-tasks' && (
        <CronTasksPanel
          chatRoomId={chatRoom.id}
          chatRoomName={chatRoom.name}
          chatRoomAgents={chatRoom.chatRoomAgents || []}
        />
      )}

      {sidePanelMode === 'task-queue' && selectedRoomAgent && (
        <TaskQueuePanel
          chatRoomId={chatRoom.id}
          agentId={selectedRoomAgent.id}
          agentStatus={selectedRoomAgent ? agentStatuses?.get(selectedRoomAgent.id) : undefined}
          onViewStream={handleViewStreamFromTaskQueue}
        />
      )}

      {sidePanelMode === 'task-board' && (
        <TaskBoardPanel
          chatRoom={chatRoom}
          onViewStream={handleViewStreamFromTaskQueue}
          onViewExecutionRecord={handleViewExecutionRecordFromTaskBoard}
          onViewTaskQueue={handleViewTaskQueueFromTaskBoard}
        />
      )}

      {(sidePanelMode === 'claude-local-sessions' || sidePanelMode === 'codex-local-sessions') && (
        <ClaudeLocalSessionsPanel
          chatRoomId={chatRoom.id}
          tool={sidePanelMode === 'codex-local-sessions' ? 'codex' : 'claude'}
          onSwitched={() => {
            onChatRoomChange?.()
            // 切换完成后自动隐藏面板
            setSidePanelMode(null)
          }}
        />
      )}

      {sidePanelMode === 'room-settings' && (
        <RoomSettingsPanel
          chatRoom={chatRoom}
          onChatRoomChange={onChatRoomChange ?? (() => {})}
          onDeleteChatRoom={onDeleteChatRoom ?? (() => {})}
          onClearMessages={onClearMessages ?? (() => {})}
        />
      )}
    </SidePanel>
  )
}
