import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ChatRoom, chatRoomApi } from '@/lib/agent-api'

const STORAGE_KEY = 'selectedChatRoomId'

function readUserId(rawValue: string | null): string | null {
  if (!rawValue) return null

  try {
    const parsed = JSON.parse(rawValue) as { id?: unknown; state?: { user?: { id?: unknown } | null } }
    if (typeof parsed.id === 'string') return parsed.id
    if (typeof parsed.state?.user?.id === 'string') return parsed.state.user.id
    return null
  } catch {
    return null
  }
}

function getCurrentUserIdFromStorage(): string | null {
  if (typeof localStorage === 'undefined') return null

  return readUserId(localStorage.getItem('auth_user'))
    ?? readUserId(localStorage.getItem('auth-storage'))
}

interface LastMessage {
  id: string
  content: string
  time: string
  isHuman: boolean
  userId: string | null
  agentId: string | null
  user: {
    id: string
    username: string
  } | null
  agent: {
    id: string
    name: string
  } | null
}

interface ChatRoomStore {
  chatRooms: ChatRoom[]
  selectedRoomId: string | null
  chatRoomsCacheUserId: string | null
  setChatRooms: (rooms: ChatRoom[]) => void
  selectRoom: (id: string) => void
  addRoom: (room: ChatRoom) => void
  removeRoom: (id: string) => void
  loadChatRooms: () => Promise<void>
  updateRoomLastMessage: (chatRoomId: string, lastMessage: LastMessage | null) => void
}

export const useChatRoomStore = create<ChatRoomStore>()(
  persist(
    (set, get) => ({
      chatRooms: [],
      selectedRoomId: localStorage.getItem(STORAGE_KEY),
      chatRoomsCacheUserId: getCurrentUserIdFromStorage(),

      setChatRooms: (rooms: ChatRoom[]) => {
        set({
          chatRooms: rooms,
          chatRoomsCacheUserId: getCurrentUserIdFromStorage(),
        })
      },

      selectRoom: (id: string) => {
        localStorage.setItem(STORAGE_KEY, id)
        set({ selectedRoomId: id })
      },

      addRoom: (room: ChatRoom) => {
        set((state) => ({
          chatRooms: [...state.chatRooms, room],
        }))
      },

      removeRoom: (id: string) => {
        set((state) => ({
          chatRooms: state.chatRooms.filter((room) => room.id !== id),
          selectedRoomId: state.selectedRoomId === id ? null : state.selectedRoomId,
        }))
      },

      loadChatRooms: async () => {
        const currentUserId = getCurrentUserIdFromStorage()
        if (get().chatRoomsCacheUserId !== currentUserId) {
          localStorage.removeItem(STORAGE_KEY)
          set({
            chatRooms: [],
            selectedRoomId: null,
            chatRoomsCacheUserId: currentUserId,
          })
        }

        const response = await chatRoomApi.getAll()
        if (response.success && response.data) {
          set({
            chatRooms: response.data,
            chatRoomsCacheUserId: currentUserId,
          })
        }
      },

      updateRoomLastMessage: (chatRoomId: string, lastMessage: LastMessage | null) => {
        set((state) => {
          const roomIndex = state.chatRooms.findIndex(room => room.id === chatRoomId)
          if (roomIndex === -1) return state

          const updatedRooms = [...state.chatRooms]
          // 更新 lastMessage 和活动时间，渲染时会按时间排序
          updatedRooms[roomIndex] = {
            ...updatedRooms[roomIndex],
            lastMessage,
            updatedAt: lastMessage?.time ?? new Date().toISOString(),
          }

          return { chatRooms: updatedRooms }
        })
      },
    }),
    {
      name: 'chat-room-storage',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<ChatRoomStore> | undefined
        const currentUserId = getCurrentUserIdFromStorage()
        const shouldRestoreChatRooms = !!currentUserId && persisted?.chatRoomsCacheUserId === currentUserId

        return {
          ...currentState,
          ...persisted,
          chatRooms: shouldRestoreChatRooms ? persisted?.chatRooms ?? [] : [],
          chatRoomsCacheUserId: currentUserId,
        }
      },
      partialize: (state) => ({
        selectedRoomId: state.selectedRoomId,
        chatRooms: state.chatRooms,
        chatRoomsCacheUserId: state.chatRoomsCacheUserId,
      }),
    }
  )
)
