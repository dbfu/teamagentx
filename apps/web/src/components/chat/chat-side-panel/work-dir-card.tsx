import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Check, ChevronDown, Copy, FolderOpen, Loader2, Pencil, X } from 'lucide-react'
import { isElectron } from '@/lib/config'

export type FolderOpenTarget = 'system' | 'vscode' | 'cursor' | 'trae' | 'trae-cn'

export const FOLDER_OPEN_OPTIONS: { target: FolderOpenTarget; label: string }[] = [
  { target: 'system', label: '系统文件夹' },
  { target: 'vscode', label: 'VS Code' },
  { target: 'cursor', label: 'Cursor' },
  { target: 'trae', label: 'Trae' },
  { target: 'trae-cn', label: 'Trae CN' },
]

function getIconPath(target: Exclude<FolderOpenTarget, 'system'>): string {
  const basePath = isElectron() ? './open-target-icons' : '/open-target-icons'
  return `${basePath}/${target}.png`
}

export function FolderOpenTargetIcon({ target }: { target: FolderOpenTarget }) {
  if (target === 'system') {
    return <FolderOpen className="size-4 text-amber-500" />
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
  if (isEditing) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-muted-foreground">留空后恢复为默认生成目录</div>

        <div className="flex gap-2">
          <input
            type="text"
            value={editingWorkDir}
            onChange={(e) => onEditingWorkDirChange(e.target.value)}
            placeholder="输入自定义工作目录"
            className="ta-input flex-1 font-mono"
          />
          {isElectron && (
            <button
              type="button"
              onClick={onSelectFolder}
              className="ta-icon-button"
              title="选择目录"
            >
              <FolderOpen className="size-4" />
            </button>
          )}
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2">
          <div className="text-xs text-muted-foreground">默认目录</div>
          <div className="mt-1 break-all font-mono text-xs text-foreground/80">{defaultWorkDir}</div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={savingSettings}
            className="ta-button-primary"
          >
            {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            保存
          </button>
          <button
            onClick={onCancelEdit}
            className="ta-button-secondary"
          >
            <X className="size-4" />
            取消
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="break-all font-mono text-sm leading-6 text-foreground">
        {displayWorkDir || '未设置'}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {isElectron && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={openingFolder || !displayWorkDir}
                className="ta-button-primary px-3"
                title="选择打开方式"
              >
                <FolderOpen className="size-4" />
                打开
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
          className="ta-button-secondary px-3"
          title="编辑"
        >
          <Pencil className="size-4" />
          编辑
        </button>

        {displayWorkDir && (
          <button
            onClick={onCopy}
            className="ta-button-secondary px-3"
            title="复制地址"
          >
            <Copy className="size-4" />
            复制地址
          </button>
        )}
      </div>
    </div>
  )
}
