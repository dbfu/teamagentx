import { ChatRoom, templatePackageApi } from '@/lib/agent-api'
import { Switch } from '@/components/ui/switch'
import { Download, Loader2, Package2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface GroupTemplateExportModalProps {
  isOpen: boolean
  chatRoom: ChatRoom
  onClose: () => void
}

function buildExportFilename(title: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  const date = new Date().toISOString().slice(0, 10)
  return `${safeTitle || 'group-template-package'}-${date}.json`
}

export function GroupTemplateExportModal({
  isOpen,
  chatRoom,
  onClose,
}: GroupTemplateExportModalProps) {
  const [title, setTitle] = useState(chatRoom.name)
  const [summary, setSummary] = useState(chatRoom.description || '')
  const [includeSkills, setIncludeSkills] = useState(true)
  const [includeCronTasks, setIncludeCronTasks] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setTitle(chatRoom.name)
    setSummary(chatRoom.description || '')
    setIncludeSkills(true)
    setIncludeCronTasks(true)
  }, [chatRoom.description, chatRoom.name, isOpen])

  if (!isOpen) return null

  const handleExport = async () => {
    const finalTitle = title.trim()
    if (!finalTitle) {
      toast.error('请输入模板包名称')
      return
    }

    setExporting(true)
    try {
      const response = await templatePackageApi.export({
        chatRoomId: chatRoom.id,
        packageTitle: finalTitle,
        packageSummary: summary.trim() || undefined,
        includeSkills,
        includeCronTasks,
      })

      if (!response.success || !response.data) {
        toast.error(response.error || '导出失败')
        return
      }

      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = buildExportFilename(finalTitle)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 100)
      toast.success(`已导出模板包：${finalTitle}`)
      onClose()
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-full max-w-2xl shrink-0 rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500 text-white">
              <Package2 className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">导出群组模板包</h2>
              <p className="text-sm text-muted-foreground">把当前群组连同助手、分类、技能和定时任务打成一个模板包。</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            会导出群组结构、助手和分类；你可以按需决定是否把技能和定时任务一起打包。不会导出消息历史、本地绝对路径和模型密钥。
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              模板包名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入模板包名称"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">模板包简介</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="描述这个模板包适合什么协作场景"
              rows={4}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-input bg-background p-4">
            <div className="mb-3 text-sm font-medium text-foreground">导出内容</div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-foreground">包含技能</div>
                  <div className="text-xs text-muted-foreground">把当前群组助手正在使用的技能一起打包，适合迁移完整协作能力。</div>
                </div>
                <Switch checked={includeSkills} onCheckedChange={setIncludeSkills} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium text-foreground">包含定时任务</div>
                  <div className="text-xs text-muted-foreground">把群组下的计划任务一并导出，导入后会作为关闭状态的任务副本存在。</div>
                </div>
                <Switch checked={includeCronTasks} onCheckedChange={setIncludeCronTasks} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            导出模板包
          </button>
        </div>
      </div>
    </div>
  )
}
