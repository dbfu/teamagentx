export type FolderOpenTarget = 'system' | 'terminal' | 'vscode' | 'cursor' | 'trae' | 'trae-cn'

export type TerminalOpenTarget =
  | 'terminal-app'
  | 'iterm2'
  | 'alacritty'
  | 'kitty'
  | 'ghostty'
  | 'wezterm'
  | 'kaku'

export const DEFAULT_TERMINAL_OPEN_TARGET: TerminalOpenTarget = 'terminal-app'

export const FOLDER_OPEN_OPTIONS: { target: FolderOpenTarget; label: string }[] = [
  { target: 'system', label: '系统文件夹' },
  { target: 'terminal', label: '终端' },
  { target: 'vscode', label: 'VS Code' },
  { target: 'cursor', label: 'Cursor' },
  { target: 'trae', label: 'Trae' },
  { target: 'trae-cn', label: 'Trae CN' },
]

export const TERMINAL_OPEN_OPTIONS: { target: TerminalOpenTarget; label: string }[] = [
  { target: 'terminal-app', label: 'Terminal.app' },
  { target: 'iterm2', label: 'iTerm2' },
  { target: 'alacritty', label: 'Alacritty' },
  { target: 'kitty', label: 'Kitty' },
  { target: 'ghostty', label: 'Ghostty' },
  { target: 'wezterm', label: 'WezTerm' },
  { target: 'kaku', label: 'Kaku' },
]
