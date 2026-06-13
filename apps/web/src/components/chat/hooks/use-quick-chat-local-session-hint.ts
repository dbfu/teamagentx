import { useEffect } from 'react'
import { toast } from 'sonner'
import { agentApi, type ChatRoom } from '@/lib/agent-api'
import { useChatStore } from '@/stores/chat-store'

type LocalSessionTool = 'claude' | 'codex'

const TOOL_LABELS: Record<LocalSessionTool, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

function hintStorageKey(chatRoomId: string): string {
  return `quickchat-local-session-hint:${chatRoomId}`
}

interface UseQuickChatLocalSessionHintParams {
  chatRoom?: ChatRoom
  /** 当前群聊是否没有任何消息（用于判断是否为刚创建的空白快速对话） */
  messagesEmpty: boolean
  /** 消息是否仍在加载，加载完成后再检测 */
  loading: boolean
  onShowSessions: (tool: LocalSessionTool) => void
}

/**
 * 首次进入快速对话群聊时，检测当前工作目录是否存在对应工具（Claude / Codex）的本地会话记录，
 * 若有则提示用户并打开会话列表面板。每个群聊仅提示一次（localStorage 标记）。
 */
export function useQuickChatLocalSessionHint({
  chatRoom,
  messagesEmpty,
  loading,
  onShowSessions,
}: UseQuickChatLocalSessionHintParams) {
  const allAgents = useChatStore((state) => state.allAgents)

  useEffect(() => {
    if (!chatRoom?.isQuickChatRoom || !chatRoom.quickChatAgentId) return
    // 仅在加载完成且为空白新建会话时检测
    if (loading || !messagesEmpty) return

    const roomAgent = chatRoom.chatRoomAgents?.find(
      (member) => member.agentId === chatRoom.quickChatAgentId,
    )?.agent
    const agent = roomAgent?.acpTool
      ? roomAgent
      : allAgents.find((item) => item.id === chatRoom.quickChatAgentId)

    let tool: LocalSessionTool | null = null
    if (agent?.type === 'acp' && (agent.acpTool === 'claude' || agent.acpTool === 'codex')) {
      tool = agent.acpTool
    } else if (chatRoom.name.trim().toLowerCase() === 'claude') {
      tool = 'claude'
    } else if (chatRoom.name.trim().toLowerCase() === 'codex') {
      tool = 'codex'
    }
    if (!tool) return

    const storageKey = hintStorageKey(chatRoom.id)
    if (localStorage.getItem(storageKey)) return

    const chatRoomId = chatRoom.id
    const activeTool = tool
    let cancelled = false

    void (async () => {
      try {
        const response = activeTool === 'codex'
          ? await agentApi.listLocalCodexSessions(chatRoomId)
          : await agentApi.listLocalClaudeSessions(chatRoomId)
        if (cancelled) return
        // 检测成功后标记，避免重复请求与提示
        localStorage.setItem(storageKey, '1')
        if (!response.success || !response.data) return
        // 已绑定过本地会话则不再打扰
        if (response.data.currentSessionId) return
        const count = response.data.sessions.length
        if (count <= 0) return

        toast.info(
          `检测到当前项目有 ${count} 个 ${TOOL_LABELS[activeTool]} 历史会话，可在此选择导入`,
        )
        onShowSessions(activeTool)
      } catch {
        // 检测失败静默处理，下次进入可重试
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    chatRoom?.id,
    chatRoom?.isQuickChatRoom,
    chatRoom?.quickChatAgentId,
    chatRoom?.name,
    chatRoom?.chatRoomAgents,
    loading,
    messagesEmpty,
    allAgents,
    onShowSessions,
  ])
}
