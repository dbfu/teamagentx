import { useEffect, useMemo, useState } from 'react'
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

export function GitBranchSwitcher({ chatRoomId, workDir, className }: GitBranchSwitcherProps) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<GitBranchStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)
  const [branchQuery, setBranchQuery] = useState('')

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

  return (
    <div className={cn('flex items-center', className)}>
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
