import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ExecutionEvent, ExecutionRecord, ThinkingRecord } from '@/lib/agent-api'
import { tokenUsageApi } from '@/lib/token-usage-api'
import { cn, coerceThinkingText, formatDateTime, truncateToolName } from '@/lib/utils'
import { CheckCircle, ChevronDown, ChevronRight, CircleStop, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MarkdownContent } from '../markdown-content'
import { CodeEditToolContent, CodeReadToolOutput, isCodeEditTool, isCodeReadTool, renderToolValue } from './tool-call-content'

const SHOW_EXECUTION_CONTEXT = import.meta.env.VITE_SHOW_EXECUTION_CONTEXT !== 'false'

// 格式化耗时显示（1m40s 格式，分钟为0时只显示秒）
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m${seconds}s`
}

function CollapsibleStateIcon({ className }: { className?: string }) {
  return (
    <>
      <ChevronRight className={cn('size-3 text-muted-foreground group-data-[state=open]:hidden', className)} />
      <ChevronDown className={cn('hidden size-3 text-muted-foreground group-data-[state=open]:block', className)} />
    </>
  )
}

// 将执行记录转换为按时间排序的事件列表
function buildExecutionEvents(record: ExecutionRecord): ExecutionEvent[] {
  // 直接使用新的 events 字段
  if (record.events && record.events.length > 0) {
    return [...record.events].sort((a, b) => a.timestamp - b.timestamp)
  }

  // 兼容旧数据：从旧字段构建事件
  const events: ExecutionEvent[] = []

  // 添加思考过程
  if (record.thinking) {
    const thinkingData: ThinkingRecord = typeof record.thinking === 'string'
      ? { content: record.thinking, timestamp: Date.now() }
      : record.thinking
    events.push({
      type: 'thinking',
      timestamp: thinkingData.timestamp,
      data: { content: thinkingData.content },
    })
  }

  // 添加工具调用
  if (record.toolCalls) {
    for (const tool of record.toolCalls) {
      events.push({
        type: 'tool_call',
        timestamp: tool.timestamp || Date.now(),
        data: {
          name: tool.name,
          input: tool.input,
          output: tool.output,
          status: tool.status,
          toolCallId: tool.toolCallId,
        },
      })
    }
  }

  // 添加输出内容
  if (record.actions) {
    for (const action of record.actions) {
      events.push({
        type: 'output',
        timestamp: action.timestamp || Date.now(),
        data: {
          content: action.content,
          type: action.type,
          target: action.target,
        },
      })
    }
  }

  // 按时间戳排序
  events.sort((a, b) => a.timestamp - b.timestamp)

  return events
}

interface RecordDetailPanelProps {
  selectedRecord: ExecutionRecord
}

export function RecordDetailPanel({ selectedRecord }: RecordDetailPanelProps) {
  const { t } = useTranslation()
  const isSuccess = selectedRecord.status === 'completed'
  const isCancelled = selectedRecord.status === 'cancelled'
  const events = buildExecutionEvents(selectedRecord)
  const statusClassName = isSuccess
    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
    : isCancelled
      ? 'bg-gray-500/10 text-gray-600 dark:text-gray-400'
      : 'bg-red-500/10 text-red-600 dark:text-red-400'

  return (
    <div className="space-y-3 text-sm">
      {/* 执行状态 + 耗时和时间 */}
      <div className={cn(
        'flex items-center justify-between rounded-lg px-3 py-2',
        statusClassName
      )}>
        <div className="flex items-center gap-2">
          {isSuccess ? (
            <>
              <CheckCircle className="size-4" />
              <span className="font-medium">{t('cron.executionSuccess')}</span>
            </>
          ) : isCancelled ? (
            <>
              <CircleStop className="size-4" />
              <span className="font-medium">{t('execution.manuallyStopped')}</span>
            </>
          ) : (
            <>
              <XCircle className="size-4" />
              <span className="font-medium">{t('cron.executionFailed')}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {selectedRecord.duration && <span>{t('chat.duration')}：{formatDuration(selectedRecord.duration)}</span>}
          <span>{formatDateTime(selectedRecord.createdAt)}</span>
        </div>
      </div>

      {/* Token 使用信息 */}
      {selectedRecord.totalTokens && selectedRecord.totalTokens > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2">
          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1.5">{t('execution.tokenUsage')}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-blue-600 dark:text-blue-400">
              <span className="text-blue-500 dark:text-blue-300">{t('execution.totalTokens')}</span> {tokenUsageApi.formatTokens(selectedRecord.totalTokens)}
            </span>
            <span className="text-blue-500 dark:text-blue-400">
              <span className="text-blue-400 dark:text-blue-300">{t('execution.inputTokens')}</span> {tokenUsageApi.formatTokens(selectedRecord.inputTokens || 0)}
            </span>
            <span className="text-blue-500 dark:text-blue-400">
              <span className="text-blue-400 dark:text-blue-300">{t('execution.outputTokens')}</span> {tokenUsageApi.formatTokens(selectedRecord.outputTokens || 0)}
            </span>
            {selectedRecord.cacheReadTokens && selectedRecord.cacheReadTokens > 0 && (
              <span className="text-green-600 dark:text-green-400">
                <span className="text-green-500 dark:text-green-300">{t('execution.cacheRead')}</span> {tokenUsageApi.formatTokens(selectedRecord.cacheReadTokens)}
              </span>
            )}
            {selectedRecord.cacheCreationTokens && selectedRecord.cacheCreationTokens > 0 && (
              <span className="text-orange-600 dark:text-orange-400">
                <span className="text-orange-400 dark:text-orange-300">{t('execution.cacheCreation')}</span> {tokenUsageApi.formatTokens(selectedRecord.cacheCreationTokens)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* 触发消息 */}
      <Collapsible className="rounded border border-border bg-muted/50 text-xs">
        <CollapsibleTrigger asChild>
          <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80">
            <CollapsibleStateIcon />
            <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-foreground font-medium">
              📥 {t('execution.triggerMessage')}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <MarkdownContent
            content={selectedRecord.triggerMessage}
            className="px-3 pb-3 dark:prose-invert [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs max-h-96 overflow-y-auto"
          />
        </CollapsibleContent>
      </Collapsible>

      {SHOW_EXECUTION_CONTEXT && selectedRecord.context && (
        <Collapsible className="rounded border border-sky-500/30 bg-sky-500/10 text-xs">
          <CollapsibleTrigger asChild>
            <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80">
              <CollapsibleStateIcon />
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-sky-500/20 text-sky-700 dark:text-sky-400 font-medium">
                🧩 {t('execution.context')}
              </span>
              <span className="text-muted-foreground">{selectedRecord.context.length} {t('execution.characters')}</span>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <MarkdownContent
              content={selectedRecord.context}
              className="px-3 pb-3 dark:prose-invert [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs max-h-96 overflow-y-auto"
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* 执行过程 - 按时间顺序显示 */}
      <div className="space-y-3">
        {events.length > 0 ? (
          events.map((event, i) => {
            if (event.type === 'thinking') {
              return (
                <Collapsible key={`thinking-${i}`} className="rounded border border-orange-500/30 bg-orange-500/10 text-xs">
                  <CollapsibleTrigger asChild>
                    <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80">
                      <CollapsibleStateIcon />
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-orange-500/20 text-orange-700 dark:text-orange-400 font-medium">
                        🧠 {t('chat.thinkingProcess')}
                      </span>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <MarkdownContent
                      content={coerceThinkingText(event.data.content)}
                      className="px-3 pb-3 dark:prose-invert [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs max-h-96 overflow-y-auto"
                    />
                  </CollapsibleContent>
                </Collapsible>
              )
            }

            if (event.type === 'tool_call') {
              const toolStatus = event.data.status
              return (
                <Collapsible key={`tool-${event.data.toolCallId || i}`} className={cn(
                  'rounded border text-xs',
                  toolStatus === 'error' ? 'bg-red-500/10 border-red-500/30' :
                    toolStatus === 'completed' ? 'bg-green-500/10 border-green-500/30' :
                      'bg-purple-500/10 border-purple-500/30'
                )}>
                  <CollapsibleTrigger asChild>
                    <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80 flex-nowrap">
                      <CollapsibleStateIcon className="shrink-0" />
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded bg-purple-500/20 text-purple-700 dark:text-purple-400 font-medium truncate max-w-[12rem] shrink-0 sm:max-w-[18rem] lg:max-w-[24rem] xl:max-w-[30rem]"
                        title={event.data.name || t('chat.toolCall')}
                      >
                        🔧 {truncateToolName(event.data.name)}
                      </span>
                      {toolStatus === 'completed' && (
                        <span className="text-green-600 dark:text-green-400 whitespace-nowrap">✓ {t('execution.completed')}</span>
                      )}
                      {toolStatus === 'error' && (
                        <span className="text-red-600 dark:text-red-400 whitespace-nowrap">✗ {t('common.error')}</span>
                      )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-2 pb-2 space-y-2">
                      {event.data.input && Object.keys(event.data.input).length > 0 && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('execution.inputColon')}</div>
                          {isCodeEditTool({ name: event.data.name, input: event.data.input }) ? (
                            <CodeEditToolContent tool={{ name: event.data.name, input: event.data.input }} />
                          ) : (
                            <div className="font-mono text-foreground bg-muted/50 rounded p-2 max-h-60 overflow-y-auto">
                              <pre className="whitespace-pre-wrap text-xs" style={{ wordBreak: 'break-word' }}>{JSON.stringify(event.data.input, null, 2)}</pre>
                            </div>
                          )}
                        </div>
                      )}
                      {event.data.output && (
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">{t('execution.outputColon')}</div>
                          {isCodeReadTool({ name: event.data.name, input: event.data.input, output: event.data.output }) && typeof event.data.output === 'string' ? (
                            <CodeReadToolOutput tool={{ name: event.data.name, input: event.data.input, output: event.data.output }} />
                          ) : (
                            <div className="font-mono text-foreground bg-muted/50 rounded p-2 max-h-60 overflow-y-auto">
                              <pre className="whitespace-pre-wrap text-xs" style={{ wordBreak: 'break-word' }}>
                                {renderToolValue(event.data.output)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            }

            if (event.type === 'model') {
              const isSwitch = event.data.type === 'switch'
              const modelStatus = event.data.status
              const roleText = event.data.role === 'fallback' ? t('execution.fallbackModel') : t('execution.primaryModel')
              const modelLabel = [event.data.providerName, event.data.model].filter(Boolean).join(' · ')
              return (
                <Collapsible key={`model-${i}`} className={cn(
                  'rounded border text-xs',
                  isSwitch ? 'border-blue-500/30 bg-blue-500/10' :
                    modelStatus === 'error' ? 'border-red-500/30 bg-red-500/10' :
                      modelStatus === 'completed' ? 'border-green-500/30 bg-green-500/10' :
                        'border-sky-500/30 bg-sky-500/10'
                )}>
                  <CollapsibleTrigger asChild>
                    <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80 flex-nowrap">
                      <CollapsibleStateIcon className="shrink-0" />
                      <span className="inline-flex max-w-[12rem] shrink-0 items-center truncate rounded bg-sky-500/20 px-2 py-0.5 font-medium text-sky-700 dark:text-sky-400 sm:max-w-[18rem] lg:max-w-[24rem]">
                        {isSwitch ? t('execution.modelSwitch') : roleText}
                      </span>
                      {!isSwitch && event.data.attempt && (
                        <span className="whitespace-nowrap text-muted-foreground">
                          {t('execution.attemptNumber', { count: event.data.attempt })}
                        </span>
                      )}
                      {modelStatus === 'completed' && (
                        <span className="whitespace-nowrap text-green-600 dark:text-green-400">✓ {t('execution.completed')}</span>
                      )}
                      {modelStatus === 'in_progress' && (
                        <span className="whitespace-nowrap text-sky-600 dark:text-sky-400">{t('execution.running')}</span>
                      )}
                      {modelStatus === 'error' && (
                        <span className="whitespace-nowrap text-red-600 dark:text-red-400">✗ {t('common.error')}</span>
                      )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-2 px-3 pb-3 text-xs">
                      {isSwitch ? (
                        <div className="text-foreground">
                          <span className="text-muted-foreground">{t('execution.modelSwitchFrom')}</span> {event.data.from || '-'}
                          <span className="mx-2 text-muted-foreground">-&gt;</span>
                          <span className="text-muted-foreground">{t('execution.modelSwitchTo')}</span> {event.data.to || '-'}
                        </div>
                      ) : (
                        <>
                          <div className="text-foreground">
                            <span className="text-muted-foreground">{t('execution.modelUsed')}</span> {modelLabel || event.data.providerName || '-'}
                          </div>
                          {event.data.error && (
                            <div className="whitespace-pre-wrap break-all rounded bg-red-500/10 p-2 text-red-600 dark:text-red-400">
                              {event.data.error}
                            </div>
                          )}
                          {event.data.sameError !== undefined && (
                            <div className="text-muted-foreground">
                              {event.data.sameError
                                ? event.data.willSwitch
                                  ? t('execution.sameErrorRepeated')
                                  : t('execution.noFallbackModelLeft')
                                : t('execution.errorChanged')}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            }

            if (event.type === 'output') {
              return (
                <Collapsible key={`output-${i}`} className="rounded border border-primary/20 bg-primary/5 text-xs">
                  <CollapsibleTrigger asChild>
                    <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80">
                      <CollapsibleStateIcon />
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                        📤 {event.data.type || 'message'}
                      </span>
                      {event.data.target && (
                        <span className="text-purple-600 dark:text-purple-400">@{event.data.target}</span>
                      )}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <MarkdownContent
                      content={event.data.content ?? ''}
                      className="px-3 pb-3 dark:prose-invert [&_pre]:bg-muted/50 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-xs"
                    />
                  </CollapsibleContent>
                </Collapsible>
              )
            }

            return null
          })
        ) : (
          <div className="flex items-center justify-center py-6 text-muted-foreground text-xs">
            <span>{t('execution.noRecords')}</span>
          </div>
        )}
      </div>

      {/* 错误信息 */}
      {selectedRecord.errorMessage && (
        <Collapsible className="rounded border border-red-500/30 bg-red-500/10 text-xs">
          <CollapsibleTrigger asChild>
            <div className="group flex items-center gap-2 p-2 cursor-pointer hover:opacity-80">
              <CollapsibleStateIcon />
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-red-500/20 text-red-700 dark:text-red-400 font-medium">
                ⚠️ {t('execution.error')}
              </span>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-3 pb-3 whitespace-pre-wrap break-all text-sm text-red-600 dark:text-red-400 max-h-96 overflow-y-auto">
              {selectedRecord.errorMessage}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
