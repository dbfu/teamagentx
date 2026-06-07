import { ExecutionRecord } from '@/lib/agent-api'
import { cn, formatDateTime, truncateToolName } from '@/lib/utils'
import { History, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface HistoryPanelProps {
  recordsLoading: boolean
  executionRecords: ExecutionRecord[]
  onSelectRecord: (record: ExecutionRecord) => void
}

function getRecordStatusMeta(status: ExecutionRecord['status'], t: (key: string) => string) {
  if (status === 'completed') {
    return {
      label: t('chat.historyPanel.success'),
      className: 'bg-green-500/10 text-green-600 dark:text-green-400',
    }
  }

  if (status === 'cancelled') {
    return {
      label: t('chat.historyPanel.stopped'),
      className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
    }
  }

  return {
    label: t('chat.historyPanel.failed'),
    className: 'bg-destructive/10 text-destructive',
  }
}

export function HistoryPanel({ recordsLoading, executionRecords, onSelectRecord }: HistoryPanelProps) {
  const { t } = useTranslation()

  if (recordsLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-primary mb-2" />
        <span className="text-sm text-muted-foreground">{t('chat.historyPanel.loading')}</span>
      </div>
    )
  }

  if (executionRecords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <History className="size-12 mb-3 opacity-50" />
        <p>{t('chat.historyPanel.noRecords')}</p>
        <p className="text-xs mt-1">{t('chat.historyPanel.triggerAssistantHint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">{t('chat.historyPanel.recordsCount', { count: executionRecords.length })}</div>

      {executionRecords.map((record) => {
        const statusMeta = getRecordStatusMeta(record.status, t)

        return (
          <div
            key={record.id}
            className="rounded-lg border border-border p-3 space-y-2 cursor-pointer hover:bg-accent transition-colors"
            onClick={() => onSelectRecord(record)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                  statusMeta.className,
                )}>
                  {statusMeta.label}
                </span>
                {record.duration && (
                  <span className="text-xs text-muted-foreground">{record.duration}ms</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(record.createdAt)}
              </span>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">{t('chat.historyPanel.triggerMessageColon')}</div>
              <div className="text-xs text-foreground bg-muted rounded p-2 max-h-20 overflow-y-auto">
                {record.triggerMessage.length > 80 ? record.triggerMessage.slice(0, 80) + '...' : record.triggerMessage}
              </div>
            </div>
            {/* 工具调用 */}
            {record.toolCalls && record.toolCalls.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t('chat.historyPanel.toolCallsColon')}</div>
                <div className="space-y-1">
                  {record.toolCalls.slice(0, 2).map((tool, i) => (
                    <div key={i} className={cn(
                      'text-xs rounded p-2 flex',
                      tool.status === 'error' ? 'bg-destructive/10 text-destructive' :
                      tool.status === 'completed' ? 'bg-green-500/10 text-green-600 dark:text-green-400' :
                      'bg-purple-500/10 text-purple-600 dark:text-purple-400'
                    )}>
                      <div className="font-medium truncate flex-1">🔧 {truncateToolName(tool.name)}</div>
                      {tool.status === 'completed' && <span className="ml-1">✓</span>}
                      {tool.status === 'error' && <span className="ml-1">✗</span>}
                    </div>
                  ))}
                  {record.toolCalls.length > 2 && (
                    <div className="text-xs text-muted-foreground text-center">+{record.toolCalls.length - 2} {t('chat.historyPanel.more')}</div>
                  )}
                </div>
              </div>
            )}
            {record.actions.length > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">{t('chat.historyPanel.executionActions')}</div>
                <div className="space-y-1">
                  {record.actions.slice(0, 2).map((action, i) => (
                    <div key={i} className="text-xs text-muted-foreground bg-primary/5 rounded p-2 max-h-20 overflow-y-auto">
                      <span className="font-medium text-primary">[{action.type}]</span>
                      {action.target && <span className="text-purple-600 dark:text-purple-400"> @{action.target}</span>}
                      <div className="mt-1">
                        {action.content.length > 60 ? action.content.slice(0, 60) + '...' : action.content}
                      </div>
                    </div>
                  ))}
                  {record.actions.length > 2 && (
                    <div className="text-xs text-muted-foreground text-center">+{record.actions.length - 2} {t('chat.historyPanel.more')}</div>
                  )}
                </div>
              </div>
            )}
            {record.errorMessage && (
              <div>
                <div className="text-xs text-destructive mb-1">{t('chat.historyPanel.errorMessageColon')}</div>
                <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
                  {record.errorMessage}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
