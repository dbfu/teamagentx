import { SidePanel } from '@/components/ui/side-panel'
import { AgentContextInfo, ChatRoom, debugApi, ExecutionRecord, Message } from '@/lib/agent-api'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { cn } from '@/lib/utils'
import type { SidePanelMode } from '@/stores/chat-store'
import type { AgentStatus, StreamEvent } from '@/stores/socket-store'
import { Bot, ClipboardList, Clock, Info, List, Loader2, MessageSquareMore, Settings, Users } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AgentDetailPanel } from './agent-detail-panel'
import { AgentsPanel } from './agents-panel'
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
  selectedRoomAgent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null
  setSelectedRoomAgent: (agent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; chatRoomId?: string; injectGroupHistory?: boolean } | null) => void
  setSidePanelMode: (mode: SidePanelMode) => void
  setStreamingViewAgent: (agent: { messageId: string; agentId: string; name: string } | null) => void
  streamingViewAgent: { messageId: string; agentId: string; name: string } | null
  completedAgents: Set<string>
  streamEvents: Map<string, StreamEvent[]>
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
  completedAgents,
  streamEvents,
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
  // 记录面板来源，用于返回上一级
  const previousModeRef = useRef<SidePanelMode | null>(null)

  // 当从任务看板或助手列表进入子面板时，记录来源
  useEffect(() => {
    if (sidePanelMode === 'task-board') {
      previousModeRef.current = 'task-board'
    } else if (sidePanelMode === 'agents') {
      previousModeRef.current = 'agents'
    } else if (
      (TASK_BOARD_CHILD_MODES.includes(sidePanelMode) && previousModeRef.current !== 'task-board') ||
      (AGENTS_CHILD_MODES.includes(sidePanelMode) && previousModeRef.current !== 'agents')
    ) {
      // 如果进入了子面板但来源不是预期的父面板，清除来源记录
      previousModeRef.current = null
    }
  }, [sidePanelMode])

  // 根据当前面板层级决定关闭行为
  const taskBoardExecutionRecord =
    sidePanelMode === 'execution-detail' && previousModeRef.current === 'task-board'
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
      case 'stream': return streamingViewAgent?.name ?? '助手'
      case 'context': return '查看上下文'
      case 'history': return '历史执行结果'
      case 'record-detail': return '执行详情'
      case 'reply-detail': return '消息回复'
      case 'agent-detail': return selectedRoomAgent?.name ?? '助手'
      case 'room-settings': return '群设置'
      case 'execution-detail': return '执行详情'
      case 'cron-tasks': return '定时任务'
      case 'task-queue': return '任务队列'
      case 'task-board': return '任务看板'
      default: return '群助手'
    }
  }

  const getIcon = () => {
    if (sidePanelMode === 'room-settings') {
      return <Settings className="size-4 text-muted-foreground" />
    }

    if (sidePanelMode === 'stream') {
      const completedKey = streamingViewAgent ? `${streamingViewAgent.messageId}_${streamingViewAgent.agentId}` : ''
      return streamingViewAgent && completedAgents.has(completedKey) ? (
        <>
          <Bot className="size-4 text-green-500" />
        </>
      ) : (
        <>
          <Bot className="size-4 text-primary" />
          <Loader2 className="size-3 animate-spin text-primary/80" />
        </>
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

    if (sidePanelMode === 'execution-detail') {
      if (!executionDetailRecord) {
        return <Info className="size-4 text-purple-500" />
      }

      const recordAgent = findRoomAgent(executionDetailRecord.agentId)
      return (
        <>
          <AgentAvatarImage avatar={recordAgent?.avatar ?? null} className="size-6" />
          <Bot className="size-4 text-primary" />
        </>
      )
    }

    if (sidePanelMode === 'record-detail' && selectedRecord) {
      const recordAgent = findRoomAgent(selectedRecord.agentId)
      return (
        <>
          <AgentAvatarImage avatar={recordAgent?.avatar ?? null} className="size-6" />
          <Bot className="size-4 text-primary" />
        </>
      )
    }

    if (sidePanelMode === 'context' || sidePanelMode === 'history' || sidePanelMode === 'agent-detail') {
      return (
        <>
          <AgentAvatarImage avatar={selectedRoomAgent?.avatar ?? null} className="size-6" />
          <Bot className="size-4 text-primary" />
        </>
      )
    }

    return <Users className="size-4 text-muted-foreground" />
  }

  const handleSelectAgent = (agent: { id: string; name: string; avatar?: string | null; avatarColor?: string | null; description?: string | null; chatRoomAgentId?: string; agentType?: string; chatRoomId?: string; injectGroupHistory?: boolean }) => {
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

  const handleViewStreamFromTaskQueue = (messageId: string, agentId: string, agentName: string) => {
    setStreamingViewAgent({ messageId, agentId, name: agentName })
    setSidePanelMode('stream')
  }

  const handleViewExecutionRecordFromTaskBoard = async (executionRecordId: string, agentId: string) => {
    const response = await debugApi.getExecutionRecords(chatRoom.id, agentId, 100)
    const record = response.data?.find((item) => item.id === executionRecordId)

    if (!response.success || !record) {
      console.error('[TaskBoard] 执行记录不可用:', response.error || executionRecordId)
      return
    }

    previousModeRef.current = 'task-board'
    setSelectedRecord(record)
    setSidePanelMode('execution-detail')
  }

  const handleViewTaskQueueFromTaskBoard = (agentId: string) => {
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
      chatRoomId: chatRoom.id,
      injectGroupHistory: roomAgent.injectGroupHistory,
    })
    setSidePanelMode('task-queue')
  }

  // 根据当前面板层级决定关闭行为
  // 子面板点击 X 返回上一级，顶层面板点击 X 关闭侧拉
  const handleClose = () => {
    // 任务看板中打开的执行详情，点击 X 直接关闭，避免落回历史执行结果
    if (sidePanelMode === 'execution-detail' && previousModeRef.current === 'task-board') {
      previousModeRef.current = null
      setSelectedRecord(null)
      setSidePanelMode(null)
      return
    }

    // 从任务看板进入的子面板，返回任务看板
    if (TASK_BOARD_CHILD_MODES.includes(sidePanelMode) && previousModeRef.current === 'task-board') {
      previousModeRef.current = 'task-board' // 保持来源，允许继续返回
      setSidePanelMode('task-board')
      return
    }

    // 从助手列表进入的子面板，返回助手列表
    if (AGENTS_CHILD_MODES.includes(sidePanelMode) && previousModeRef.current === 'agents') {
      // agent-detail 直接返回 agents
      if (sidePanelMode === 'agent-detail') {
        previousModeRef.current = null
        setSidePanelMode('agents')
        return
      }
      // 其他子面板（context/history/stream 等）返回 agent-detail
      previousModeRef.current = 'agents' // 保持来源标记
      setSidePanelMode('agent-detail')
      return
    }

    // 从助手详情进入的任务队列，返回助手详情（非任务看板来源）
    if (sidePanelMode === 'task-queue' && previousModeRef.current !== 'task-board') {
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
      overflow={sidePanelMode === 'room-settings' || sidePanelMode === 'task-board' ? 'hidden' : 'auto'}
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
          setSelectedRoomAgent={setSelectedRoomAgent}
          agentStatus={selectedRoomAgent ? agentStatuses?.get(selectedRoomAgent.id) : undefined}
          hasExecutionRecords={executionRecords.length > 0}
          onViewHistory={handleViewHistory}
          onViewStream={handleViewStream}
          onViewTaskQueue={handleViewTaskQueue}
          onAgentSettingsChange={onChatRoomChange}
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
          <span>加载执行详情...</span>
        </div>
      )}

      {sidePanelMode === 'execution-detail' && visibleExecutionDetailRecord && !isExecutionDetailLoading && (
        <RecordDetailPanel
          selectedRecord={visibleExecutionDetailRecord}
        />
      )}

      {sidePanelMode === 'execution-detail' && !visibleExecutionDetailRecord && !isExecutionDetailLoading && (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <span>执行详情不可用</span>
        </div>
      )}

      {sidePanelMode === 'stream' && (
        <StreamPanel
          streamingViewAgent={streamingViewAgent}
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
