import { type CronTask } from '@/lib/cron-task-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Play, Pencil, Trash2, History, Power, PowerOff, Clock, Loader2, Calendar, MessageSquare, AlertCircle } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';

interface CronTaskCardProps {
  task: CronTask;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTestExecute: () => void;
  onViewHistory: () => void;
  isTesting?: boolean;
}

// 格式化下次执行时间
function formatNextRunAt(nextRunAt: string | null): string {
  if (!nextRunAt) return '未安排';
  return formatDateTime(nextRunAt);
}

// 格式化上次执行时间
function formatLastRunAt(lastRunAt: string | null): string {
  if (!lastRunAt) return '从未';
  const date = new Date(lastRunAt);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}天前`;
  if (hours > 0) return `${hours}小时前`;
  if (minutes > 0) return `${minutes}分钟前`;
  return '刚刚';
}

// 获取调度类型描述
function getScheduleDescription(task: CronTask): string {
  switch (task.scheduleType) {
    case 'cron':
      return task.cronExpression || 'Cron';
    case 'interval':
      return `每${task.intervalMinutes}分钟`;
    case 'once':
      return task.scheduledAt ? formatNextRunAt(task.scheduledAt) : '一次性';
    default:
      return '未知';
  }
}

export function CronTaskCard({
  task,
  onToggleEnabled,
  onEdit,
  onDelete,
  onTestExecute,
  onViewHistory,
  isTesting,
}: CronTaskCardProps) {
  return (
    <div className={cn(
      'rounded-lg border bg-card overflow-hidden transition-opacity',
      !task.enabled && 'opacity-60 bg-muted'
    )}>
      {/* 头部：任务名称 */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-foreground truncate">{task.name}</span>
          {!task.enabled && (
            <Badge variant="outline" className="text-xs bg-muted">已禁用</Badge>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="p-3 space-y-2.5">
        {/* 描述 */}
        {task.description && (
          <p className="text-sm text-muted-foreground">{task.description}</p>
        )}

        {/* 调度信息 - 带背景的区块 */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-blue-500/10 text-sm">
          <Clock className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-blue-500 font-medium">{getScheduleDescription(task)}</span>
        </div>

        {/* 执行时间 - 紧凑的两列布局 */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>上次 {formatLastRunAt(task.lastRunAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>下次 {formatNextRunAt(task.nextRunAt)}</span>
          </div>
        </div>

        {/* 执行内容 */}
        <div className="flex items-center gap-2 text-sm">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground wrap-break-word line-clamp-2">{task.payload}</span>
        </div>

        {/* 错误信息 */}
        {task.lastError && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-destructive/10 text-sm text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="wrap-break-word line-clamp-1">{task.lastError}</span>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-end gap-1 pt-1 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleEnabled}
                className="h-7 w-7 hover:bg-accent"
              >
                {task.enabled ? (
                  <PowerOff className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Power className="h-3.5 w-3.5 text-green-500" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{task.enabled ? '禁用' : '启用'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onTestExecute}
                disabled={isTesting}
                className="h-7 w-7 hover:bg-accent"
              >
                {isTesting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <Play className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>测试执行</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onViewHistory}
                className="h-7 w-7 hover:bg-accent"
              >
                <History className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看历史</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onEdit}
                className="h-7 w-7 hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>编辑</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                className="h-7 w-7 hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>删除</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}