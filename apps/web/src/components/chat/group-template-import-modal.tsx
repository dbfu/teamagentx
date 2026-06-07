import { TemplatePreviewResult, templatePackageApi } from '@/lib/agent-api'
import { AlertCircle, Loader2, Upload, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation()
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
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
  const electronNoDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties

  const triggerSelectFile = () => {
    importInputRef.current?.click()
  }

  const loadPreview = async (nextDesiredName?: string) => {
    if (!selectedFile) {
      toast.error(t('toast.selectTemplateFileFirst'))
      return
    }

    setLoadingPreview(true)
    try {
      const response = await templatePackageApi.preview({
        file: selectedFile,
        desiredGroupName: (nextDesiredName ?? desiredGroupName).trim(),
      })

      if (!response.success || !response.data) {
        toast.error(t('toast.templatePreviewFailed'))
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
    toast.success(t('toast.templateLoaded'))
  }

  const handleConfirmImport = async () => {
    if (!selectedFile || !preview) {
      toast.error(t('toast.completePreviewFirst'))
      return
    }

    setImporting(true)
    try {
      const response = await templatePackageApi.import({
        file: selectedFile,
        desiredGroupName: desiredGroupName.trim() || preview.manifest.title,
      })

      if (!response.success || !response.data) {
        toast.error(t('toast.importFailed'))
        return
      }

      toast.success(t('toast.templateImportedWithName', { name: response.data.finalGroupName }))
      await onImported?.(response.data.chatRoomId)
      resetState()
      onClose()
    } finally {
      setImporting(false)
    }
  }

  const degradedSkills = preview?.degradedSkills ?? []

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-12"
      style={electronNoDragStyle}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl">
        <div
          className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4"
          style={electronNoDragStyle}
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500 text-white">
              <Upload className="size-4" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{t('chat.importTemplate')}</h2>
              <p className="text-sm text-muted-foreground">{t('chat.importTemplateDesc')}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            style={electronNoDragStyle}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-border px-6 py-3">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {[
              { id: 1, label: t('chat.stepSelectFile') },
              { id: 2, label: t('chat.stepPreviewImport') },
            ].map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <div className={`flex size-6 items-center justify-center rounded-full ${step >= item.id ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                  {item.id}
                </div>
                <span className={step >= item.id ? 'text-foreground' : ''}>{item.label}</span>
                {item.id < 2 && <div className="h-px w-8 bg-border" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={triggerSelectFile}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50 px-6 py-10 text-center hover:border-blue-300 hover:bg-blue-100/70"
              >
                <Upload className="size-8 text-blue-500" />
                <div>
                  <div className="text-sm font-medium text-foreground">{t('chat.selectTemplateZip')}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t('chat.selectTemplateZipHint')}</div>
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
                  <div className="mt-1 text-xs text-muted-foreground">{t('chat.templateFileSelected')}</div>
                </div>
              )}
            </>
          )}

          {step >= 2 && preview && (
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-background p-5">
                <div className="text-base font-medium text-foreground">{preview.summary.groupName}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('chat.templateVersion')} {preview.manifest.version}</div>

                <div className="mt-4 grid grid-cols-4 gap-3">
                  {[
                    { label: t('chat.statAgents'), value: preview.summary.agents },
                    { label: t('chat.statCategories'), value: preview.summary.categories },
                    { label: t('chat.statSkills'), value: preview.summary.skills },
                    { label: t('chat.statCronTasks'), value: preview.summary.cronTasks },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-muted/50 px-3 py-3 text-center">
                      <div className="text-lg font-semibold text-foreground">{stat.value}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background p-5">
                <label className="mb-1.5 block text-sm font-medium text-foreground">{t('chat.importGroupNameLabel')}</label>
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
                    {t('chat.repreview')}
                  </button>
                </div>

                <div className={`mt-3 rounded-lg px-3 py-2.5 text-sm leading-5 ${preview.conflicts.nameConflict ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {t('chat.importWillCreateGroup')}
                  {preview.conflicts.nameConflict
                    ? ` ${t('chat.nameConflictHint', { name: preview.conflicts.suggestedGroupName })}`
                    : ` ${t('chat.nameOkHint')}`}
                </div>
              </div>

              {degradedSkills.length > 0 && (
                <div className="rounded-xl border border-border bg-background p-5">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                    <AlertCircle className="size-4 text-amber-500" />
                    {t('chat.skillExportIncomplete')}
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    {degradedSkills.map((skill) => (
                      <div key={skill.slug} className="rounded-lg bg-orange-50 px-3 py-2 text-orange-700">
                        {t('chat.skillExportIncompleteReason', { slug: skill.slug, reason: skill.reason })}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-between gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => {
              if (step === 1) {
                handleClose()
                return
              }
              setStep(1)
            }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {step === 1 ? t('common.cancel') : t('chat.prevStep')}
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
                {t('chat.startPreview')}
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={handleConfirmImport}
                disabled={!preview || importing}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t('chat.confirmImport')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
