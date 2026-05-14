import { createLlmClient, type LlmClient } from '../../lib/llm-client.js';
import { llmProviderService } from '../llm-provider/llm-provider.service.js';
import { messageService } from '../message/message.service.js';
import { chatRoomService } from '../chatroom/chatroom.service.js';
import type { AgentAction } from '../../core/agent/executor.interface.js';

/**
 * 群聊状态
 */
interface ChatRoomState {
  lastMessageTime: number;
  lastAgentName: string;
  isActive: boolean; // 是否有活跃的 Agent 处理中
  isCompleted: boolean; // 游戏是否已结束
  lastExecResult?: {
    actions: AgentAction[];
  };
}

/**
 * 智能恢复服务
 * 监控群聊状态，检测流程卡住，通过 LLM 分析原因并尝试恢复
 */
class RecoveryService {
  private roomStates = new Map<string, ChatRoomState>();
  private recoverAttempts = new Map<string, number>();
  private checkInterval: NodeJS.Timeout | null = null;
  private model: LlmClient | null = null;

  // 配置
  private readonly CHECK_INTERVAL_MS = 30000; // 每 30 秒检查一次
  private readonly STUCK_THRESHOLD_MS = 60000; // 超过 60 秒无消息认为可能卡住
  private readonly MAX_RECOVER_ATTEMPTS = 3; // 最大恢复尝试次数

  // 回调：触发 Agent 执行恢复
  private triggerAgentCallback:
    | ((chatRoomId: string, agentName: string, recoveryPrompt: string) => Promise<void>)
    | null = null;

  constructor() {
    // 模型延迟初始化，在 start() 时从数据库获取默认 LlmProvider
  }

  /**
   * 初始化 LLM 模型（使用默认 LlmProvider）
   */
  private async initModel(): Promise<void> {
    const provider = await llmProviderService.findDefault();
    if (!provider) {
      console.warn('[恢复服务] 未找到默认 LLM Provider，恢复服务将无法正常工作');
      return;
    }

    const apiProtocol = provider.apiProtocol || 'anthropic';
    console.log(`[恢复服务] 使用默认 LLM Provider ${provider.name} (${provider.type}, protocol=${apiProtocol})`);

    this.model = createLlmClient(provider, { temperature: 0.1 });
  }

  /**
   * 设置触发 Agent 的回调函数
   */
  setTriggerAgentCallback(
    callback: (chatRoomId: string, agentName: string, recoveryPrompt: string) => Promise<void>,
  ) {
    this.triggerAgentCallback = callback;
  }

  /**
   * 更新群状态（每次有新消息时调用）
   */
  updateRoomState(
    chatRoomId: string,
    agentName?: string,
    isActive?: boolean,
    execResult?: { actions: AgentAction[] },
  ) {
    const existing = this.roomStates.get(chatRoomId);
    this.roomStates.set(chatRoomId, {
      lastMessageTime: Date.now(),
      lastAgentName: agentName || existing?.lastAgentName || '',
      isActive: isActive ?? existing?.isActive ?? false,
      isCompleted: existing?.isCompleted ?? false,
      lastExecResult: execResult,
    });

    // 有新消息，重置恢复尝试计数
    this.recoverAttempts.delete(chatRoomId);
  }

  /**
   * 设置群的处理状态
   */
  setProcessingState(chatRoomId: string, isActive: boolean) {
    const existing = this.roomStates.get(chatRoomId);
    if (existing) {
      existing.isActive = isActive;
    }
  }

  /**
   * 标记群游戏已结束
   */
  markCompleted(chatRoomId: string) {
    const existing = this.roomStates.get(chatRoomId);
    if (existing) {
      existing.isCompleted = true;
      console.log(`[恢复服务] 群 ${chatRoomId} 已标记为完成，不再监控`);
    }
  }

  /**
   * 重置群状态（开始新游戏时调用）
   */
  resetRoom(chatRoomId: string) {
    this.roomStates.delete(chatRoomId);
    this.recoverAttempts.delete(chatRoomId);
    console.log(`[恢复服务] 群 ${chatRoomId} 状态已重置`);
  }

