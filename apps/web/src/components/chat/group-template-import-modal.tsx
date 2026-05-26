import { TemplatePreviewResult, templatePackageApi } from '@/lib/agent-api'
import { AlertCircle, CheckCircle2, Loader2, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

interface GroupTemplateImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImported?: (chatRoomId: string) => void | Promise<void>
}

export function GroupTemplateImportModal({
  isOpen,
  onClose,
  onImported,
}: GroupTemplateImportModalProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<TemplatePreviewResult | null>(null)
  const [desiredGroupName, setDesiredGroupName] = useState('')

  const resetState = () => {
    setStep(1)
    setLoadingPreview(false)
    setImporting(false)
    setFileName('')
    setSelectedFile(null)
    setPreview(null)
    setDesiredGroupName('')
  }

  const handleClose = () => {
    if (loadingPreview || importing) return
    resetState()
    onClose()
  }

  if (!isOpen) return null

  const triggerSelectFile = () => {
    importInputRef.current?.click()
  }

  const loadPreview = async (nextDesiredName?: string) => {
    if (!selectedFile) {
      toast.error('请先选择群组模板文件')
      return
    }

    setLoadingPreview(true)
    try {
      const response = await templatePackageApi.preview({
        file: selectedFile,
        desiredGroupName: (nextDesiredName ?? desiredGroupName).trim(),
      })

      if (!response.success || !response.data) {
        toast.error(response.error || '群组模板预检失败')
        return
      }

      setPreview(response.data)
      setDesiredGroupName((nextDesiredName ?? desiredGroupName).trim() || response.data.manifest.title)
      setStep(2)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setSelectedFile(file)
    setFileName(file.name)
    setPreview(null)
    setDesiredGroupName('')
    setStep(1)
    toast.success('群组模板已加载，可以开始预检')
  }

  const handleConfirmImport = async () => {
    if (!selectedFile || !preview) {
      toast.error('请先完成预检')
      return
    }

    setImporting(true)
    try {
      const response = await templatePackageApi.import({
        file: selectedFile,
        desiredGroupName: desiredGroupName.trim() || preview.manifest.title,
      })

      if (!response.success || !response.data) {
        toast.error(response.error || '导入失败')
        return
      }

      toast.success(`已导入群组模板：${response.data.finalGroupName}`)
      await onImported?.(response.data.chatRoomId)
      resetState()
      onClose()
    } finally {
      setImporting(false)
    }
  }

  const unresolvedList = preview?.compatibility.unresolved ?? []
  const degradedSkills = preview?.degradedSkills ?? []
  const requiredConfigItems = unresolvedList.filter((item) => item.status === 'requires_user_selection')
  const optionalCapabilityItems = unresolvedList.filter((item) => item.status === 'unsupported_but_importable')
  const resolvedItems = preview?.compatibility.resolved ?? []
  const desiredNameTrimmed = desiredGroupName.trim()
  const effectiveImportName = preview?.conflicts.suggestedGroupName ?? desiredNameTrimmed
  const willAutoRename = Boolean(
    preview
      && effectiveImportName
      && effectiveImportName !== (desiredNameTrimmed || preview.manifest.title),
  )
  const resolvedSummaryMap = resolvedItems.reduce((map, item) => {
    const key = `${item.capabilityType}::${item.providerName}`
    const current = map.get(key)
    if (current) {
      current.count += 1
      return map
    }
    map.set(key, {
      key,
      capabilityType: item.capabilityType,
      providerName: item.providerName,
      count: 1,
    })
    return map
  }, new Map<string, {
    key: string
    capabilityType: 'text' | 'image' | 'audio'
    providerName: string
    count: number
  }>())
  const resolvedSummary = Array.from(resolvedSummaryMap.values())

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 py-12">
      <div className="w-full max-w-3xl shrink-0 rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500 text-white">
              <Upload className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">导入群组模板</h2>
              <p className="text-sm text-muted-foreground">选择 ZIP 文件，预检兼容性，再创建新的群组副本。</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="border-b border-border px-6 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {[
              { id: 1, label: '选择文件' },
              { id: 2, label: '预览兼容性' },
              { id: 3, label: '确认导入' },
            ].map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <div className={`flex size-6 items-center justify-center rounded-full ${step >= item.id ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {item.id}
                </div>
                <span className={step >= item.id ? 'text-foreground' : ''}>{item.label}</span>
                {item.id < 3 && <div className="h-px w-8 bg-border" />}
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5 p-6">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={triggerSelectFile}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-6 py-10 text-center hover:border-blue-300 hover:bg-blue-100/70"
              >
                <Upload className="size-8 text-blue-500" />
                <div>
                  <div className="text-sm font-medium text-foreground">选择群组模板 ZIP 文件</div>
                  <div className="mt-1 text-xs text-muted-foreground">支持本地导出的群组模板，导入前会先做兼容性预检。</div>
                </div>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/zip,.zip"
                onChange={handleImportFile}
                className="hidden"
              />

              {selectedFile && (
                <div className="rounded-xl border border-border bg-background px-4 py-3">
                  <div className="text-sm font-medium text-foreground">{fileName || selectedFile.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">已选择群组模板文件，下一步会自动从 ZIP 中读取模板摘要。</div>
                </div>
              )}
            </>
          )}

          {step >= 2 && preview && (
            <>
              <div className="grid gap-5 md:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">导入后的群组名称</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={desiredGroupName}
                        onChange={(e) => setDesiredGroupName(e.target.value)}
                        className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => loadPreview(desiredGroupName)}
                        disabled={loadingPreview}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                      >
                        重新预检
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">导入规则</label>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                      系统会自动创建新的群组副本，并默认使用当前环境的可用模型。
                      {willAutoRename ? ` 如果名称冲突，将自动命名为：${effectiveImportName}` : ' 当前名称可直接导入。'}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">{preview.summary.groupName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">模板版本 {preview.manifest.version}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-muted/50 px-3 py-2">助手 {preview.summary.agents}</div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2">分类 {preview.summary.categories}</div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2">技能 {preview.summary.skills}</div>
                    <div className="rounded-lg bg-muted/50 px-3 py-2">定时任务 {preview.summary.cronTasks}</div>
                  </div>

                  <div className={`rounded-lg px-3 py-2 text-sm ${preview.conflicts.duplicateTemplate ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {preview.conflicts.duplicateTemplate
                      ? '检测到同模板版本已导入，本次会继续创建新的群组副本。'
                      : '未检测到同版本重复导入，可以直接创建副本。'}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    已自动映射能力
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    {resolvedItems.length === 0 ? (
                      <div>没有需要自动映射的能力。</div>
                    ) : (
                      <>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {resolvedSummary.map((item) => (
                            <div key={item.key} className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-emerald-700">
                              <div className="text-sm font-medium">{item.capabilityType} → {item.providerName}</div>
                              <div className="mt-1 text-xs">{item.count} 项能力已映射到这个本地模型</div>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                          共自动映射 {resolvedItems.length} 项能力，去重后为 {resolvedSummary.length} 组本地模型映射。
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <AlertCircle className="size-4 text-amber-500" />
                    待补配置项
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {requiredConfigItems.length === 0 && degradedSkills.length === 0 ? (
                      <div>没有阻断问题，导入后即可直接使用。</div>
                    ) : (
                      <>
                        {requiredConfigItems.map((item) => (
                          <div key={`${item.agentRef}-${item.capabilityType}`} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">
                            {item.capabilityType}：当前环境没有可直接使用的默认模型，导入后需要补充配置。
                          </div>
                        ))}
                        {degradedSkills.map((skill) => (
                          <div key={skill.slug} className="rounded-lg bg-orange-50 px-3 py-2 text-orange-700">
                            技能 {skill.slug} 导出时不完整：{skill.reason}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {optionalCapabilityItems.length > 0 && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-800">
                    <CheckCircle2 className="size-4 text-blue-600" />
                    可选增强项
                  </div>
                  <div className="space-y-2 text-sm text-blue-700">
                    {optionalCapabilityItems.map((item) => (
                      <div key={`${item.agentRef}-${item.capabilityType}`} className="rounded-lg bg-white/70 px-3 py-2">
                        {item.capabilityType} 当前环境未配置，本次不会阻止导入；后续如果你想启用这项能力，再单独补模型即可。
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => {
              if (step === 1) {
                handleClose()
                return
              }
              if (step === 2) {
                setStep(1)
                return
              }
              setStep(2)
            }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {step === 1 ? '取消' : '上一步'}
          </button>

          <div className="flex gap-3">
            {step === 1 && (
              <button
                type="button"
                onClick={() => loadPreview()}
                disabled={!selectedFile || loadingPreview}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingPreview ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                开始预检
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={!preview}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                下一步
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                确认导入
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
