import { create } from 'zustand'
import { chatRoomCommandApi, type ChatRoomCommand } from '@/lib/chatroom-command-api'

interface CustomCommandState {
  // 按群聊 ID 缓存的自定义指令列表
  commandsByRoom: Record<string, ChatRoomCommand[]>
  loadingByRoom: Record<string, boolean>
  // 加载某群聊的自定义指令
  loadCommands: (chatRoomId: string) => Promise<void>
  // 直接设置（创建/更新/删除后用于本地同步）
  setCommands: (chatRoomId: string, commands: ChatRoomCommand[]) => void
}

export const useCustomCommandStore = create<CustomCommandState>((set, get) => ({
  commandsByRoom: {},
  loadingByRoom: {},

  loadCommands: async (chatRoomId: string) => {
    if (!chatRoomId) return
    if (get().loadingByRoom[chatRoomId]) return
    set((s) => ({ loadingByRoom: { ...s.loadingByRoom, [chatRoomId]: true } }))
    try {
      const commands = await chatRoomCommandApi.list(chatRoomId)
      set((s) => ({ commandsByRoom: { ...s.commandsByRoom, [chatRoomId]: commands } }))
    } catch (error) {
      console.error('加载自定义指令失败:', error)
    } finally {
      set((s) => ({ loadingByRoom: { ...s.loadingByRoom, [chatRoomId]: false } }))
    }
  },

  setCommands: (chatRoomId: string, commands: ChatRoomCommand[]) => {
    set((s) => ({ commandsByRoom: { ...s.commandsByRoom, [chatRoomId]: commands } }))
  },
}))
