import { Agent, agentApi } from '@/lib/agent-api'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTime } from '@/lib/utils'
import {
  Sparkles,
  Cpu,
  Globe,
  Folder,
  Clock,
  FileText,
  Database,
  Tag,
  Pencil,
  X,
  Loader2,
  FolderOpen,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import { promptOptimizeApi } from '@/lib/prompt-optimize-api'

// 全屏编辑模态框
function FullscreenPromptModal({
  isOpen,
  prompt,
  onClose,
  onConfirm,
  isSaving,
}: {
  isOpen: boolean
  prompt: string
  onClose: () => void
  onConfirm: (prompt: string) => void
  isSaving?: boolean
}) {
  const [editPrompt, setEditPrompt] = useState(prompt)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isOpen) {
      setEditPrompt(prompt)
    }
  }, [isOpen, prompt])

  // AI 优化提示词（流式）
  const handleOptimize = async () => {
    if (!editPrompt.trim() || isOptimizing) return

    setIsOptimizing(true)
    // 清空当前内容，准备接收流式输出
    setEditPrompt('')

    await promptOptimizeApi.optimizeStream(
      editPrompt,
      // onChunk: 每次收到内容块时追加
      (content) => {
        setEditPrompt((prev) => prev + content)
        // 自动滚动到底部
        if (textareaRef.current) {
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight
        }
      },
      // onDone: 完成时
      () => {
        setIsOptimizing(false)
        toast.success('提示词已优化')
      },
      // onError: 错误时
      (error) => {
        setIsOptimizing(false)
        toast.error(error || '优化失败')
      }
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-[80vh] w-full max-w-4xl flex-col rounded-2xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">编辑提示词</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-6">
          <textarea
            ref={textareaRef}
            value={editPrompt}
            onChange={(e) => setEditPrompt(e.target.value)}
            placeholder="请输入助手的提示词，用于定义助手的行为和角色"
            className="h-full w-full resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleOptimize}
            disabled={!editPrompt.trim() || isOptimizing}
            className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-600 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed dark:border-purple-800 dark:bg-purple-950 dark:text-purple-300 dark:hover:bg-purple-900"
          >
            {isOptimizing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            AI 优化
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onConfirm(editPrompt)}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AssistantConfigTabProps {
  agent: Agent
  onUpdate?: () => void
}

export function AssistantConfigTab({ agent, onUpdate }: AssistantConfigTabProps) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSystemAgent = agent.agentLevel === 'system'

  const handleOpenWorkDir = async (workDir: string) => {
    if (!window.electronAPI?.isElectron) return
    try {
      await window.electronAPI.openFolder(workDir)
    } catch {
      toast.error('打开目录失败')
    }
  }

  const handleSavePrompt = async (newPrompt: string) => {
    if (isSystemAgent) {
      toast.error('系统助手不允许修改')
      return
    }

    setIsSaving(true)
    try {
      await agentApi.update(agent.id, { prompt: newPrompt })
      toast.success('提示词已更新')
      setIsEditingPrompt(false)
      onUpdate?.()
    } catch (error) {
      toast.error('更新失败')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 提示词卡片 */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              <h3 className="font-semibold text-foreground">系统提示词</h3>
            </div>
            {!isSystemAgent && (
              <button
                onClick={() => setIsEditingPrompt(true)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Pencil className="size-4" />
                编辑
              </button>
            )}
          </div>
        </div>
        <div className="p-6">
          <div className="bg-muted rounded-xl border border-border p-4 text-sm text-foreground whitespace-pre-wrap max-h-100 overflow-y-auto leading-relaxed">
            {agent.prompt || '未设置提示词'}
          </div>
        </div>
      </div>

      {/* 基本信息 */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h3 className="font-semibold text-foreground">基本信息</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-6">
            {/* 类型 */}
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-lg bg-primary/5 flex items-center justify-center">
                {agent.type === 'builtin' ? (
                  <Sparkles className="size-5 text-primary" />
                ) : (
                  <Cpu className="size-5 text-primary" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">助手类型</p>
                <p className="font-medium text-foreground">
                  {agent.type === 'builtin' ? '原生助手' : '外部工具'}
                </p>
              </div>
            </div>

            {/* ACP 工具 */}
            {agent.type === 'acp' && agent.acpTool && (
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Globe className="size-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">ACP 工具</p>
                  <p className="font-medium text-foreground">{agent.acpTool}</p>
                </div>
              </div>
            )}

            {/* LLM 供应商 */}
            {agent.llmProvider && (
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <Database className="size-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">LLM 供应商</p>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{agent.llmProvider.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {agent.llmProvider.model}
                    </Badge>
                  </div>
                </div>
              </div>
            )}

            {/* 分类 */}
            {agent.category && (
              <div className="flex items-center gap-4">
                <div className="size-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <Tag className="size-5 text-orange-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">所属分类</p>
                  <p className="font-medium text-foreground">{agent.category.name}</p>
                </div>
              </div>
            )}

            {/* 状态 */}
            <div className="flex items-center gap-4">
              <div className={cn(
                'size-10 rounded-lg flex items-center justify-center',
                agent.isActive ? 'bg-green-500/10' : 'bg-muted'
              )}>
                <div className={cn(
                  'size-2.5 rounded-full',
                  agent.isActive ? 'bg-green-500' : 'bg-muted-foreground'
                )} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">当前状态</p>
                <Badge
                  variant={agent.isActive ? 'default' : 'secondary'}
                  className={cn(
                    agent.isActive
                      ? 'bg-green-100 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400'
                      : ''
                  )}
                >
                  {agent.isActive ? '已启用' : '已停用'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 工作目录 */}
      {agent.workDir && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Folder className="size-5 text-amber-500" />
              <h3 className="font-semibold text-foreground">工作目录</h3>
            </div>
          </div>
          <div className="p-6">
            <div className="bg-amber-500/10 rounded-xl p-3 text-sm text-foreground font-mono flex items-center justify-between gap-2">
              <span className="break-all">{agent.workDir}</span>
              {window.electronAPI?.isElectron && (
                <button
                  onClick={() => handleOpenWorkDir(agent.workDir!)}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                  title="打开目录"
                >
                  <FolderOpen className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 描述 */}
      {agent.description && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h3 className="font-semibold text-foreground">描述</h3>
          </div>
          <div className="p-6">
            <p className="text-foreground leading-relaxed">{agent.description}</p>
          </div>
        </div>
      )}

      {/* 时间信息 */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Clock className="size-5 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">时间信息</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">创建时间</p>
              <p className="text-foreground">{formatDateTime(agent.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">更新时间</p>
              <p className="text-foreground">{formatDateTime(agent.updatedAt)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 全屏编辑模态框 */}
      <FullscreenPromptModal
        isOpen={isEditingPrompt}
        prompt={agent.prompt || ''}
        onClose={() => setIsEditingPrompt(false)}
        onConfirm={handleSavePrompt}
        isSaving={isSaving}
      />
    </div>
  )
}
