import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChatRoom } from '@/lib/agent-api'
import { GroupAvatarImage } from '@/lib/group-avatars'
import { workbenchApi, type WorkbenchTask, type WorkbenchTaskStatus } from '@/lib/workbench-api'
import { cn } from '@/lib/utils'
import { useChatRoomStore } from '@/stores'
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ListTodo,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

const statusMeta: Record<WorkbenchTaskStatus, { label: string; tone: string; column: string }> = {
  draft: { label: '待派发', tone: 'bg-slate-100 text-slate-700', column: '待派发' },
  dispatched: { label: '已派发', tone: 'bg-blue-100 text-blue-700', column: '执行中' },
  in_progress: { label: '执行中', tone: 'bg-cyan-100 text-cyan-700', column: '执行中' },
  waiting_review: { label: '待确认', tone: 'bg-amber-100 text-amber-700', column: '待确认' },
  needs_input: { label: '需补充', tone: 'bg-orange-100 text-orange-700', column: '卡住' },
  completed: { label: '已完成', tone: 'bg-emerald-100 text-emerald-700', column: '已完成' },
  blocked: { label: '卡住', tone: 'bg-red-100 text-red-700', column: '卡住' },
}

const statusOptions: WorkbenchTaskStatus[] = [
  'draft',
  'dispatched',
  'in_progress',
  'waiting_review',
  'needs_input',
  'completed',
  'blocked',
]

const columns = ['待派发', '执行中', '待确认', '已完成', '卡住']

function todayLabel() {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())
}

