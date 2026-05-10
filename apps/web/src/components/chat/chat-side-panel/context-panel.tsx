import { AgentContextInfo, ToolCall } from '@/lib/agent-api'
import { Bot, ChevronDown, ChevronRight, Clock, Database, Loader2, MessageSquare, Settings, Sparkles, User, Wrench } from 'lucide-react'
import { useState } from 'react'
import { cn, formatDateTime, formatToolName } from '@/lib/utils'

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

interface ContextPanelProps {
  contextLoading: boolean
  contextInfo: AgentContextInfo | null
}

// 可折叠区域组件
function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  badge?: string | number
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border border-border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-accent transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-foreground">{title}</span>
          {badge !== undefined && (
            <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 pb-3 border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

// 工具调用卡片
function ToolCallCard({ toolCall: tc }: { toolCall: ToolCall }) {
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <Wrench className="size-3 text-muted-foreground" />
        <span className="font-medium text-foreground">{formatToolName(tc.name)}</span>
        {tc.status && (
          <span
            className={cn(
              'px-1 py-0.5 rounded text-xs',
              tc.status === 'completed' && 'bg-green-500/20 text-green-500',
              tc.status === 'in_progress' && 'bg-blue-500/20 text-blue-500',
              tc.status === 'error' && 'bg-red-500/20 text-red-500'
            )}
          >
            {tc.status}
          </span>
        )}
      </div>
      {tc.input && Object.keys(tc.input).length > 0 && (
        <div className="mb-1">
          <span className="text-muted-foreground">输入: </span>
          <span className="text-foreground">{JSON.stringify(tc.input)}</span>
        </div>
      )}
      {tc.output && (
        <div>
          <span className="text-muted-foreground">输出: </span>
          <span className="text-foreground">
            {typeof tc.output === 'string'
              ? tc.output.slice(0, 200) + (tc.output.length > 200 ? '...' : '')
              : JSON.stringify(tc.output).slice(0, 200) + '...'}
          </span>
        </div>
      )}
    </div>
  )
}

export function ContextPanel({ contextLoading, contextInfo }: ContextPanelProps) {
  if (contextLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="size-8 animate-spin text-primary mb-2" />
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    )
  }

  if (!contextInfo) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Bot className="size-12 mb-3 opacity-50" />
        <p>暂无上下文信息</p>
        <p className="text-xs mt-1">请先 @该助手触发对话</p>
      </div>
    )
  }

  const { agentName, agentType, latestExecution, checkpointStats, checkpointMessages, realtimeInfo } = contextInfo

  return (
    <div className="space-y-3 text-sm">
      {/* 基础信息 */}
      <div className="bg-muted rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="size-4 text-primary" />
          <span className="font-semibold text-foreground">{agentName}</span>
          <span className="text-xs text-muted-foreground bg-accent px-1.5 py-0.5 rounded">
            {agentType === 'builtin' ? '原生助手' : '外部'}
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-1">
          {realtimeInfo?.threadId && (
            <div>Thread ID: <span className="text-foreground">{realtimeInfo.threadId.slice(-8)}</span></div>
          )}
          <div>
            Checkpoint 数量: <span className="text-foreground">{checkpointStats.count}</span>
          </div>
        </div>
      </div>

      {/* Checkpoint 消息历史 */}
      {checkpointMessages && checkpointMessages.length > 0 && checkpointMessages[0].messages.length > 0 && (
        <CollapsibleSection
          title="对话历史"
          icon={<Database className="size-4 text-muted-foreground" />}
          badge={`${checkpointMessages[0].messages.length} 条`}
          defaultOpen={false}
        >
          <div className="pt-2 space-y-2">
            {checkpointMessages[0].messages.map((msg, idx) => (
              <div key={idx} className="flex gap-2 text-xs">
                <div className="flex-shrink-0 mt-0.5">
                  {msg.role === 'user' ? (
                    <User className="size-3.5 text-blue-500" />
                  ) : msg.role === 'assistant' ? (
                    <Bot className="size-3.5 text-green-500" />
                  ) : (
                    <MessageSquare className="size-3.5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-muted-foreground text-[10px] mb-0.5">
                    {msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : msg.role}
                  </div>
                  <div className="text-foreground break-words line-clamp-3">
                    {msg.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* 最近执行信息 */}
      {latestExecution ? (
        <CollapsibleSection
          title="最近执行"
          icon={<Clock className="size-4 text-muted-foreground" />}
          defaultOpen={true}
        >
          <div className="pt-2 space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <MessageSquare className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">触发消息:</span>
              <span className="text-foreground">{latestExecution.triggerMessage.slice(0, 100)}</span>
            </div>
            {latestExecution.triggerUser && (
              <div>
                <span className="text-muted-foreground">触发用户: </span>
                <span className="text-foreground">{latestExecution.triggerUser}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">执行时间: </span>
              <span className="text-foreground">
                {formatDateTime(latestExecution.createdAt)}
              </span>
            </div>
            {latestExecution.duration && (
              <div>
                <span className="text-muted-foreground">执行耗时: </span>
                <span className="text-foreground">{formatDuration(latestExecution.duration)}</span>
              </div>
            )}
          </div>
        </CollapsibleSection>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-3">
          暂无执行记录
        </div>
      )}

      {/* 系统提示词 */}
      {latestExecution?.systemPrompt && (
        <CollapsibleSection
          title="系统提示词"
          icon={<Bot className="size-4 text-muted-foreground" />}
          badge={`${latestExecution.systemPrompt.length} 字`}
        >
          <div className="pt-2">
            <div className="bg-muted rounded p-2 text-xs text-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
              {latestExecution.systemPrompt}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* 思考过程 */}
      {latestExecution?.thinking && (
        <CollapsibleSection
          title="思考过程"
          icon={<Sparkles className="size-4 text-purple-500" />}
          badge={`${latestExecution.thinking.length} 字`}
        >
          <div className="pt-2">
            <div className="bg-purple-500/10 rounded p-2 text-xs text-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
              {latestExecution.thinking}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* 上下文消息 */}
      {latestExecution?.context && (
        <CollapsibleSection
          title="上下文消息"
          icon={<MessageSquare className="size-4 text-muted-foreground" />}
          badge={`${latestExecution.context.length} 字`}
        >
          <div className="pt-2">
            <div className="bg-primary/10 rounded p-2 text-xs text-foreground whitespace-pre-wrap max-h-60 overflow-y-auto">
              {latestExecution.context}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* 工具调用 */}
      {latestExecution?.toolCalls && latestExecution.toolCalls.length > 0 && (
        <CollapsibleSection
          title="工具调用"
          icon={<Wrench className="size-4 text-muted-foreground" />}
          badge={latestExecution.toolCalls.length}
          defaultOpen={false}
        >
          <div className="pt-2 space-y-2">
            {latestExecution.toolCalls.map((tc, idx) => (
              <ToolCallCard key={idx} toolCall={tc} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* 配置信息 */}
      {realtimeInfo && (
        <CollapsibleSection
          title="配置信息"
          icon={<Settings className="size-4 text-muted-foreground" />}
          defaultOpen={false}
        >
          <div className="pt-2 text-xs space-y-1">
            <div>
              <span className="text-muted-foreground">注入群历史: </span>
              <span className={cn(
                'font-medium',
                realtimeInfo.injectGroupHistory ? 'text-green-500' : 'text-foreground'
              )}>
                {realtimeInfo.injectGroupHistory ? '是' : '否'}
              </span>
            </div>
            {realtimeInfo.chatRoomAgents && realtimeInfo.chatRoomAgents.length > 0 && (
              <div>
                <span className="text-muted-foreground">群内助手: </span>
                <span className="text-foreground">{realtimeInfo.chatRoomAgents.join('、')}</span>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}
