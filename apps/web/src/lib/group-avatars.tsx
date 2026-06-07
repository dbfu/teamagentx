import { cn } from '@/lib/utils'
import { isElectron } from '@/lib/config'

export const GROUP_AVATAR_COUNT = 24
export const groupAvatarOptions = Array.from({ length: GROUP_AVATAR_COUNT }, (_, index) => index)

export function getRandomGroupAvatarIndex() {
  return Math.floor(Math.random() * (GROUP_AVATAR_COUNT - 1)) + 1
}

function hashAvatarValue(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

export function normalizeGroupAvatarIndex(avatar: string | number | null | undefined) {
  if (typeof avatar === 'number' && Number.isFinite(avatar)) {
    return Math.abs(Math.trunc(avatar)) % GROUP_AVATAR_COUNT
  }

  if (!avatar) return 0
  const avatarValue = String(avatar)

  if (/^\d+$/.test(avatarValue)) {
    return Number(avatarValue) % GROUP_AVATAR_COUNT
  }

  return hashAvatarValue(avatarValue) % GROUP_AVATAR_COUNT
}

function getAvatarSrc(index: number) {
  // Electron 打包后使用 file:// 协议，需要相对路径
  // Web 开发模式使用绝对路径
  const basePath = isElectron() ? './group-avatars' : '/group-avatars'
  return `${basePath}/group_${index}.png`
}

interface GroupAvatarImageProps {
  avatar: string | number | null | undefined
  className?: string
  alt?: string
}

const CUSTOM_AVATAR_PATTERN = /^(data:image\/|blob:|https?:\/\/|file:\/\/|\/|\.{1,2}\/)/i

export function isCustomAvatarUrl(avatar: string | number | null | undefined): avatar is string {
  if (typeof avatar !== 'string') return false
  const v = avatar.trim()
  if (!v || /^\d+$/.test(v)) return false
  return CUSTOM_AVATAR_PATTERN.test(v)
}

export function GroupAvatarImage({ avatar, className, alt = '' }: GroupAvatarImageProps) {
  if (isCustomAvatarUrl(avatar)) {
    return (
      <img
        src={avatar}
        alt={alt || ''}
        draggable={false}
        className={cn('block aspect-square shrink-0 select-none object-cover', className)}
      />
    )
  }

  const index = normalizeGroupAvatarIndex(avatar)
  return (
    <img
      src={getAvatarSrc(index)}
      alt={alt || ''}
      draggable={false}
      className={cn('block aspect-square shrink-0 select-none object-cover', className)}
    />
  )
}
