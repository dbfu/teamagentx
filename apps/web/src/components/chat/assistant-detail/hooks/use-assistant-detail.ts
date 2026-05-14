import { useState, useEffect, useCallback } from 'react'
import { agentApi, Agent, QuickChatSession } from '@/lib/agent-api'
import { skillApi, InstalledSkill } from '@/lib/skill-api'
import { useChatStore } from '@/stores/chat-store'

interface AssistantDetailState {
  agent: Agent | null
  skills: InstalledSkill[]
  quickChatRooms: QuickChatSession[]
  quickChatCount: number
  loading: boolean
  error: string | null
}

export function useAssistantDetail(agentId: string) {
  const [state, setState] = useState<AssistantDetailState>({
    agent: null,
    skills: [],
    quickChatRooms: [],
    quickChatCount: 0,
    loading: true,
    error: null,
  })

  const loadData = useCallback(async () => {
    if (!agentId) return

    setState(prev => ({ ...prev, loading: true, error: null }))

    // 加载 Agent 数据
    const agentRes = await agentApi.getById(agentId)
    if (!agentRes.success || !agentRes.data) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: agentRes.error || '加载助手失败',
      }))
      return
    }

    const agent = agentRes.data

    // 加载 Skills
    let skills: InstalledSkill[] = []
    const skillsRes = await skillApi.getInstalled(agentId)
    if (skillsRes.success && skillsRes.data) {
      skills = skillsRes.data
    }

    // 加载快速对话数量（需要用户 ID，暂时不加载）
    setState({
      agent,
      skills,
      quickChatRooms: [],
      quickChatCount: 0,
      loading: false,
      error: null,
    })
  }, [agentId])

  // 初始加载
  useEffect(() => {
    loadData()
  }, [loadData])

  // 页面重新聚焦时刷新技能列表（用户从聊天页面返回时）
  useEffect(() => {
    const handleFocus = () => {
      if (agentId) {
        skillApi.getInstalled(agentId).then(res => {
          if (res.success && res.data) {
            setState(prev => ({ ...prev, skills: res.data! }))
          }
        })
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [agentId])

  // 刷新 Skills
  const refreshSkills = useCallback(async () => {
    if (!agentId) return

    const res = await skillApi.getInstalled(agentId)
    if (res.success && res.data) {
      setState(prev => ({ ...prev, skills: res.data! }))
    }
  }, [agentId, state.agent?.type])

  // 刷新 Agent 数据
  const refreshAgent = useCallback(async (nextAgent?: Agent) => {
    if (!agentId) return

    if (nextAgent) {
      setState(prev => ({ ...prev, agent: nextAgent }))
      await useChatStore.getState().loadAllAgents()
      return
    }

    const res = await agentApi.getById(agentId)
    if (res.success && res.data) {
      setState(prev => ({ ...prev, agent: res.data! }))
      await useChatStore.getState().loadAllAgents()
    }
  }, [agentId])

  // 卸载 Skill
  const uninstallSkill = useCallback(async (slug: string) => {
    const res = await skillApi.uninstall(agentId, slug)
    if (res.success) {
      await refreshSkills()
      return true
    }
    return false
  }, [agentId, refreshSkills])

  // 更新状态
  const updateStatus = useCallback(async (isActive: boolean) => {
    const res = await agentApi.updateStatus(agentId, isActive)
    if (res.success && res.data) {
      setState(prev => ({ ...prev, agent: res.data! }))
      await useChatStore.getState().loadAllAgents()
      return true
    }
    return false
  }, [agentId])

  return {
    ...state,
    loadData,
    refreshSkills,
    refreshAgent,
    uninstallSkill,
    updateStatus,
  }
}
