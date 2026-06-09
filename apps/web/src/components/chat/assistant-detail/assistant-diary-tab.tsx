import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { agentApi, settingsApi, type Agent } from '@/lib/agent-api'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AgentAvatar } from '../agent-avatar'
import { MarkdownContent } from '../markdown-content'

interface AssistantDiaryTabProps {
  agent: Agent
}

/** 从日记正文里解析出「心情：xxx」首行，返回 [心情, 去掉心情行的正文] */
function parseMood(content: string): { mood: string | null; body: string } {
  const lines = content.split('\n')
  const first = lines[0]?.trim() ?? ''
  const match = first.match(/^心情[:：]\s*(.+)$/)
  if (match) {
    return { mood: match[1].trim(), body: lines.slice(1).join('\n').trim() }
  }
  return { mood: null, body: content }
}

export function AssistantDiaryTab({ agent }: AssistantDiaryTabProps) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)

  const loadDates = useCallback(async () => {
    const res = await agentApi.getDiaryDates(agent.id)
    if (res.success && res.data) {
      setDates(res.data.dates)
      return res.data.dates
    }
    return [] as string[]
  }, [agent.id])

  const loadContent = useCallback(async (date: string) => {
    setLoadingContent(true)
    try {
      const res = await agentApi.getDiary(agent.id, date)
      setContent(res.success && res.data ? res.data.content : '')
    } catch {
      toast.error(t('assistant.diaryLoadFailed'))
    } finally {
      setLoadingContent(false)
    }
  }, [agent.id, t])

  // 初始化：读全局开关 + 日期列表
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setLoading(true)
      try {
        const settingRes = await settingsApi.get('diaryEnabled')
        const isEnabled = settingRes.success && settingRes.data?.value === 'true'
        if (cancelled) return
        setEnabled(isEnabled)
        if (isEnabled) {
          const list = await loadDates()
          if (cancelled) return
          if (list.length > 0) {
            setSelectedDate(list[0])
            await loadContent(list[0])
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [agent.id, loadDates, loadContent])

  const handleSelectDate = (date: string) => {
    setSelectedDate(date)
    loadContent(date)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    )
  }

  // 全局开关关闭
  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center max-w-md mx-auto">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <BookOpen className="size-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">{t('assistant.diaryDisabledHint')}</p>
      </div>
    )
  }

  const { mood, body } = parseMood(content)

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-4">
      {dates.length === 0 ? (
        <div className="flex h-full min-h-0 flex-col items-center justify-center text-center">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <BookOpen className="size-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">{t('assistant.diaryEmpty')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* 日期列表 */}
          <div className="flex min-h-0 w-32 shrink-0 flex-col gap-1 overflow-y-auto pr-1">
            {dates.map((date) => (
              <button
                key={date}
                onClick={() => handleSelectDate(date)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  selectedDate === date
                    ? 'bg-blue-500/10 text-blue-600 font-medium'
                    : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {date}
              </button>
            ))}
          </div>

          {/* 日记卡片 */}
          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex shrink-0 items-center gap-3 border-b border-border pb-4">
              <AgentAvatar
                avatar={agent.avatar}
                avatarColor={agent.avatarColor}
                agentLevel={agent.agentLevel}
                size="md"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{agent.name}</span>
                  {mood && (
                    <Badge variant="outline" className="gap-1 bg-amber-50 text-amber-700 border-amber-200">
                      {t('assistant.diaryMood')}：{mood}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{selectedDate}</div>
              </div>
            </div>

            {loadingContent ? (
              <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-sm">{t('common.loading')}</span>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm leading-relaxed">
                <MarkdownContent content={body} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
