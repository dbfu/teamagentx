import { DragEndEvent } from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useUIStore } from '@/stores'
import type { MainNavTab } from '@/stores/ui-store'

const DEFAULT_NAV_ORDER: MainNavTab[] = [
  'message',
  'workbench',
  'assistant',
  'skill',
  'model',
  'connectors',
  'integration',
]

/**
 * 把默认顺序中缺失的导航项（如新增的 connectors）按默认位置补进已持久化的顺序，
 * 保证老用户也能看到新增的一级导航。
 */
function mergeWithDefaults(saved: MainNavTab[]): MainNavTab[] {
  const missing = DEFAULT_NAV_ORDER.filter((tab) => !saved.includes(tab))
  if (missing.length === 0) return saved
  const merged = [...saved]
  for (const tab of missing) {
    const defaultIndex = DEFAULT_NAV_ORDER.indexOf(tab)
    // 找到默认顺序中它前一个、且已存在于 merged 的项，插在其后
    let insertAt = merged.length
    for (let i = defaultIndex - 1; i >= 0; i--) {
      const prevIndex = merged.indexOf(DEFAULT_NAV_ORDER[i])
      if (prevIndex !== -1) {
        insertAt = prevIndex + 1
        break
      }
    }
    merged.splice(insertAt, 0, tab)
  }
  return merged
}

export interface UseNavOrderReturn {
  navOrder: MainNavTab[]
  handleDragEnd: (event: DragEndEvent) => void
}

/**
 * 管理侧边栏导航项排序状态
 */
export function useNavOrder(): UseNavOrderReturn {
  const savedOrder = useUIStore((s) => s.navOrder) || DEFAULT_NAV_ORDER
  const setNavOrder = useUIStore((s) => s.setNavOrder)
  const navOrder = mergeWithDefaults(savedOrder)

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      const oldIndex = navOrder.indexOf(active.id as MainNavTab)
      const newIndex = navOrder.indexOf(over.id as MainNavTab)
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(navOrder, oldIndex, newIndex)
        setNavOrder(newOrder)
      }
    }
  }

  return {
    navOrder,
    handleDragEnd,
  }
}