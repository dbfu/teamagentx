import { cn } from '@/lib/utils'
import { AgentAvatarImage } from '@/lib/agent-avatars'
import { Star } from 'lucide-react'

interface AgentAvatarProps {
  avatar: string | null
  agentId?: string | null
  agentName?: string | null
  avatarColor?: string | null
  agentLevel?: 'normal' | 'system'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showSystemBadge?: boolean
}

const sizeClasses = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
  xl: 'size-20',
}

const badgeSizeClasses = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
  xl: 'size-6',
}

const iconSizeClasses = {
  sm: 'size-2',
  md: 'size-2.5',
  lg: 'size-3',
  xl: 'size-3.5',
}

export function AgentAvatar({
  avatar,
  agentId,
  agentName,
  agentLevel = 'normal',
  size = 'md',
  className,
  showSystemBadge = true,
}: AgentAvatarProps) {
  return (
    <div className={cn('relative shrink-0', sizeClasses[size], className)}>
      <AgentAvatarImage
        avatar={avatar}
        agentId={agentId}
        agentName={agentName}
        agentLevel={agentLevel}
        className="size-full"
      />
      {/* 系统助手标识 - 橙色星标 */}
      {showSystemBadge && agentLevel === 'system' && (
        <div
          className={cn(
            'absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-orange-500',
            badgeSizeClasses[size]
          )}
        >
          <Star className={cn('text-white fill-white', iconSizeClasses[size])} />
        </div>
      )}
    </div>
  )
}
