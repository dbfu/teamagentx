import { cn } from '@/lib/utils'
import { isElectron } from '@/lib/config'

export const AGENT_AVATAR_COUNT = 30
export const agentAvatarOptions = Array.from({ length: AGENT_AVATAR_COUNT }, (_, index) => index)

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

function getAvatarSrc(index: number) {
  // Electron 打包后使用 file:// 协议，需要相对路径
  // Web 开发模式使用绝对路径
  const basePath = isElectron() ? './avatars' : '/avatars'
  return `${basePath}/agent_${index}.png`
}

interface AgentAvatarImageProps {
  avatar: string | number | null | undefined
  className?: string
  alt?: string
}

export function AgentAvatarImage({ avatar, className, alt = '' }: AgentAvatarImageProps) {
  const index = normalizeAgentAvatarIndex(avatar)

  return (
    <img
      src={getAvatarSrc(index)}
      alt={alt || ''}
      draggable={false}
      className={cn('block aspect-square shrink-0 select-none object-cover', className)}
    />
  )
}
