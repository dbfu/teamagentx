import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cronTaskApi, type CronTask } from '@/lib/cron-task-api';
import { Plus, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CronTaskCard } from '../cron-task-card';
import { CronTaskExecutionHistory } from '../cron-task-execution-history';
import { CreateCronTaskModal } from '../dialogs/create-cron-task-modal';

interface ChatRoomAgent {
  id: string;
  agentId: string | null;
  agent?: {
    id: string;
    name: string;
    avatar?: string | null;
    avatarColor?: string | null;
  } | null;
}

interface CronTasksPanelProps {
  chatRoomId: string;
  chatRoomName: string;
  chatRoomAgents: ChatRoomAgent[];
}

export function CronTasksPanel({ chatRoomId, chatRoomName, chatRoomAgents }: CronTasksPanelProps) {
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<CronTask | null>(null);
  const [deletingTask, setDeletingTask] = useState<CronTask | null>(null);
  const [showExecutionHistory, setShowExecutionHistory] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [testingTask, setTestingTask] = useState<string | null>(null);

  // 加载任务列表
  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await cronTaskApi.getByChatRoom(chatRoomId);
      setTasks(data);
    } catch (error) {
      console.error('Failed to load cron tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, [chatRoomId]);

  // 创建任务
  const handleCreate = async (data: any) => {
    try {
      await cronTaskApi.create(chatRoomId, data);
      setShowCreateModal(false);
      loadTasks();
    } catch (error) {
      console.error('Failed to create cron task:', error);
    }
  };

  // 更新任务
  const handleUpdate = async (data: any) => {
    if (!editingTask) return;
    try {
      await cronTaskApi.update(editingTask.id, data);
      setEditingTask(null);
      loadTasks();
    } catch (error) {
      console.error('Failed to update cron task:', error);
    }
  };

  // 删除任务
  const handleDelete = async () => {
    if (!deletingTask) return;
    try {
      await cronTaskApi.delete(deletingTask.id);
      setDeletingTask(null);
      loadTasks();
    } catch (error) {
      console.error('Failed to delete cron task:', error);
    }
  };

  // 启用/禁用任务
  const handleToggleEnabled = async (task: CronTask) => {
    try {
      await cronTaskApi.setEnabled(task.id, !task.enabled);
      loadTasks();
    } catch (error) {
      console.error('Failed to toggle task enabled:', error);
    }
  };

  // 测试执行任务
  const handleTestExecute = async (task: CronTask) => {
    setTestingTask(task.id);
    try {
      const result = await cronTaskApi.testExecute(task.id);
      if (result.success) {
        loadTasks();
      } else {
        console.error('Test execution failed:', result.error);
      }
    } catch (error) {
      console.error('Failed to test execute:', error);
    } finally {
      setTestingTask(null);
    }
  };

  // 查看执行历史
  const handleViewHistory = (taskId: string) => {
    setSelectedTaskId(taskId);
    setShowExecutionHistory(true);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base font-semibold truncate">{chatRoomName}</h2>
          <span className="text-sm text-muted-foreground">({tasks.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={loadTasks} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-1" />
            创建任务
          </Button>
        </div>
      </div>

      {/* 任务列表 - 使用 overflow-y-auto 滚动 */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-3">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">加载中...</div>
          ) : tasks.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              暂无定时任务，点击"创建任务"添加
            </div>
          ) : (
            tasks.map((task) => (
              <CronTaskCard
                key={task.id}
                task={task}
                onToggleEnabled={() => handleToggleEnabled(task)}
                onEdit={() => setEditingTask(task)}
                onDelete={() => setDeletingTask(task)}
                onTestExecute={() => handleTestExecute(task)}
                onViewHistory={() => handleViewHistory(task.id)}
                isTesting={testingTask === task.id}
              />
            ))
          )}
        </div>
      </div>

      {/* 创建任务弹框 */}
      {showCreateModal && (
        <CreateCronTaskModal
          agents={chatRoomAgents}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {/* 编辑任务弹框 */}
      {editingTask && (
        <CreateCronTaskModal
          agents={chatRoomAgents}
          initialData={editingTask}
          onSubmit={handleUpdate}
          onCancel={() => setEditingTask(null)}
        />
      )}

      {/* 删除确认弹框 */}
      <AlertDialog open={!!deletingTask} onOpenChange={() => setDeletingTask(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>删除定时任务</AlertDialogTitle>
          <AlertDialogDescription>
            定要删除任务 "{deletingTask?.name}" 吗？此操作不可撤销。
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 执行历史面板 */}
      {showExecutionHistory && selectedTaskId && (
        <CronTaskExecutionHistory
          taskId={selectedTaskId}
          onClose={() => {
            setShowExecutionHistory(false);
            setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}