import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FOLDER_OPEN_OPTIONS, type FolderOpenTarget } from '@/lib/open-targets'
import { Check, ChevronDown, Copy, FolderOpen, Loader2, Pencil, Terminal, X } from 'lucide-react'
import { isElectron } from '@/lib/config'
import { useTranslation } from 'react-i18next'

export { FOLDER_OPEN_OPTIONS, type FolderOpenTarget } from '@/lib/open-targets'

function getIconPath(target: Exclude<FolderOpenTarget, 'system' | 'terminal'>): string {
  const basePath = isElectron() ? './open-target-icons' : '/open-target-icons'
  return `${basePath}/${target}.png`
}

export function FolderOpenTargetIcon({ target }: { target: FolderOpenTarget }) {
  if (target === 'system') {
    return <FolderOpen className="size-4 text-amber-500" />
  }

  if (target === 'terminal') {
    return <Terminal className="size-4 text-slate-600" />
  }

  return <img src={getIconPath(target)} alt={target} className="size-4 shrink-0 rounded-[4px]" />
}

interface WorkDirCardProps {
  displayWorkDir: string
  defaultWorkDir: string
  isEditing: boolean
  editingWorkDir: string
  isElectron: boolean
  openingFolder: boolean
  savingSettings: boolean
  onEditingWorkDirChange: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onSelectFolder: () => void
  onOpenFolder: (target?: FolderOpenTarget) => void
  onCopy: () => void
}

export function WorkDirCard({
  displayWorkDir,
  defaultWorkDir,
  isEditing,
  editingWorkDir,
  isElectron,
  openingFolder,
  savingSettings,
  onEditingWorkDirChange,
  onStartEdit,
  onCancelEdit,
  onSave,
  onSelectFolder,
  onOpenFolder,
  onCopy,
}: WorkDirCardProps) {
  const { t } = useTranslation()

  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">{t('chat.workDirEmptyHint')}</div>

        <div className="flex gap-2">
          <input
            type="text"
            value={editingWorkDir}
            onChange={(e) => onEditingWorkDirChange(e.target.value)}
            placeholder={t('chat.workDirPlaceholder')}
            className="flex-1 rounded-lg border border-gray-200 bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:outline-none"
          />
          {isElectron && (
            <button
              type="button"
              onClick={onSelectFolder}
              className="flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-gray-600 hover:bg-gray-50"
              title={t('chat.workDirSelectFolder')}
            >
              <FolderOpen className="size-4" />
            </button>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
          <div className="text-xs text-muted-foreground">{t('chat.workDirDefaultLabel')}</div>
          <div className="mt-1 break-all font-mono text-xs text-foreground/80">{defaultWorkDir}</div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={savingSettings}
            className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t('common.save')}
          </button>
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            <X className="size-4" />
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="break-all font-mono text-sm leading-6 text-foreground">
        {displayWorkDir || t('chat.workDirNotSet')}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isElectron && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={openingFolder || !displayWorkDir}
                className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
              >
                <FolderOpen className="size-4" />
                {t('chat.workDirOpen')}
                <ChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-36">
              {FOLDER_OPEN_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.target} onClick={() => onOpenFolder(option.target)}>
                  <FolderOpenTargetIcon target={option.target} />
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          onClick={onStartEdit}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <Pencil className="size-4" />
          {t('chat.workDirEdit')}
        </button>

        {displayWorkDir && (
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
            <Copy className="size-4" />
            {t('chat.workDirCopyPath')}
          </button>
        )}
      </div>
    </div>
  )
}
