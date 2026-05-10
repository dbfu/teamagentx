import { cn } from '@/lib/utils'
import { AgentAvatarImage, agentAvatarOptions } from '@/lib/agent-avatars'

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
  selectedIndex,
  onSelect,
}: {
  selectedIndex: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="grid max-h-40 grid-cols-10 gap-1 overflow-y-auto rounded-lg border border-border bg-background p-2">
      {agentAvatarOptions.map((index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSelect(index)}
          className={cn(
            'flex size-8 items-center justify-center rounded-lg transition-all overflow-hidden',
            selectedIndex === index
              ? 'ring-2 ring-primary ring-offset-1 scale-110'
              : 'hover:scale-105'
          )}
        >
          <AgentAvatarImage
            avatar={index}
            className="size-7"
          />
        </button>
      ))}
    </div>
  )
}
