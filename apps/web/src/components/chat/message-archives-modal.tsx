import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, History, Loader2, MessageSquare } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChatMessagesList } from './chat-messages-list'
import { ChatRoom, ChatRoomMessageArchive, Message, messageApi } from '@/lib/agent-api'
import { cn, formatDateTime } from '@/lib/utils'

interface MessageArchivesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatRoom: ChatRoom
  currentUser?: {
    username: string
    avatar?: string | null
    avatarColor?: string | null
  } | null
}

function formatArchiveRange(archive: ChatRoomMessageArchive) {
  if (!archive.startedAt && !archive.endedAt) return formatDateTime(archive.archivedAt)
  if (!archive.startedAt || archive.startedAt === archive.endedAt) {
    const timestamp = archive.endedAt ?? archive.startedAt ?? archive.archivedAt
    return formatDateTime(timestamp)
  }
  const startedAt = archive.startedAt
  const endedAt = archive.endedAt ?? archive.archivedAt
  return `${formatDateTime(startedAt)} - ${formatDateTime(endedAt)}`
}

export function MessageArchivesModal({
  open,
  onOpenChange,
  chatRoom,
  currentUser,
}: MessageArchivesModalProps) {
  const [archives, setArchives] = useState<ChatRoomMessageArchive[]>([])
  const [selectedArchive, setSelectedArchive] = useState<ChatRoomMessageArchive | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingArchives, setLoadingArchives] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const emptyTypingAgents = useMemo(() => new Map<string, []>(), [])
  const mentionAgents = useMemo(() => (
    chatRoom.chatRoomAgents
      ?.filter((roomAgent) => roomAgent.agent)
      .map((roomAgent) => ({
        id: roomAgent.agent!.id,
        name: roomAgent.agent!.name,
        avatar: roomAgent.agent!.avatar,
        avatarColor: roomAgent.agent!.avatarColor,
        description: roomAgent.agent!.description,
      })) ?? []
  ), [chatRoom.chatRoomAgents])

  const loadArchives = useCallback(async () => {
    setLoadingArchives(true)
    try {
      const response = await messageApi.getArchives(chatRoom.id)
      if (response.success && response.data) {
        setArchives(response.data)
      }
    } catch (error) {
      console.error('Failed to load message archives:', error)
    } finally {
      setLoadingArchives(false)
    }
  }, [chatRoom.id])

  const loadArchiveMessages = useCallback(async (archive: ChatRoomMessageArchive) => {
    setSelectedArchive(archive)
    setMessages([])
    setHasOlderMessages(false)
    setLoadingMessages(true)
    try {
      const response = await messageApi.getArchiveMessages(archive.id)
      if (response.success && response.data) {
        setMessages(response.data)
        setHasOlderMessages(response.pagination?.hasMore ?? false)
      }
    } catch (error) {
      console.error('Failed to load archived messages:', error)
    } finally {
      setLoadingMessages(false)
    }
  }, [])

  const loadOlderMessages = useCallback(async () => {
    if (!selectedArchive || loadingOlderMessages || messages.length === 0 || !hasOlderMessages) return
    setLoadingOlderMessages(true)
    try {
      const response = await messageApi.getArchiveMessages(selectedArchive.id, {
        beforeMessageId: messages[0].id,
      })
      if (response.success && response.data) {
        const olderMessages = response.data
        setMessages((current) => [...olderMessages, ...current])
        setHasOlderMessages(response.pagination?.hasMore ?? false)
      }
    } catch (error) {
      console.error('Failed to load older archived messages:', error)
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [hasOlderMessages, loadingOlderMessages, messages, selectedArchive])

  useEffect(() => {
    if (!open) {
      setSelectedArchive(null)
      setMessages([])
      setHasOlderMessages(false)
      return
    }
    void loadArchives()
  }, [loadArchives, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[82vh] max-h-[760px] !w-[70vw] !max-w-[70vw] flex-col overflow-hidden p-0 max-md:!w-[calc(100vw-16px)] max-md:!max-w-[calc(100vw-16px)]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            {selectedArchive && (
              <button
                type="button"
                onClick={() => {
                  setSelectedArchive(null)
                  setMessages([])
                  setHasOlderMessages(false)
                }}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeft className="size-4" />
              </button>
            )}
            <History className="size-4 text-blue-500" />
            {selectedArchive ? selectedArchive.title : `${chatRoom.name} 的历史记录`}
          </DialogTitle>
        </DialogHeader>

        {!selectedArchive ? (
          <div className="flex-1 overflow-y-auto p-4">
            {loadingArchives ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                正在加载历史记录
              </div>
            ) : archives.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <History className="mb-3 size-10 opacity-40" />
                <div className="text-sm">暂无历史记录</div>
              </div>
            ) : (
              <div className="grid gap-2">
                {archives.map((archive) => (
                  <button
                    key={archive.id}
                    type="button"
                    onClick={() => void loadArchiveMessages(archive)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left transition-colors',
                      'hover:border-blue-200 hover:bg-blue-50/60 dark:border-border dark:hover:bg-blue-950/20'
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-500 dark:bg-blue-950/30">
                      <MessageSquare className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{archive.title}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatArchiveRange(archive)}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {archive.messageCount} 条
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
              只读归档 · {formatArchiveRange(selectedArchive)} · {selectedArchive.messageCount} 条消息
            </div>
            <ChatMessagesList
              chatRoomId={chatRoom.id}
              messages={messages}
              loading={loadingMessages}
              loadingOlderMessages={loadingOlderMessages}
              hasOlderMessages={hasOlderMessages}
              messagesEndRef={messagesEndRef}
              typingAgents={emptyTypingAgents}
              mentionAgents={mentionAgents}
              onAgentAvatarClick={() => {}}
              onTypingAgentClick={() => {}}
              onMentionClick={() => {}}
              onReplyClick={() => {}}
              onMentionAgent={() => {}}
              onLoadOlderMessages={loadOlderMessages}
              currentUser={currentUser}
              readOnly
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
