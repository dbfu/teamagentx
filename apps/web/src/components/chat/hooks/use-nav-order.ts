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
  'integration',
]

export interface UseNavOrderReturn {
  navOrder: MainNavTab[]
  handleDragEnd: (event: DragEndEvent) => void
}

/**
 * 管理侧边栏导航项排序状态
 */
export function useNavOrder(): UseNavOrderReturn {
  const navOrder = useUIStore((s) => s.navOrder) || DEFAULT_NAV_ORDER
  const setNavOrder = useUIStore((s) => s.setNavOrder)

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