import { useState, useEffect } from 'react';
import { cronTaskApi, type CronTaskExecution } from '@/lib/cron-task-api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Clock, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import dayjs from 'dayjs';

interface CronTaskExecutionHistoryProps {
  taskId: string;
  onClose: () => void;
}

// 状态颜色映射（使用 opacity 背景适配深色主题）
const stateColors: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-500/15 text-green-600 dark:text-green-400',
  failed: 'bg-red-500/15 text-red-600 dark:text-red-400',
  skipped: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};

// 状态图标映射
const stateIcons: Record<string, React.ReactNode> = {
  pending: <Clock className="h-4 w-4" />,
  running: <Loader2 className="h-4 w-4 animate-spin" />,
  completed: <CheckCircle className="h-4 w-4" />,
  failed: <AlertCircle className="h-4 w-4" />,
  skipped: <Clock className="h-4 w-4" />,
};

// 状态中文映射
const stateLabels: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

// 格式化时间（带秒）
function formatTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = dayjs(dateStr);
  const now = dayjs();
  const timeStr = date.format('HH:mm:ss');

  if (date.isSame(now, 'day')) {
    return timeStr;
  }

  if (date.isSame(now.subtract(1, 'day'), 'day')) {
    return `昨天 ${timeStr}`;
  }

  if (date.isSame(now, 'year')) {
    return `${date.format('M月D日')} ${timeStr}`;
  }

  return `${date.format('YYYY年M月D日')} ${timeStr}`;
}

// 格式化持续时间（1m40s 格式，分钟为0时只显示秒）
function formatDuration(duration: number | null): string {
  if (!duration) return '-';
  const totalSeconds = Math.round(duration / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m${seconds}s`
}

export function CronTaskExecutionHistory({
  taskId,
  onClose,
}: CronTaskExecutionHistoryProps) {
  const [executions, setExecutions] = useState<CronTaskExecution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadExecutions = async () => {
      setLoading(true);
      try {
        const data = await cronTaskApi.getExecutions(taskId, 50);
        setExecutions(data);
      } catch (error) {
        console.error('Failed to load execution history:', error);
      } finally {
        setLoading(false);
      }
    };

    loadExecutions();
  }, [taskId]);

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-lg font-semibold">执行历史</h2>
      </div>

      {/* 历史列表 */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">加载中...</div>
          ) : executions.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">暂无执行记录</div>
          ) : (
            executions.map((execution) => (
              <div
                key={execution.id}
                className="rounded-lg border p-3 space-y-2"
              >
                {/* 状态和时间 */}
                <div className="flex items-center justify-between">
                  <Badge className={cn('flex items-center gap-1', stateColors[execution.state])}>
                    {stateIcons[execution.state]}
                    {stateLabels[execution.state] || execution.state}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {formatTime(execution.triggeredAt)}
                  </span>
                </div>

                {/* 执行内容快照 */}
                <div className="text-sm">
                  <span className="text-muted-foreground">执行内容：</span>
                  <span className="truncate block">{execution.payloadSnapshot}</span>
                </div>

                {/* 执行详情 */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">开始：</span>
                    <span>{formatTime(execution.startedAt)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">完成：</span>
                    <span>{formatTime(execution.completedAt)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">耗时：</span>
                    <span>{formatDuration(execution.duration)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">记录ID：</span>
                    <span className="truncate">{execution.executionRecordId || '-'}</span>
                  </div>
                </div>

                {/* 错误信息 */}
                {execution.errorMessage && (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    <span className="font-medium">错误：</span>
                    <span className="truncate block">{execution.errorMessage}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}