  /**
   * 启动定时检查
   */
  async start() {
    if (this.checkInterval) {
      console.log('[恢复服务] 已经在运行中');
      return;
    }

    // 初始化模型
    await this.initModel();

    this.checkInterval = setInterval(() => {
      this.checkAllRooms().catch((err) => {
        console.error('[恢复服务] 检查失败:', err);
      });
    }, this.CHECK_INTERVAL_MS);

    console.log('[恢复服务] 已启动，检查间隔:', this.CHECK_INTERVAL_MS / 1000, '秒');
  }

  /**
   * 停止定时检查
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[恢复服务] 已停止');
    }
  }

  /**
   * 检查所有群
   */
  private async checkAllRooms() {
    const now = Date.now();

    for (const [chatRoomId, state] of this.roomStates) {
      // 跳过正在处理中的群
      if (state.isActive) continue;

      // 跳过已完成的群
      if (state.isCompleted) continue;

      const idleTime = now - state.lastMessageTime;

      if (idleTime > this.STUCK_THRESHOLD_MS) {
        await this.checkAndRecover(chatRoomId, state);
      }
    }
  }

  /**
   * 检查并尝试恢复
   */
  private async checkAndRecover(chatRoomId: string, state: ChatRoomState) {
    const attempts = this.recoverAttempts.get(chatRoomId) || 0;

    if (attempts >= this.MAX_RECOVER_ATTEMPTS) {
      console.log(`[恢复服务] 群 ${chatRoomId} 已尝试 ${attempts} 次，停止自动恢复`);
      return;
    }

    console.log(`[恢复服务] 群 ${chatRoomId} 可能卡住，正在分析...`);

    try {
      // 1. 优先检查执行结果：Agent 有 actions 但可能未正确处理
      if (state.lastExecResult && state.lastExecResult.actions.length > 0) {
        console.log(`[恢复服务] 群 ${chatRoomId} Agent 有 ${state.lastExecResult.actions.length} 个 actions`);

        this.recoverAttempts.set(chatRoomId, attempts + 1);
        this.updateRoomState(chatRoomId, state.lastAgentName, true);

        if (state.lastAgentName) {
          await this.triggerRecovery(chatRoomId, state.lastAgentName);
        }
        return;
      }

      // 2. 拉取最近的聊天记录
      const allMessages = await messageService.findByChatRoomId(chatRoomId, {
        take: 100,
      });

      if (allMessages.length === 0) {
        console.log(`[恢复服务] 群 ${chatRoomId} 没有消息历史，跳过`);
        return;
      }

      // 3. 检查最新消息时间（避免误判，因为定时任务可能有延迟）
      const lastMessage = allMessages[allMessages.length - 1];
      const lastMessageTime = lastMessage.time.getTime();
      if (Date.now() - lastMessageTime < this.STUCK_THRESHOLD_MS) {
        // 数据库里的消息比内存中的更新，说明有新消息
        this.updateRoomState(chatRoomId);
        return;
      }

      // 4. 获取群内的 Agent 列表
      const chatRoomAgents = await chatRoomService.getAgents(chatRoomId);
      const agentNames = chatRoomAgents
        .map((cra) => cra.agent?.name)
        .filter((name): name is string => !!name);

      if (agentNames.length === 0) {
        console.log(`[恢复服务] 群 ${chatRoomId} 没有活跃的 Agent，跳过`);
        return;
      }

      // 5. 让 LLM 分析是否卡住或游戏是否结束
      const analysis = await this.analyzeStuckSituation(allMessages, agentNames, state);

      console.log(`[恢复服务] 群 ${chatRoomId} 分析结果:`, analysis);

      // 5. 如果游戏已结束，标记为完成
      if (analysis.isGameCompleted) {
        this.markCompleted(chatRoomId);
        return;
      }

      // 6. 如果需要恢复，触发恢复
      if (analysis.needsRecovery && state.lastAgentName) {
        this.recoverAttempts.set(chatRoomId, attempts + 1);

        // 更新状态，避免立即再次触发
        this.updateRoomState(chatRoomId, state.lastAgentName, true);

        // 触发恢复
        await this.triggerRecovery(chatRoomId, state.lastAgentName);
      }
    } catch (error) {
      console.error(`[恢复服务] 群 ${chatRoomId} 恢复检查失败:`, error);
    }
  }

