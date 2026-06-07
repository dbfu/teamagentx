import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { AgentAvatarImage, agentAvatarOptions } from '@/lib/agent-avatars'
import { AvatarSelector } from './avatar-selector'

interface UserAvatarProps {
  avatar: string | number | null | undefined
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeClasses = {
  sm: 'size-7',
  md: 'size-8',
  lg: 'size-10',
  xl: 'size-12',
}

/**
 * 用户头像组件
 * 使用与 Agent 相同的头像系统（数字索引图片）
 */
export function UserAvatar({ avatar, size = 'md', className }: UserAvatarProps) {
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-full', sizeClasses[size], className)}>
      <AgentAvatarImage
        avatar={avatar}
        className="size-full"
      />
    </div>
  )
}

/**
 * 用户头像选择组件
 * 用于注册和设置页面
 */
export function UserAvatarSelector({
  selectedAvatar,
  onSelect,
}: {
  selectedAvatar: string | number | null | undefined
  onSelect: (avatar: string) => void
}) {
  const { t } = useTranslation()
  return (
    <AvatarSelector
      value={selectedAvatar}
      onChange={onSelect}
      options={agentAvatarOptions}
      optionAriaLabel={(index) => t('common.selectAvatarIndex', { index: index + 1 })}
      gridClassName="grid-cols-10"
      itemClassName="size-8"
      selectedItemClassName="scale-110"
      renderAvatar={(avatar, className) => (
        <AgentAvatarImage
          avatar={avatar}
          className={cn('size-7', className === 'size-8' && 'size-7')}
        />
      )}
    />
  )
}