function formatTime(value: string | null | undefined) {
  if (!value) return '暂无动态'
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

function TaskStatusBadge({ status }: { status: WorkbenchTaskStatus }) {
  const meta = statusMeta[status]
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', meta.tone)}>
      {meta.label}
    </span>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: typeof ListTodo
  tone: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-gray-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
        </div>
        <div className={cn('flex size-9 items-center justify-center rounded-lg', tone)}>
          <Icon className="size-4" />
        </div>
      </div>
    </div>
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
}: {
  task: WorkbenchTask
  rooms: ChatRoom[]
  onDispatch: (task: WorkbenchTask) => void
  onDelete: (task: WorkbenchTask) => void
  onStatusChange: (task: WorkbenchTask, status: WorkbenchTaskStatus) => void
  onOpenRoom: (task: WorkbenchTask) => void
  busy: boolean
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold text-gray-900">{task.title}</h3>
            <TaskStatusBadge status={task.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" />
              {task.chatRoom?.name ?? rooms.find((room) => room.id === task.chatRoomId)?.name ?? '未知群聊'}
            </span>
            <span>最新：{formatTime(task.lastActivityAt || task.updatedAt)}</span>
          </div>
          {(task.expectedOutput || task.description) && (
            <p className="mt-2 line-clamp-2 text-sm text-gray-600">
              {task.expectedOutput ? `产出：${task.expectedOutput}` : task.description}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            value={task.status}
            onChange={(event) => onStatusChange(task, event.target.value as WorkbenchTaskStatus)}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>{statusMeta[status].label}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => onOpenRoom(task)}
          >
            <ArrowRight className="size-4" />
            进入群聊
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || task.status !== 'draft'}
            className="h-9 gap-1.5 bg-blue-500 hover:bg-blue-600"
            onClick={() => onDispatch(task)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            派发
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-gray-500 hover:bg-red-50 hover:text-red-600"
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

  const refreshTasks = async () => {
    setLoading(true)
    try {
      const response = await workbenchApi.getToday()
      if (response.success && response.data) {
        setTasks(response.data)
      } else {
        toast.error(response.error || '加载工作台任务失败')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadChatRooms()
    refreshTasks()
  }, [loadChatRooms])

  const selectedRoom = roomOptions.find((room) => room.id === form.chatRoomId) ?? null

  const stats = useMemo(() => {
    const total = tasks.length
    const completed = tasks.filter((task) => task.status === 'completed').length
    const waiting = tasks.filter((task) => task.status === 'waiting_review' || task.status === 'needs_input').length
    const blocked = tasks.filter((task) => task.status === 'blocked' || task.status === 'needs_input').length
    const running = tasks.filter((task) => ['dispatched', 'in_progress'].includes(task.status)).length
    return { total, completed, running, waiting, blocked }
  }, [tasks])

  const tasksByColumn = useMemo(() => {
    return columns.reduce<Record<string, WorkbenchTask[]>>((acc, column) => {
      acc[column] = tasks.filter((task) => statusMeta[task.status].column === column)
      return acc
    }, {})
  }, [tasks])

  const roomStats = useMemo(() => {
    return roomOptions
      .map((room) => {
        const roomTasks = tasks.filter((task) => task.chatRoomId === room.id)
        return {
          room,
          total: roomTasks.length,
          completed: roomTasks.filter((task) => task.status === 'completed').length,
          running: roomTasks.filter((task) => ['dispatched', 'in_progress'].includes(task.status)).length,
          blocked: roomTasks.filter((task) => task.status === 'blocked' || task.status === 'needs_input').length,
        }
      })
      .filter((item) => item.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [roomOptions, tasks])

  const draftTasks = tasks.filter((task) => task.status === 'draft')

  const handleRecommendRoom = async () => {
    if (roomOptions.length === 0) {
      toast.error('暂无可推荐的群聊')
      return
    }

    if (![form.title, form.expectedOutput, form.description, form.note].some((value) => value.trim())) {
      toast.error('请先填写任务内容或补充说明')
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
        toast.error(response.error || '推荐目标群聊失败')
        return
      }

      if (!response.data.chatRoomId) {
        toast.error(response.data.reason || '没有找到匹配的群聊')
        return
      }

      const recommendedRoom = roomOptions.find((room) => room.id === response.data?.chatRoomId)
      setForm((current) => ({ ...current, chatRoomId: response.data!.chatRoomId! }))
      toast.success(`已推荐「${recommendedRoom?.name ?? '目标群聊'}」`, {
        description: response.data.reason,
      })
    } finally {
      setRecommendingRoom(false)
    }
  }

  const handleCreateTask = async () => {
    if (!form.title.trim()) {
      toast.error('请输入任务内容')
      return
    }
    if (!form.chatRoomId) {
      toast.error('请选择目标群聊')
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
        toast.error(response.error || '创建任务失败')
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
        toast.success(`已派发到「${response.data.chatRoom.name}」`)
      } else {
        toast.error(response.error || '派发失败')
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
        toast.success(`已派发 ${response.data.length} 个任务`)
      } else {
        toast.error(response.error || '批量派发失败')
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
      toast.error(response.error || '删除任务失败')
    }
  }

  const handleStatusChange = async (task: WorkbenchTask, status: WorkbenchTaskStatus) => {
    const response = await workbenchApi.update(task.id, { status })
    if (response.success && response.data) {
      replaceTask(response.data)
    } else {
      toast.error(response.error || '更新状态失败')
    }
  }

  const handleOpenRoom = (task: WorkbenchTask) => {
    const msg = task.dispatchMessageId ? `&msg=${task.dispatchMessageId}` : ''
    navigate(`/?room=${task.chatRoomId}${msg}`)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <div className="flex shrink-0 flex-col gap-4 border-b border-gray-200 bg-white px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm text-gray-500">{todayLabel()}</div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">工作台</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              className={cn('flex h-9 items-center gap-1.5 rounded-md px-3 text-sm', view === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600')}
              onClick={() => setView('list')}
            >
              <ListTodo className="size-4" />
              今日清单
            </button>
            <button
              className={cn('flex h-9 items-center gap-1.5 rounded-md px-3 text-sm', view === 'screen' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600')}
              onClick={() => setView('screen')}
            >
              <BarChart3 className="size-4" />
              进度大屏
            </button>
          </div>
          <Button type="button" variant="outline" className="gap-1.5" onClick={refreshTasks}>
            <RefreshCw className="size-4" />
            刷新
          </Button>
          <Button
            type="button"
            disabled={draftTasks.length === 0 || dispatchingIds.size > 0}
            className="gap-1.5 bg-blue-500 hover:bg-blue-600"
            onClick={handleDispatchAll}
          >
            {dispatchingIds.size > 0 ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            开始今天的工作
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatTile label="今日任务" value={stats.total} icon={ListTodo} tone="bg-slate-100 text-slate-700" />
          <StatTile label="执行中" value={stats.running} icon={Clock3} tone="bg-cyan-100 text-cyan-700" />
          <StatTile label="待处理" value={stats.waiting} icon={AlertCircle} tone="bg-amber-100 text-amber-700" />
          <StatTile label="已完成" value={stats.completed} icon={CheckCircle2} tone="bg-emerald-100 text-emerald-700" />
          <StatTile label="卡住" value={stats.blocked} icon={AlertCircle} tone="bg-red-100 text-red-700" />
        </div>

        {view === 'list' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
            <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900">添加今日任务</h2>
                <Plus className="size-4 text-gray-400" />
              </div>
              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">任务内容 <span className="text-red-500">*</span></span>
                  <textarea
                    value={form.title}
                    onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                    rows={4}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="例如：修复桌面版 DMG 启动失败问题"
                  />
                </label>

                <div className="block">
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <span className="block text-sm font-medium text-gray-700">目标群聊 <span className="text-red-500">*</span></span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={roomOptions.length === 0 || recommendingRoom}
                      className="h-8 gap-1.5 border-gray-200 text-gray-600 hover:bg-gray-50"
                      onClick={handleRecommendRoom}
                    >
                      {recommendingRoom ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      {recommendingRoom ? '推荐中' : '自动推荐'}
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
                        className="h-10 w-full justify-between rounded-lg border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 hover:bg-white"
                      >
                        <span className="min-w-0 flex-1 text-left">
                          {selectedRoom ? (
                            <RoomSelectDisplay room={selectedRoom} />
                          ) : roomOptions.length === 0 ? (
                            <span className="text-gray-400">暂无可选群聊</span>
                          ) : (
                            <span className="text-gray-400">请选择目标群聊</span>
                          )}
                        </span>
                        <ChevronDown className="ml-2 size-4 shrink-0 text-gray-400" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
                      <Command>
                        <CommandInput placeholder="搜索群聊名称、描述或助手..." />
                        <CommandList className="max-h-72">
                          <CommandEmpty>没有匹配的群聊</CommandEmpty>
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
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">期望产出</span>
                  <input
                    value={form.expectedOutput}
                    onChange={(event) => setForm((current) => ({ ...current, expectedOutput: event.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="例如：定位原因并提交修复方案"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-gray-700">补充说明</span>
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    placeholder="背景、约束、参考资料等"
                  />
                </label>

                <Button
                  type="button"
                  disabled={saving || roomOptions.length === 0}
                  className="w-full gap-1.5 bg-blue-500 hover:bg-blue-600"
                  onClick={handleCreateTask}
                >
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  加入今日清单
                </Button>
              </div>
            </section>

            <section className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900">今日清单</h2>
                <span className="text-sm text-gray-500">{draftTasks.length} 个待派发</span>
              </div>
              {loading ? (
                <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white text-sm text-gray-500">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  加载中...
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex h-52 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white text-sm text-gray-500">
                  今天还没有任务
                </div>
              ) : (
                <div className="space-y-3">
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
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="min-w-0">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900">任务看板</h2>
                <span className="text-sm text-gray-500">跨群聊今日进度</span>
              </div>
              <div className="grid gap-4 lg:grid-cols-5">
                {columns.map((column) => (
                  <div key={column} className="min-h-80 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-800">{column}</h3>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{tasksByColumn[column]?.length ?? 0}</span>
                    </div>
                    <div className="space-y-2">
                      {(tasksByColumn[column] ?? []).map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          onClick={() => handleOpenRoom(task)}
                          className="w-full rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50"
                        >
                          <div className="line-clamp-2 text-sm font-medium text-gray-900">{task.title}</div>
                          <div className="mt-2 text-xs text-gray-500">
                            <span className="truncate">{task.chatRoom?.name}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-6">
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">群聊进度</h2>
                <div className="mt-4 space-y-3">
                  {roomStats.length === 0 ? (
                    <div className="text-sm text-gray-500">暂无群聊任务</div>
                  ) : roomStats.map((item) => (
                    <div key={item.room.id} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-sm font-medium text-gray-900">{item.room.name}</div>
                        <div className="text-xs text-gray-500">{item.total} 个任务</div>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${item.total ? Math.round((item.completed / item.total) * 100) : 0}%` }}
                        />
                      </div>
                      <div className="mt-2 text-xs text-gray-500">
                        {item.completed} 完成 / {item.running} 执行中 / {item.blocked} 卡住
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">最新动态</h2>
                <div className="mt-4 space-y-3">
                  {[...tasks]
                    .sort((a, b) => new Date(b.lastActivityAt || b.updatedAt).getTime() - new Date(a.lastActivityAt || a.updatedAt).getTime())
                    .slice(0, 8)
                    .map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => handleOpenRoom(task)}
                        className="flex w-full gap-3 text-left"
                      >
                        <span className="w-12 shrink-0 text-xs text-gray-400">{formatTime(task.lastActivityAt || task.updatedAt)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-gray-800">{task.title}</span>
                          <span className="mt-0.5 block text-xs text-gray-500">{statusMeta[task.status].label} · {task.chatRoom?.name}</span>
                        </span>
                      </button>
                    ))}
                </div>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
