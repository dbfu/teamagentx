export type PersistedWorkspaceFileState = {
  root: string
  openPaths: string[]
  activePath: string
}

export const WORKSPACE_FILE_TREE_WIDTH_STORAGE_KEY = 'teamagentx.workspaceFileTree.width'
export const DEFAULT_FILE_TREE_WIDTH = 32
export const MIN_FILE_TREE_WIDTH = 22
export const MAX_FILE_TREE_WIDTH = 48

const WORKSPACE_FILE_STATE_STORAGE_KEY = 'teamagentx.workspace-file-state'
const MAX_PERSISTED_OPEN_FILES = 100

export function clampFileTreeWidth(width: number): number {
  return Math.min(Math.max(width, MIN_FILE_TREE_WIDTH), MAX_FILE_TREE_WIDTH)
}

export function readStoredFileTreeWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_FILE_TREE_WIDTH

  try {
    const raw = window.localStorage.getItem(WORKSPACE_FILE_TREE_WIDTH_STORAGE_KEY)
    if (!raw) return DEFAULT_FILE_TREE_WIDTH
    const stored = Number(raw)
    return Number.isFinite(stored) ? clampFileTreeWidth(stored) : DEFAULT_FILE_TREE_WIDTH
  } catch {
    return DEFAULT_FILE_TREE_WIDTH
  }
}

function workspaceFileStateStorageKey(chatRoomId: string): string {
  return `${WORKSPACE_FILE_STATE_STORAGE_KEY}:${encodeURIComponent(chatRoomId)}`
}

export function readPersistedWorkspaceFileState(chatRoomId: string): PersistedWorkspaceFileState | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(workspaceFileStateStorageKey(chatRoomId))
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    if (typeof record.root !== 'string' || !Array.isArray(record.openPaths)) return null

    const openPaths = [...new Set(
      record.openPaths.filter((path): path is string => typeof path === 'string'),
    )].slice(-MAX_PERSISTED_OPEN_FILES)
    const activePath = typeof record.activePath === 'string' && openPaths.includes(record.activePath)
      ? record.activePath
      : openPaths.at(-1) ?? ''

    return { root: record.root, openPaths, activePath }
  } catch {
    return null
  }
}

export function persistWorkspaceFileState(chatRoomId: string, state: PersistedWorkspaceFileState): void {
  if (typeof window === 'undefined') return

  try {
    const storageKey = workspaceFileStateStorageKey(chatRoomId)
    if (state.openPaths.length === 0) {
      window.localStorage.removeItem(storageKey)
      return
    }

    const openPaths = state.openPaths.slice(-MAX_PERSISTED_OPEN_FILES)
    const activePath = openPaths.includes(state.activePath) ? state.activePath : openPaths.at(-1) ?? ''

    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      ...state,
      openPaths,
      activePath,
    }))
  } catch {
    // Ignore storage failures; opening files should still work for this session.
  }
}
