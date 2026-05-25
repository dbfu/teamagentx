export const GROUP_ASSISTANT_ID = '4f7c8a91-2d6b-4c8f-9a7e-5b1d2c3e4f60'
export const GROUP_COORDINATOR_ID = '6b375f6f-7fb7-4c7b-9f1b-70a88af1f1a0'

const NON_DETAIL_SYSTEM_AGENT_NAMES = new Set(['群助手', '群调度助手'])
const NON_DETAIL_SYSTEM_AGENT_IDS = new Set([GROUP_ASSISTANT_ID, GROUP_COORDINATOR_ID])

export function isSystemAssistantDetailBlocked(agent?: {
  id?: string | null
  name?: string | null
  agentLevel?: string | null
} | null): boolean {
  if (!agent) return false
  if (agent.id && NON_DETAIL_SYSTEM_AGENT_IDS.has(agent.id)) return true
  if (agent.name && NON_DETAIL_SYSTEM_AGENT_NAMES.has(agent.name)) return true
  return agent.agentLevel === 'system' && agent.name ? NON_DETAIL_SYSTEM_AGENT_NAMES.has(agent.name) : false
}
