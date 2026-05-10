import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ChatRoom, chatRoomApi } from '@/lib/agent-api'

const STORAGE_KEY = 'selectedChatRoomId'

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
  setChatRooms: (rooms: ChatRoom[]) => void
  selectRoom: (id: string) => void
  addRoom: (room: ChatRoom) => void
  removeRoom: (id: string) => void
  loadChatRooms: () => Promise<void>
  updateRoomLastMessage: (chatRoomId: string, lastMessage: LastMessage) => void
}

export const useChatRoomStore = create<ChatRoomStore>()(
  persist(
    (set, _get) => ({
      chatRooms: [],
      selectedRoomId: localStorage.getItem(STORAGE_KEY),

      setChatRooms: (rooms: ChatRoom[]) => {
        set({ chatRooms: rooms })
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
        const response = await chatRoomApi.getAll()
        if (response.success && response.data) {
          set({ chatRooms: response.data })
        }
      },

      updateRoomLastMessage: (chatRoomId: string, lastMessage: LastMessage) => {
        set((state) => {
          const roomIndex = state.chatRooms.findIndex(room => room.id === chatRoomId)
          if (roomIndex === -1) return state

          const updatedRooms = [...state.chatRooms]
          // 只更新 lastMessage，不移动位置（渲染时会按时间排序）
          updatedRooms[roomIndex] = {
            ...updatedRooms[roomIndex],
            lastMessage,
          }

          return { chatRooms: updatedRooms }
        })
      },
    }),
    {
      name: 'chat-room-storage',
      partialize: (state) => ({
        selectedRoomId: state.selectedRoomId,
      }),
    }
  )
)