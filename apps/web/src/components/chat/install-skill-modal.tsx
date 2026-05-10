import { useState, useRef, useEffect } from 'react'
import { X, Loader2, Download, MessageSquare, Package, Check, Search } from 'lucide-react'
import { agentApi } from '@/lib/agent-api'
import { skillApi, SharedSkill } from '@/lib/skill-api'
import { toast } from 'sonner'
import { useAuthStore, useSocketStore, useChatRoomStore } from '@/stores'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface InstallSkillModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void  // 安装成功后的回调
  agentId: string
  agentName: string
}

// 技能安装助手的专用 ID
const SKILLS_HELPER_AGENT_ID = '596667f7-f901-4613-92a7-cc71d859fa22'

// 安装模式
type InstallMode = 'chat' | 'select'

export function InstallSkillModal({
  isOpen,
  onClose,
  onSuccess,
  agentId,
  agentName,
}: InstallSkillModalProps) {
  const [mode, setMode] = useState<InstallMode>('select')
  const [query, setQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const isComposingRef = useRef(false)  // 追踪中文输入状态
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const { sendMessage } = useSocketStore()
  const loadChatRooms = useChatRoomStore((s) => s.loadChatRooms)
  const selectRoom = useChatRoomStore((s) => s.selectRoom)

  // 选择模式状态
  const [sharedSkills, setSharedSkills] = useState<SharedSkill[]>([])
  const [loadingSkills, setLoadingSkills] = useState(false)
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [installing, setInstalling] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 搜索过滤后的技能列表
  const filteredSkills = sharedSkills.filter((skill) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.description?.toLowerCase().includes(q) ||
      skill.slug.toLowerCase().includes(q)
    )
  })

  // 加载共享技能
  useEffect(() => {
    if (isOpen && mode === 'select') {
      loadSharedSkills()
    }
  }, [isOpen, mode])

  const loadSharedSkills = async () => {
    setLoadingSkills(true)
    try {
      const result = await skillApi.getShared()
      if (result.success && result.data) {
        // 过滤出未安装到当前助手的技能
        const availableSkills = result.data.filter(
          skill => !skill.installedAgents.includes(agentName)
        )
        setSharedSkills(availableSkills)
      } else {
        toast.error(result.error || '获取技能列表失败')
      }
    } catch (error) {
      toast.error('获取技能列表失败')
    } finally {
      setLoadingSkills(false)
    }
  }

  // 切换技能选中状态
  const toggleSkill = (slug: string) => {
    setSelectedSkills(prev => {
      const next = new Set(prev)
      if (next.has(slug)) {
        next.delete(slug)
      } else {
        next.add(slug)
      }
      return next
    })
  }

  // 批量安装选中的技能
  const handleBatchInstall = async () => {
    if (selectedSkills.size === 0) return

    setInstalling(true)
    try {
      let successCount = 0
      let failCount = 0

      for (const slug of selectedSkills) {
        const skill = sharedSkills.find(s => s.slug === slug)
        if (!skill) continue

        const result = await skillApi.symlink(skill.slug, agentId)
        if (result.success) {
          successCount++
        } else {
          failCount++
        }
      }

      if (failCount === 0) {
        toast.success(`已成功安装 ${successCount} 个技能`)
        onSuccess?.()
      } else {
        toast.warning(`部分安装失败，成功 ${successCount} 个，失败 ${failCount} 个`)
        onSuccess?.()  // 即使部分失败，也刷新列表让已安装的显示出来
      }

      resetAndClose()
    } catch (error) {
      toast.error('安装失败')
    } finally {
      setInstalling(false)
    }
  }

  if (!isOpen) return null

  const handleStartChat = async () => {
    if (!query.trim() || isCreating) return
    if (!user?.id) {
      toast.error('请先登录')
      return
    }

    setIsCreating(true)
    try {
      // 创建与技能安装助手的快速对话
      const res = await agentApi.createQuickChat(SKILLS_HELPER_AGENT_ID, user.id)
      if (res.success && res.data) {
        // 刷新聊天室列表，确保新会话已加载
        await loadChatRooms()
        // 选择新创建的房间
        selectRoom(res.data.id)
        // 跳转到消息页面
        navigate('/')
        // 发送初始消息（包含目标助手 ID 和名称）
        sendMessage({ chatRoomId: res.data.id, content: `[目标助手: ${agentName} (ID: ${agentId})] ${query.trim()}` })
        // 关闭模态框
        resetAndClose()
        // 注意：技能还未安装，需要用户在对话中完成安装后返回助手页面刷新
      } else {
        toast.error(res.error || '创建对话失败')
      }
    } finally {
      setIsCreating(false)
    }
  }

  const resetAndClose = () => {
    setQuery('')
    setMode('select')
    setSelectedSkills(new Set())
    setSearchQuery('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-[520px] rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Download className="size-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">安装 Skill</h2>
          </div>
          <button
            onClick={resetAndClose}
            disabled={isCreating || installing}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-border px-6">
          <button
            onClick={() => setMode('select')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              mode === 'select'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <Package className="size-4" />
            从技能库选择
          </button>
          <button
            onClick={() => setMode('chat')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
              mode === 'chat'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <MessageSquare className="size-4" />
            对话安装
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="mb-4 text-sm text-muted-foreground">
            为助手 <span className="font-medium text-foreground">{agentName}</span> 安装 Skill
          </p>

          {/* 选择模式 */}
          {mode === 'select' && (
            <>
              {loadingSkills ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="size-5 animate-spin mr-2" />
                  加载技能列表...
                </div>
              ) : sharedSkills.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Package className="size-12 mb-3 opacity-50" />
                  <p className="text-sm">暂无可安装的技能</p>
                  <p className="text-xs mt-1">所有技能都已安装到此助手，或技能库为空</p>
                </div>
              ) : (
                <>
                  {/* 搜索框 */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索技能名称或描述..."
                      className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                    />
                  </div>
                  {filteredSkills.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                      <Search className="size-8 mb-2 opacity-50" />
                      <p className="text-sm">没有匹配的技能</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {filteredSkills.map((skill) => (
                    <button
                      key={skill.slug}
                      onClick={() => toggleSkill(skill.slug)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
                        selectedSkills.has(skill.slug)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:bg-accent'
                      )}
                    >
                      <div className={cn(
                        'flex size-5 items-center justify-center rounded border transition-colors',
                        selectedSkills.has(skill.slug)
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-transparent'
                      )}
                      >
                        {selectedSkills.has(skill.slug) && (
                          <Check className="size-3" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="font-medium text-foreground truncate">{skill.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {skill.description || '无描述'}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        <span className="rounded bg-muted px-2 py-0.5">
                          {skill.source === 'user-created' ? '用户创建' : '外部'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                  )}
                </>
              )}

              {!loadingSkills && sharedSkills.length > 0 && (
                <p className="text-xs text-muted-foreground mt-3">
                  已选择 {selectedSkills.size} 个技能，点击确认安装
                </p>
              )}
            </>
          )}

          {/* 对话模式 */}
          {mode === 'chat' && (
            <>
              {/* 输入框 */}
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  描述你需要的技能功能
                </label>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="如：帮我找一个写代码的技能、分析数据的技能、处理图片的技能..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none resize-none h-24"
                  autoFocus
                  onCompositionStart={() => { isComposingRef.current = true }}
                  onCompositionEnd={() => { isComposingRef.current = false }}
                  onKeyDown={(e) => {
                    // 中文输入过程中不响应回车，结束后才触发
                    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
                      e.preventDefault()
                      handleStartChat()
                    }
                  }}
                />
              </div>

              {/* 提示 */}
              <p className="text-xs text-muted-foreground">
                点击"开始对话安装"后，将跳转到技能安装助手对话。
                助手会根据你的描述搜索相关技能仓库，并帮你安装到当前助手。
              </p>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={resetAndClose}
            disabled={isCreating || installing}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            取消
          </button>

          {mode === 'select' ? (
            <button
              type="button"
              onClick={handleBatchInstall}
              disabled={selectedSkills.size === 0 || installing}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {installing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  安装中...
                </>
              ) : (
                <>
                  <Download className="size-4" />
                  安装 ({selectedSkills.size})
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartChat}
              disabled={!query.trim() || isCreating}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {isCreating ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  创建对话中...
                </>
              ) : (
                <>
                  <MessageSquare className="size-4" />
                  开始对话安装
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
