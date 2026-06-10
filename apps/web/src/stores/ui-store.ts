import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as React from 'react'
import type { ToastActionElement, ToastProps } from '@/components/ui/toast'
import { DEFAULT_TERMINAL_OPEN_TARGET, type TerminalOpenTarget } from '@/lib/open-targets'

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 5000 // 5 seconds

// 主导航项类型
export type MainNavTab = 'message' | 'workbench' | 'assistant' | 'skill' | 'model' | 'integration'

// 默认导航顺序
const DEFAULT_NAV_ORDER: MainNavTab[] = [
  'message',
  'workbench',
  'assistant',
  'skill',
  'model',
  'integration',
]

type ToasterToast = ToastProps & {
  id: string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: ToastActionElement
}

interface UIStore {
  // Toast 状态
  toasts: ToasterToast[]

  // Dialog 状态
  showLogin: boolean
  showRegister: boolean

  // 提示音设置
  soundEnabled: boolean

  // 群聊里是否显示当前分支
  showGitBranch: boolean

  // 终端打开方式
  terminalOpenTarget: TerminalOpenTarget

  // 导航项顺序
  navOrder: MainNavTab[]

  // Actions
  addToast: (toast: Omit<ToasterToast, 'id'>) => { id: string; dismiss: () => void; update: (props: ToasterToast) => void }
  updateToast: (toast: Partial<ToasterToast> & { id: string }) => void
  dismissToast: (toastId?: string) => void
  removeToast: (toastId?: string) => void
  setShowLogin: (show: boolean) => void
  setShowRegister: (show: boolean) => void
  setSoundEnabled: (enabled: boolean) => void
  setShowGitBranch: (show: boolean) => void
  setTerminalOpenTarget: (target: TerminalOpenTarget) => void
  setNavOrder: (order: MainNavTab[]) => void
}

// Toast ID 生成器
let count = 0
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

// Toast timeout 管理
const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

const addToRemoveQueue = (toastId: string, removeToast: (toastId?: string) => void) => {
  if (toastTimeouts.has(toastId)) {
    return
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    removeToast(toastId)
  }, TOAST_REMOVE_DELAY)

  toastTimeouts.set(toastId, timeout)
}

export const useUIStore = create<UIStore>()(
  persist(
    (set, get) => ({
      toasts: [],
      showLogin: false,
      showRegister: false,
      soundEnabled: true, // 默认开启提示音
      showGitBranch: true, // 默认在群聊里显示当前分支
      terminalOpenTarget: DEFAULT_TERMINAL_OPEN_TARGET,
      navOrder: DEFAULT_NAV_ORDER, // 默认导航顺序

      addToast: (toastProps) => {
        const id = genId()

        const dismiss = () => get().dismissToast(id)

        const newToast: ToasterToast = {
          ...toastProps,
          id,
          open: true,
          onOpenChange: (open) => {
            if (!open) dismiss()
          },
        }

        set((state) => ({
          toasts: [newToast, ...state.toasts].slice(0, TOAST_LIMIT),
        }))

        return {
          id,
          dismiss,
          update: (props) => get().updateToast({ ...props, id }),
        }
      },

      updateToast: (toast) => {
        set((state) => ({
          toasts: state.toasts.map((t) =>
            t.id === toast.id ? { ...t, ...toast } : t
          ),
        }))
      },

      dismissToast: (toastId) => {
        const { removeToast } = get()

        if (toastId) {
          addToRemoveQueue(toastId, removeToast)
        } else {
          get().toasts.forEach((toast) => {
            addToRemoveQueue(toast.id, removeToast)
          })
        }

        set((state) => ({
          toasts: state.toasts.map((t) =>
            t.id === toastId || toastId === undefined
              ? {
                  ...t,
                  open: false,
                }
              : t
          ),
        }))
      },

      removeToast: (toastId) => {
        set((state) => {
          if (toastId === undefined) {
            return { toasts: [] }
          }
          return {
            toasts: state.toasts.filter((t) => t.id !== toastId),
          }
        })
      },

      setShowLogin: (show) => set({ showLogin: show }),
      setShowRegister: (show) => set({ showRegister: show }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setShowGitBranch: (show) => set({ showGitBranch: show }),
      setTerminalOpenTarget: (target) => set({ terminalOpenTarget: target }),
      setNavOrder: (order) => set({ navOrder: order }),
    }),
    {
      name: 'ui-settings',
      partialize: (state) => ({
        soundEnabled: state.soundEnabled,
        showGitBranch: state.showGitBranch,
        terminalOpenTarget: state.terminalOpenTarget,
        navOrder: state.navOrder,
      }),
    }
  )
)

// 导出 toast 函数以便在组件外使用
export function toast(props: Omit<ToasterToast, 'id'>) {
  return useUIStore.getState().addToast(props)
}
