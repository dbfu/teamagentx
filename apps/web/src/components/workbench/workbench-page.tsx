import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatRoom } from '@/lib/agent-api'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { workbenchApi, type WorkbenchTask, type WorkbenchTaskStatus } from '@/lib/workbench-api'
import { cn } from '@/lib/utils'
import { useChatRoomStore, useSocketStore } from '@/stores'
import { statusMeta, TaskStatusSelect } from './task-status-select'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LayoutDashboard,
  ListTodo,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

const columnKeys = ['columnDraft', 'columnInProgress', 'columnWaitingReview', 'columnCompleted', 'columnNeedsInput'] as const

function formatTime(value: string | null | undefined, noActivityText: string) {
  if (!value) return noActivityText
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getRoomOptions(chatRooms: ChatRoom[]) {
  return chatRooms.filter((room) => !room.isQuickChatRoom)
}

function RoomSelectDisplay({ room }: { room: Pick<ChatRoom, 'avatar' | 'name'> }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <GroupAvatarImage avatar={room.avatar ?? null} alt={room.name} className="size-6 rounded-full" />
      <span className="truncate">{room.name}</span>
    </span>
  )
}

function TaskStatusBadge({ status, t }: { status: WorkbenchTaskStatus; t: (key: string) => string }) {
  const meta = statusMeta[status]
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', meta.tone)}>
      {t(`workbench.${meta.labelKey}`)}
    </span>
  )
}


