import { Cron } from 'croner';
import { agentDiaryService } from '../../modules/agent-diary/agent-diary.service.js';
import { shanghaiDateKey } from './agent-diary.js';

/**
 * 助手日记调度器
 *
 * 每天 Asia/Shanghai 0 点触发，为所有活跃助手整理「刚刚结束的那一天」的聊天记录写日记。
 * 功能本身受全局开关控制（在 agentDiaryService 内部校验），关闭时不产出。
 */
class DiaryScheduler {
  private job: Cron | null = null;

  start(): void {
    if (this.job) return;

    this.job = new Cron('0 0 * * *', { timezone: 'Asia/Shanghai' }, async () => {
      try {
        await agentDiaryService.generateDiariesForAllAgents(this.resolveTargetDay());
      } catch (error) {
        console.error('[DiaryScheduler] 批量生成日记失败:', error);
      }
    });

    console.log('[DiaryScheduler] 已启动（每日 0:00 Asia/Shanghai）');
  }

  stop(): void {
    if (this.job) {
      this.job.stop();
      this.job = null;
      console.log('[DiaryScheduler] 已停止');
    }
  }

  /** 0 点触发时，要写的是「昨天」的日记 */
  private resolveTargetDay(): string {
    // 当前时刻往前推 12 小时，落在昨天，再取其 Shanghai 日期
    return shanghaiDateKey(new Date(Date.now() - 12 * 60 * 60 * 1000));
  }
}

export const diaryScheduler = new DiaryScheduler();