  /**
   * LLM 分析是否卡住或游戏是否结束
   */
  private async analyzeStuckSituation(
    messages: Awaited<ReturnType<typeof messageService.findByChatRoomId>>,
    agentNames: string[],
    state: ChatRoomState,
  ): Promise<{ needsRecovery: boolean; reason: string; isGameCompleted: boolean }> {
    // 取最近 10 条消息用于分析
    const recentMessages = messages.slice(-10);
    const historyText = recentMessages
      .map((m) => {
        const sender = m.user?.username || m.agent?.name || '未知';
        const isAgentMsg = m.agent ? '[Agent]' : '[玩家]';
        return `${isAgentMsg} [${sender}]: ${m.content}`;
      })
      .join('\n');

    // 找到最后一条 Agent 消息
    const lastAgentMessage = [...messages].reverse().find((m) => m.agent);
    const lastAgentContent = lastAgentMessage
      ? `[${lastAgentMessage.agent?.name}]: ${lastAgentMessage.content}`
      : '无';

    const prompt = `分析以下群聊情况，判断：
1. 游戏是否已经正常结束（已宣布结果、揭示身份、玩家确认）
2. 游戏流程是否卡住（Agent 应该发消息但没有发）

群聊最近的对话：
${historyText}

群内的 Agent（助手）：${agentNames.join('、')}
最后一条 Agent 消息：${lastAgentContent}
距离最后一条消息已过：${Math.round((Date.now() - state.lastMessageTime) / 1000)} 秒

判断规则：
- 如果游戏已结束（宣布结果、揭示卧底、玩家确认身份等），isGameCompleted = true
- 如果正在等待玩家输入（发言、投票），这可能是正常的，needsRecovery = false, isGameCompleted = false
- 如果 Agent 应该继续推进游戏但没有动作，needsRecovery = true

返回 JSON 格式（不要包含 \`\`\`json 标记）：
{
  "needsRecovery": true/false,
  "isGameCompleted": true/false,
  "reason": "简短说明判断原因"
}`;

    try {
      if (!this.model) {
        console.warn('[恢复服务] LLM 模型未初始化，无法进行分析');
        return {
          needsRecovery: false,
          reason: 'LLM 模型未初始化',
          isGameCompleted: false,
        };
      }

      const content = await this.model.invoke(prompt);

      // 提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          needsRecovery: false,
          reason: '无法解析分析结果',
          isGameCompleted: false,
        };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('[恢复服务] LLM 分析失败:', error);
      return {
        needsRecovery: false,
        reason: '分析失败',
        isGameCompleted: false,
      };
    }
  }

  /**
   * 触发恢复：让 Agent 继续执行
   */
  private async triggerRecovery(chatRoomId: string, agentName: string) {
    if (!this.triggerAgentCallback) {
      console.error('[恢复服务] 未设置 triggerAgentCallback');
      return;
    }

    const recoveryPrompt = `[系统自动恢复提示]

检测到流程可能中断。

【重要：助手消息规则】
需要给其他助手发消息时，先调用 send_message 工具生成消息草稿，再把工具返回的 @助手消息放入你的最终回复。
send_message 工具本身不会直接发送消息。

请根据当前状态，决定需要回复什么内容；如果要触发其他助手，把工具生成的 @助手消息包含在最终回复中。`;

    console.log(`[恢复服务] 向群 ${chatRoomId} 的 Agent ${agentName} 发送恢复提示`);

    try {
      await this.triggerAgentCallback(chatRoomId, agentName, recoveryPrompt);
    } catch (error) {
      console.error(`[恢复服务] 触发恢复失败:`, error);
      // 恢复失败，重置状态
      this.setProcessingState(chatRoomId, false);
    }
  }

  /**
   * 移除群状态（群被删除时调用）
   */
  removeRoom(chatRoomId: string) {
    this.roomStates.delete(chatRoomId);
    this.recoverAttempts.delete(chatRoomId);
  }

  /**
   * 获取当前监控的群数量
   */
  getMonitoredCount(): number {
    return this.roomStates.size;
  }

  /**
   * 获取群状态（用于调试）
   */
  getRoomState(chatRoomId: string): ChatRoomState | undefined {
    return this.roomStates.get(chatRoomId);
  }
}

// 导出单例
export const recoveryService = new RecoveryService();
