import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, GitBranch, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { chatRoomApi, type GitBranchStatus } from '@/lib/agent-api'
import { filterGitBranches } from '@/lib/git-branch'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

interface GitBranchSwitcherProps {
  chatRoomId: string
  workDir?: string | null
  className?: string
}

// 后台轮询间隔：用户可能在终端里切换分支，界面需要定期感知
const GIT_BRANCH_POLL_INTERVAL = 5000

// 从工作目录路径取最后一截作为项目名称
function getProjectName(workDir?: string | null): string {
  if (!workDir) return ''
  const segments = workDir.replace(/[/\\]+$/, '').split(/[/\\]+/)
  return segments[segments.length - 1] ?? ''
}

// 判断两次拉取到的 git 状态是否有实质变化，避免无意义的重渲染
function isSameGitStatus(a: GitBranchStatus | null, b: GitBranchStatus | null) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.isGitRepo !== b.isGitRepo) return false
  if (a.currentBranch !== b.currentBranch) return false
  const aNames = a.branches.map((branch) => branch.name).join('\n')
  const bNames = b.branches.map((branch) => branch.name).join('\n')
  return aNames === bNames
}

export function GitBranchSwitcher({ chatRoomId, workDir, className }: GitBranchSwitcherProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<GitBranchStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [branchQuery, setBranchQuery] = useState('')
  // 后台轮询期间避免覆盖正在进行的手动切换
  const switchingRef = useRef<string | null>(null)
  switchingRef.current = switchingBranch

  const loadStatus = async () => {
    setLoading(true)
    try {
      const response = await chatRoomApi.getGitStatus(chatRoomId)
      if (response.success && response.data) {
        setStatus(response.data)
      } else {
        setStatus(null)
      }
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setStatus(null)
      setLoading(true)
      try {
        const response = await chatRoomApi.getGitStatus(chatRoomId)
        if (cancelled) return
        setStatus(response.success && response.data ? response.data : null)
      } catch {
        if (!cancelled) setStatus(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [chatRoomId, workDir])

  // 后台静默轮询：用户可能在终端里切换分支，定期同步而不显示 loading
  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      // 正在手动切换时跳过本轮，避免覆盖即时结果
      if (switchingRef.current) return
      try {
        const response = await chatRoomApi.getGitStatus(chatRoomId)
        if (cancelled || switchingRef.current) return
        const next = response.success && response.data ? response.data : null
        setStatus((prev) => (isSameGitStatus(prev, next) ? prev : next))
      } catch {
        // 轮询失败保持当前状态，不打断用户
      }
    }

    const timer = window.setInterval(() => {
      void poll()
    }, GIT_BRANCH_POLL_INTERVAL)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [chatRoomId, workDir])

  const handleSwitchBranch = async (branch: string) => {
    if (branch === status?.currentBranch) return

    setSwitchingBranch(branch)
    try {
      const response = await chatRoomApi.switchGitBranch(chatRoomId, branch)
      if (response.success && response.data) {
        setStatus(response.data)
      } else {
        toast.error(response.error || t('cron.switchBranchFailed'))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('cron.switchBranchFailed'))
    } finally {
      setSwitchingBranch(null)
    }
  }

  const filteredBranches = useMemo(
    () => filterGitBranches(status?.branches ?? [], branchQuery),
    [branchQuery, status?.branches]
  )

  if (!status?.isGitRepo || !status.currentBranch) {
    return null
  }

  const currentBranch = status.currentBranch
  const hasBranches = filteredBranches.length > 0
  // 仅展示用户自己选择的目录名称；未选（使用默认目录）时不展示
  const projectName = getProjectName(workDir)

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {projectName ? (
        <span
          className="max-w-[10rem] truncate text-xs font-medium text-foreground"
          title={workDir || projectName}
        >
          {projectName}
        </span>
      ) : null}
      <DropdownMenu onOpenChange={(open) => {
        if (open) {
          void loadStatus()
        } else {
          setBranchQuery('')
        }
      }}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex h-7 max-w-[10rem] cursor-pointer items-center gap-1.5 rounded-full bg-muted px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              'focus:outline-none disabled:cursor-default disabled:opacity-60'
            )}
            disabled={loading && !status}
            title={t('cron.currentBranch') + '：' + currentBranch}
          >
            <GitBranch className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{currentBranch}</span>
            {loading || switchingBranch ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <ChevronDown className="size-3.5 shrink-0" />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="top"
          sideOffset={6}
          collisionPadding={12}
          className="flex max-h-[min(80dvh,var(--radix-dropdown-menu-content-available-height))] w-72 flex-col overflow-hidden"
        >
          <div className="shrink-0 p-1">
            <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                placeholder={t('cron.searchBranch')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {hasBranches ? (
            filteredBranches.map((branch) => {
              const isCurrent = branch.name === currentBranch
              const isSwitching = switchingBranch === branch.name
              return (
                <DropdownMenuItem
                  key={branch.name}
                  disabled={isCurrent || switchingBranch !== null}
                  onSelect={() => {
                    void handleSwitchBranch(branch.name)
                  }}
                  className="gap-2"
                >
                  {isSwitching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isCurrent ? (
                    <Check className="size-4 text-blue-500" />
                  ) : (
                    <GitBranch className="size-4" />
                  )}
                  <span className="min-w-0 truncate">{branch.name}</span>
                </DropdownMenuItem>
              )
            })
          ) : (
            <DropdownMenuItem disabled>{branchQuery.trim() ? t('cron.noMatchingBranch') : t('cron.noLocalBranch')}</DropdownMenuItem>
          )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
