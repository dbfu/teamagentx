import { cn } from '@/lib/utils'
import { isElectron } from '@/lib/config'
import { isGroupAssistantAgent } from '@/lib/system-agents'

export const AGENT_AVATAR_COUNT = 30
export const agentAvatarOptions = Array.from({ length: AGENT_AVATAR_COUNT }, (_, index) => index)
const IMAGE_AVATAR_PATTERN = /^(data:image\/|blob:|https?:\/\/|file:\/\/|\/|\.{1,2}\/)/i

// 系统助手（群助手）头像哨兵值：渲染为头像库中的固定头像。
// 后端 system-agent-definitions 把群助手 avatar 写死为该值。
export const SYSTEM_LOGO_AVATAR_VALUE = 'system-logo'

function getSystemAssistantAvatarSrc() {
  // Electron 打包后使用 file:// 协议，需要相对路径；Web 开发模式使用绝对路径。
  return isElectron() ? './avatars/agent_16.png' : '/avatars/agent_16.png'
}

export function getRandomAgentAvatarValue() {
  return String(Math.floor(Math.random() * (AGENT_AVATAR_COUNT - 1)) + 1)
}

function hashAvatarValue(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function normalizeAgentAvatarIndex(avatar: string | number | null | undefined) {
  if (typeof avatar === 'number' && Number.isFinite(avatar)) {
    return Math.abs(Math.trunc(avatar)) % AGENT_AVATAR_COUNT
  }

  if (!avatar) return 0
  const avatarValue = String(avatar)

  if (/^\d+$/.test(avatarValue)) {
    return Number(avatarValue) % AGENT_AVATAR_COUNT
  }

  return hashAvatarValue(avatarValue) % AGENT_AVATAR_COUNT
}

export function isCustomAgentAvatarValue(avatar: string | number | null | undefined) {
  if (typeof avatar === 'number') return false
  if (!avatar) return false

  const avatarValue = String(avatar).trim()
  if (!avatarValue || /^\d+$/.test(avatarValue)) return false

  return IMAGE_AVATAR_PATTERN.test(avatarValue)
}

function getAvatarSrc(index: number) {
  // Electron 打包后使用 file:// 协议，需要相对路径
  // Web 开发模式使用绝对路径
  const basePath = isElectron() ? './avatars' : '/avatars'
  return `${basePath}/agent_${index}.png`
}

interface AgentAvatarImageProps {
  avatar: string | number | null | undefined
  agentId?: string | null
  agentName?: string | null
  agentLevel?: string | null
  className?: string
  alt?: string
}

export function AgentAvatarImage({
  avatar,
  agentId,
  agentName,
  agentLevel,
  className,
  alt = '',
}: AgentAvatarImageProps) {
  const shouldUseSystemAssistantAvatar =
    avatar === SYSTEM_LOGO_AVATAR_VALUE ||
    isGroupAssistantAgent({ id: agentId, name: agentName, agentLevel })

  const src =
    shouldUseSystemAssistantAvatar
      ? getSystemAssistantAvatarSrc()
      : isCustomAgentAvatarValue(avatar)
        ? String(avatar)
        : getAvatarSrc(normalizeAgentAvatarIndex(avatar))

  return (
    <img
      src={src}
      alt={alt || ''}
      draggable={false}
      className={cn(
        'block aspect-square shrink-0 select-none rounded-full object-cover',
        className
      )}
    />
  )
}