function TaskRow({
  task,
  rooms,
  onDispatch,
  onDelete,
  onStatusChange,
  onOpenRoom,
  busy,
  t,
}: {
  task: WorkbenchTask
  rooms: ChatRoom[]
  onDispatch: (task: WorkbenchTask) => void
  onDelete: (task: WorkbenchTask) => void
  onStatusChange: (task: WorkbenchTask, status: WorkbenchTaskStatus) => void
  onOpenRoom: (task: WorkbenchTask) => void
  busy: boolean
  t: (key: string) => string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold text-foreground">{task.title}</h3>
            <TaskStatusBadge status={task.status} t={t} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {(() => {
              const matchedRoom = rooms.find((room) => room.id === task.chatRoomId)
              const roomName = task.chatRoom?.name ?? matchedRoom?.name ?? t('workbench.noMatchingGroup')
              const roomAvatar = task.chatRoom?.avatar ?? matchedRoom?.avatar ?? null
              return (
                <span className="inline-flex items-center gap-1.5">
                  <GroupAvatarImage avatar={roomAvatar} alt={roomName} className="size-4 rounded-full" />
                  {roomName}
                </span>
              )
            })()}
            <span>{t('workbench.latestTime')}{formatTime(task.lastActivityAt || task.updatedAt, t('workbench.noActivity'))}</span>
          </div>
          {(task.expectedOutput || task.description) && (
            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
              {task.expectedOutput ? `${t('workbench.outputLabel')}${task.expectedOutput}` : task.description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TaskStatusSelect
            value={task.status}
            onChange={(status) => onStatusChange(task, status)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => onOpenRoom(task)}
          >
            <ArrowRight className="size-4" />
            {t('workbench.enterGroup')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || task.status !== 'draft'}
            className="h-9 gap-1.5 bg-blue-500 hover:bg-blue-600"
            onClick={() => onDispatch(task)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t('workbench.dispatch')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
            onClick={() => onDelete(task)}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export function WorkbenchPage() {
  const { t } = useTranslation()
  const isElectron = window.electronAPI?.isElectron ?? false
  const navigate = useNavigate()
  const chatRooms = useChatRoomStore((s) => s.chatRooms)
  const loadChatRooms = useChatRoomStore((s) => s.loadChatRooms)
  const [tasks, setTasks] = useState<WorkbenchTask[]>([])
  const [view, setView] = useState<'list' | 'screen'>('list')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recommendingRoom, setRecommendingRoom] = useState(false)
  const [roomSelectOpen, setRoomSelectOpen] = useState(false)
  const [dispatchingIds, setDispatchingIds] = useState<Set<string>>(new Set())
  const roomOptions = useMemo(() => getRoomOptions(chatRooms), [chatRooms])
  const [form, setForm] = useState({
    title: '',
    chatRoomId: '',
    expectedOutput: '',
    description: '',
    note: '',
  })

  const columns = useMemo(() => columnKeys.map((key) => t(`workbench.${key}`)), [t])

  const refreshTasks = async () => {
    setLoading(true)
    try {
      const response = await workbenchApi.getToday()
      if (response.success && response.data) {
        setTasks(response.data)
      } else {
        toast.error(response.error || t('workbench.loadTasksFailed'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadChatRooms()
    refreshTasks()
  }, [loadChatRooms])

  // 订阅工作台任务状态实时更新（agent 执行进度自动推进派发任务状态）
  const socket = useSocketStore((s) => s.socket)
  useEffect(() => {
    if (!socket) return
    const handleTaskUpdated = (task: WorkbenchTask) => {
      setTasks((current) =>
        current.some((item) => item.id === task.id)
          ? current.map((item) => (item.id === task.id ? task : item))
          : current,
      )
    }
    socket.on('workbench:task-updated', handleTaskUpdated)
    return () => {
      socket.off('workbench:task-updated', handleTaskUpdated)
    }
  }, [socket])

  const selectedRoom = roomOptions.find((room) => room.id === form.chatRoomId) ?? null

  const stats = useMemo(() => {
    const total = tasks.length
    const completed = tasks.filter((task) => task.status === 'completed').length
    const waiting = tasks.filter((task) => task.status === 'waiting_review').length
    const blocked = tasks.filter((task) => task.status === 'needs_input').length
    const running = tasks.filter((task) => task.status === 'dispatched' || task.status === 'in_progress').length
    return { total, completed, running, waiting, blocked }
  }, [tasks])

  const tasksByColumn = useMemo(() => {
    return columns.reduce<Record<string, WorkbenchTask[]>>((acc, column) => {
      acc[column] = tasks.filter((task) => t(`workbench.${statusMeta[task.status].columnKey}`) === column)
      return acc
    }, {})
  }, [tasks, t, columns])

  const draftTasks = tasks.filter((task) => task.status === 'draft')

  const handleRecommendRoom = async () => {
    if (roomOptions.length === 0) {
      toast.error(t('workbench.noGroupsToRecommend'))
      return
    }

    if (![form.title, form.expectedOutput, form.description, form.note].some((value) => value.trim())) {
      toast.error(t('workbench.fillTaskFirst'))
      return
    }

    setRecommendingRoom(true)
    try {
      const response = await workbenchApi.recommendRoom({
        title: form.title,
        expectedOutput: form.expectedOutput || null,
        description: form.description || null,
        note: form.note || null,
      })

      if (!response.success || !response.data) {
        toast.error(response.error || t('workbench.recommendGroupFailed'))
        return
      }

      if (!response.data.chatRoomId) {
        toast.error(response.data.reason || t('workbench.noMatchingGroup'))
        return
      }

      const recommendedRoom = roomOptions.find((room) => room.id === response.data?.chatRoomId)
      setForm((current) => ({ ...current, chatRoomId: response.data!.chatRoomId! }))
      toast.success(t('workbench.groupRecommended', { name: recommendedRoom?.name ?? t('workbench.targetGroup') }), {
        description: response.data.reason,
      })
    } finally {
      setRecommendingRoom(false)
    }
  }

  const handleCreateTask = async () => {
    if (!form.title.trim()) {
      toast.error(t('workbench.taskContentRequired'))
      return
    }
    if (!form.chatRoomId) {
      toast.error(t('workbench.selectTargetGroup'))
      return
    }

    setSaving(true)
    try {
      const response = await workbenchApi.create({
        title: form.title,
        chatRoomId: form.chatRoomId,
        expectedOutput: form.expectedOutput || null,
        description: form.description || null,
        note: form.note || null,
      })
      if (response.success && response.data) {
        setTasks((current) => [...current, response.data!])
        setForm((current) => ({
          ...current,
          title: '',
          chatRoomId: '',
          expectedOutput: '',
          description: '',
          note: '',
        }))
      } else {
        toast.error(response.error || t('workbench.createTaskFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  const replaceTask = (nextTask: WorkbenchTask) => {
    setTasks((current) => current.map((task) => task.id === nextTask.id ? nextTask : task))
  }

  const handleDispatch = async (task: WorkbenchTask) => {
    setDispatchingIds((current) => new Set(current).add(task.id))
    try {
      const response = await workbenchApi.dispatch(task.id)
      if (response.success && response.data) {
        replaceTask(response.data)
        toast.success(t('workbench.dispatchSuccess', { name: response.data.chatRoom.name }))
      } else {
        toast.error(response.error || t('workbench.dispatchFailed'))
      }
    } finally {
      setDispatchingIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  const handleDispatchAll = async () => {
    if (draftTasks.length === 0) return
    const ids = draftTasks.map((task) => task.id)
    setDispatchingIds(new Set(ids))
    try {
      const response = await workbenchApi.dispatchBatch(ids)
      if (response.success && response.data) {
        setTasks((current) => {
          const byId = new Map(response.data!.map((task) => [task.id, task]))
          return current.map((task) => byId.get(task.id) ?? task)
        })
        toast.success(t('workbench.dispatchCountSuccess', { count: response.data.length }))
      } else {
        toast.error(response.error || t('workbench.batchDispatchFailed'))
      }
    } finally {
      setDispatchingIds(new Set())
    }
  }

  const handleDelete = async (task: WorkbenchTask) => {
    const response = await workbenchApi.delete(task.id)
    if (response.success) {
      setTasks((current) => current.filter((item) => item.id !== task.id))
    } else {
      toast.error(response.error || t('workbench.deleteTaskFailed'))
    }
  }

  const handleStatusChange = async (task: WorkbenchTask, status: WorkbenchTaskStatus) => {
    const response = await workbenchApi.update(task.id, { status })
    if (response.success && response.data) {
      replaceTask(response.data)
    } else {
      toast.error(response.error || t('workbench.updateStatusFailed'))
    }
  }

  const handleOpenRoom = (task: WorkbenchTask) => {
    const msg = task.dispatchMessageId ? `&msg=${task.dispatchMessageId}` : ''
    navigate(`/?room=${task.chatRoomId}${msg}`)
  }

  const statCards = useMemo(() => [
    { label: t('workbench.statusRunning'), value: stats.running, icon: Clock3, bg: 'bg-cyan-100 dark:bg-cyan-900', icon_color: 'text-cyan-600 dark:text-cyan-400' },
    { label: t('workbench.statusWaiting'), value: stats.waiting, icon: AlertCircle, bg: 'bg-amber-100 dark:bg-amber-900', icon_color: 'text-amber-600 dark:text-amber-400' },
    { label: t('workbench.statusCompleted'), value: stats.completed, icon: CheckCircle2, bg: 'bg-emerald-100 dark:bg-emerald-900', icon_color: 'text-emerald-600 dark:text-emerald-400' },
    { label: t('workbench.statusBlocked'), value: stats.blocked, icon: AlertCircle, bg: 'bg-orange-100 dark:bg-orange-900', icon_color: 'text-orange-600 dark:text-orange-400' },
  ], [stats, t])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted">
      <div
        className="flex h-[52px] shrink-0 items-center border-b border-border bg-background px-4"
        style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
      >
        <div
          className="flex flex-1 items-center gap-2"
          style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <LayoutDashboard className="size-4 text-primary" />
          <h1 className="text-base font-semibold">{t('workbench.title')}</h1>
        </div>
        <div
          className="flex rounded-md border border-border bg-muted p-0.5"
          style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
        >
          <button
            className={cn('flex h-7 items-center gap-1 rounded px-2.5 text-xs', view === 'list' ? 'bg-background text-blue-600 shadow-sm' : 'text-muted-foreground')}
            onClick={() => setView('list')}
          >
            <ListTodo className="size-3.5" />
            {t('workbench.todayList')}
          </button>
          <button
            className={cn('flex h-7 items-center gap-1 rounded px-2.5 text-xs', view === 'screen' ? 'bg-background text-blue-600 shadow-sm' : 'text-muted-foreground')}
            onClick={() => setView('screen')}
          >
            <BarChart3 className="size-3.5" />
            {t('workbench.taskBoard')}
          </button>
        </div>
        <div
          className="flex flex-1 items-center justify-end gap-2"
          style={isElectron ? { WebkitAppRegion: 'drag' } as React.CSSProperties : {}}
        >
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={refreshTasks}
            style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            <RefreshCw className="size-4" />
            {t('workbench.refresh')}
          </Button>
          <Button
            type="button"
            disabled={draftTasks.length === 0 || dispatchingIds.size > 0}
            className="gap-1.5 bg-blue-500 hover:bg-blue-600"
            onClick={handleDispatchAll}
            style={isElectron ? { WebkitAppRegion: 'no-drag' } as React.CSSProperties : {}}
          >
            {dispatchingIds.size > 0 ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t('workbench.startWork')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        {view === 'list' ? (
          <>
            <div className="mb-3 grid shrink-0 grid-cols-4 gap-3">
              {statCards.map(({ label, value, icon: Icon, bg, icon_color }) => (
                <div key={label} className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="mt-1 text-3xl font-bold text-foreground">{value}</div>
                    </div>
                    <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', bg)}>
                      <Icon className={cn('size-5', icon_color)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid min-h-0 flex-1 gap-3 grid-cols-[420px_minmax(0,1fr)]">
            <section className="overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-foreground">{t('workbench.addTaskTitle')}</h2>
                <Plus className="size-4 text-muted-foreground" />
              </div>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">{t('workbench.taskContent')} <span className="text-red-500">*</span></span>
                  <textarea
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-input/30"
                  />
                </label>

                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="block text-sm font-medium text-foreground">{t('workbench.targetGroup')} <span className="text-red-500">*</span></span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={roomOptions.length === 0 || recommendingRoom}
                      className="h-8 gap-1.5 border-border text-muted-foreground hover:bg-muted"
                      onClick={handleRecommendRoom}
                    >
                      {recommendingRoom ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      {recommendingRoom ? t('workbench.recommending') : t('workbench.autoRecommend')}
                    </Button>
                  </div>
                  <Popover open={roomSelectOpen} onOpenChange={setRoomSelectOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={roomSelectOpen}
                        disabled={roomOptions.length === 0}
                        className="h-10 w-full justify-between rounded-lg border-input bg-background px-3 text-sm font-normal text-foreground hover:bg-background dark:bg-input/30"
                      >
                        <span className="min-w-0 flex-1 text-left">
                          {selectedRoom ? (
                            <RoomSelectDisplay room={selectedRoom} />
                          ) : roomOptions.length === 0 ? (
                            <span className="text-muted-foreground">{t('workbench.noAvailableGroups')}</span>
                          ) : (
                            <span className="text-muted-foreground">{t('workbench.selectTargetGroup')}</span>
                          )}
                        </span>
                        <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder={t('chat.searchAssistantPlaceholder')} />
                        <CommandList className="max-h-72">
                          <CommandEmpty>{t('chat.noMatchingAssistants')}</CommandEmpty>
                          <CommandGroup>
                            {roomOptions.map((room) => (
                              <CommandItem
                                key={room.id}
                                value={[
                                  room.name,
                                  room.description,
                                  room.rules,
                                  ...(room.chatRoomAgents ?? []).flatMap((roomAgent) => [
                                    roomAgent.agent?.name,
                                    roomAgent.agent?.description,
                                  ]),
                                ].filter(Boolean).join(' ')}
                                onSelect={() => {
                                  setForm((current) => ({ ...current, chatRoomId: room.id }))
                                  setRoomSelectOpen(false)
                                }}
                                className="min-w-0 cursor-pointer"
                              >
                                <RoomSelectDisplay room={room} />
                                <Check className={cn('ml-auto size-4 text-blue-500', form.chatRoomId === room.id ? 'opacity-100' : 'opacity-0')} />
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">{t('workbench.expectedOutput')}</span>
                  <input
                    value={form.expectedOutput}
                    onChange={(event) => setForm((current) => ({ ...current, expectedOutput: event.target.value }))}
                    className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-input/30"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-foreground">{t('workbench.additionalNotes')}</span>
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-input/30"
                  />
                </label>

                <Button
                  type="button"
                  disabled={saving || roomOptions.length === 0}
                  className="w-full gap-1.5 bg-blue-500 hover:bg-blue-600"
                  onClick={handleCreateTask}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  {t('workbench.addToTodayList')}
                </Button>
              </div>
            </section>

            <section className="flex min-h-0 min-w-0 flex-col">
              <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-foreground">{t('workbench.todayListTitle')}</h2>
                <span className="text-sm text-muted-foreground">{t('workbench.pendingDispatch', { count: draftTasks.length })}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t('workbench.loading')}
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
                    {t('workbench.noTasks')}
                  </div>
                ) : (
                  <div className="space-y-3 pb-2">
                    {tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        rooms={roomOptions}
                        busy={dispatchingIds.has(task.id)}
                        onDispatch={handleDispatch}
                        onDelete={handleDelete}
                        onStatusChange={handleStatusChange}
                        onOpenRoom={handleOpenRoom}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
          </>
        ) : (
        <div className="mt-3 flex min-h-0 flex-1 gap-2 overflow-hidden">
            {columns.map((column) => (
              <div key={column} className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-card p-2 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{column}</h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{tasksByColumn[column]?.length ?? 0}</span>
                  </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <div className="space-y-2">
                    {(tasksByColumn[column] ?? []).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => handleOpenRoom(task)}
                        className="w-full rounded-lg border border-border bg-muted p-1.5 text-left transition-colors hover:border-blue-200 hover:bg-blue-50 dark:hover:border-blue-800 dark:hover:bg-blue-950"
                      >
                        <div className="text-sm font-medium text-foreground">{task.title}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          <span className="truncate">{task.chatRoom?.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}