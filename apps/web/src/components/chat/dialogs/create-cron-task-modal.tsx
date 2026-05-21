import { useState } from 'react';
import { type CronTask, type CreateCronTaskData } from '@/lib/cron-task-api';
import { cn } from '@/lib/utils';
import { X, Check } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AgentAvatarImage } from '@/lib/agent-avatars';

type ScheduleType = 'cron' | 'interval' | 'once';

// 常用 cron 表达式预设
const cronPresets = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 9:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每周五 18:00', value: '0 18 * * 5' },
  { label: '每月 1 号 9:00', value: '0 9 1 * *' },
];

// 系统内置助手的 ID（触发助手时需要过滤掉）
const SYSTEM_BUILTIN_AGENT_IDS = [
  '596667f7-f901-4613-92a7-cc71d859fa22', // 技能安装助手
  '29ffb519-82d2-4c32-8bc8-0b8d814a4eee', // 助手生成器
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // 定时任务助手
];

interface AgentInfo {
  id: string;
  agentId: string | null;
  agent?: {
    id: string;
    name: string;
    avatar?: string | null;
    avatarColor?: string | null;
  } | null;
}

interface CreateCronTaskModalProps {
  agents: AgentInfo[];
  onSubmit: (data: CreateCronTaskData) => void;
  onCancel: () => void;
  initialData?: CronTask;
}

export function CreateCronTaskModal({
  agents,
  initialData,
  onSubmit,
  onCancel,
}: CreateCronTaskModalProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    initialData?.scheduleType || 'cron'
  );
  const [cronExpression, setCronExpression] = useState(initialData?.cronExpression || '0 9 * * *');
  const [intervalMinutes, setIntervalMinutes] = useState(initialData?.intervalMinutes || 60);
  const [scheduledAt, setScheduledAt] = useState(
    initialData?.scheduledAt ? new Date(initialData.scheduledAt).toISOString().slice(0, 16) : ''
  );
  const [payload, setPayload] = useState(initialData?.payload || '');
  const [agentIds, setAgentIds] = useState<string[]>(() => {
    const raw = initialData?.agentIds;
    if (Array.isArray(raw)) return raw;
    // 兼容旧接口返回 JSON 字符串的情况
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);
  const [maxRetries, setMaxRetries] = useState(initialData?.maxRetries || 3);

  const isEditing = !!initialData;

  // 过滤出有效的助手列表（排除系统内置助手）
  const validAgents = agents
    .filter(a => a.agent && !SYSTEM_BUILTIN_AGENT_IDS.includes(a.agent!.id))
    .map(a => ({
      id: a.agent!.id,
      name: a.agent!.name,
      avatar: a.agent!.avatar,
      avatarColor: a.agent!.avatarColor,
    }));

  // 是否选中了"所有助手"
  const isAllAgentsSelected = agentIds.includes('*');

  // 切换助手选择
  const toggleAgent = (agentId: string) => {
    if (isAllAgentsSelected) {
      // 如果当前是"所有助手"，切换到具体选择时需要清除 "*" 并设置当前选中的
      setAgentIds([agentId]);
    } else {
      if (agentIds.includes(agentId)) {
        setAgentIds(agentIds.filter(id => id !== agentId));
      } else {
        setAgentIds([...agentIds, agentId]);
      }
    }
  };

  // 切换"所有助手"
  const toggleAllAgents = () => {
    if (isAllAgentsSelected) {
      setAgentIds([]);
    } else {
      setAgentIds(['*']);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !payload) return;

    const data: CreateCronTaskData = {
      name,
      description: description || undefined,
      scheduleType,
      cronExpression: scheduleType === 'cron' ? cronExpression : undefined,
      intervalMinutes: scheduleType === 'interval' ? intervalMinutes : undefined,
      scheduledAt: scheduleType === 'once' ? new Date(scheduledAt).toISOString() : undefined,
      payload,
      agentIds: agentIds.length > 0 ? agentIds : undefined,
      enabled,
      maxRetries,
    };

    onSubmit(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-[480px] shrink-0 rounded-2xl bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {isEditing ? '编辑定时任务' : '创建定时任务'}
          </h2>
          <button
            onClick={onCancel}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="max-h-[60vh] overflow-y-auto p-6">
            {/* 任务名称 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                任务名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：每日提醒"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            {/* 描述 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">描述</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="任务的描述说明"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* 调度类型 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">调度类型</label>
              <Select
                value={scheduleType}
                onValueChange={(value) => setScheduleType(value as ScheduleType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择调度类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cron">Cron 表达式</SelectItem>
                  <SelectItem value="interval">固定间隔</SelectItem>
                  <SelectItem value="once">一次性执行</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Cron 表达式 */}
            {scheduleType === 'cron' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  Cron 表达式 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="例如：0 9 * * *"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  required
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  格式：分钟 小时 日 月 星期（如 "0 9 * * *" 表示每天9点）
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cronPresets.map((preset) => {
                    const active = preset.value === cronExpression;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => setCronExpression(preset.value)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          active
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-accent'
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 固定间隔 */}
            {scheduleType === 'interval' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  间隔分钟数 <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(parseInt(e.target.value) || 0)}
                  min={1}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            )}

            {/* 一次性执行 */}
            {scheduleType === 'once' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-foreground">
                  执行时间 <span className="text-red-500">*</span>
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
              </div>
            )}

            {/* 执行内容 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                执行内容（发送的消息） <span className="text-red-500">*</span>
              </label>
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="消息内容，可使用 @助手名 触发特定助手执行"
                rows={3}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                提示：在消息中使用 @助手名 可以触发特定助手执行任务
              </p>
            </div>

            {/* 触发助手 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                触发助手
              </label>
              <p className="mb-2 text-xs text-muted-foreground">
                选择要自动 @ 的助手，任务执行时会自动在消息前添加 @助手名
              </p>

              {/* 所有助手选项 */}
              <button
                type="button"
                onClick={toggleAllAgents}
                className={cn(
                  'mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors w-full',
                  isAllAgentsSelected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent'
                )}
              >
                <div className={cn(
                  'flex size-5 items-center justify-center rounded border transition-colors',
                  isAllAgentsSelected
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-background'
                )}>
                  {isAllAgentsSelected && <Check className="size-3" />}
                </div>
                <span>所有助手</span>
                <span className="text-xs text-muted-foreground">(排除系统内置助手)</span>
              </button>

              {/* 具体助手列表 */}
              {!isAllAgentsSelected && validAgents.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {validAgents.map((agent) => {
                    const isSelected = agentIds.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-accent'
                        )}
                      >
                        <div className={cn(
                          'flex size-5 items-center justify-center rounded border transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-white'
                            : 'border-border bg-background'
                        )}>
                          {isSelected && <Check className="size-3" />}
                        </div>
                        <AgentAvatarImage avatar={agent.avatar ?? null} className="size-6" />
                        <span className="truncate">{agent.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 无助手提示 */}
              {validAgents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  当前群聊中没有助手，请先添加助手
                </p>
              )}
            </div>

            {/* 最大重试次数 */}
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-foreground">最大重试次数</label>
              <input
                type="number"
                value={maxRetries}
                onChange={(e) => setMaxRetries(parseInt(e.target.value) || 0)}
                min={0}
                max={10}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
            </div>

            {/* 启用状态 */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">立即启用</label>
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className={cn(
                  'relative h-5 w-10 rounded-full transition-colors',
                  enabled ? 'bg-primary' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-background transition-transform',
                    enabled && 'translate-x-5'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-accent"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!name || !payload}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isEditing ? '保存' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
