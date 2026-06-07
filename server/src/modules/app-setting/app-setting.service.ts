import prisma from '../../lib/prisma.js';
import { authService } from '../auth/auth.service.js';
import { llmProviderService } from '../llm-provider/llm-provider.service.js';
import { updateSystemAgentsAcpTool } from '../../scripts/system-agent-definitions.js';

export const appSettingService = {
  async get(key: string): Promise<string | null> {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    return setting?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  },

  async isSetupCompleted(): Promise<boolean> {
    const value = await this.get('setupCompleted');
    return value === 'true';
  },

  /** 助手日记功能全局开关（默认关闭） */
  async isDiaryEnabled(): Promise<boolean> {
    const value = await this.get('diaryEnabled');
    return value === 'true';
  },

  async getDefaultAcpTool(): Promise<string> {
    return (await this.get('defaultAcpTool')) || 'claude';
  },

  /**
   * 完成首次引导：注册用户 + 保存设置 + 更新系统助手 ACP 工具
   * 可选：创建默认 LlmProvider
   */
  async completeSetup(data: {
    username: string;
    password: string;
    avatar?: string;
    defaultAcpTool: string;
    modelConfig?: {
      apiUrl?: string;
      apiKey: string;
      model: string;
      apiProtocol: string;
    };
  }): Promise<{ token: string; userId: string; username: string }> {
    // 1. 注册用户
    const result = await authService.register({
      username: data.username,
      password: data.password,
      avatar: data.avatar,
    });

    // 2. 保存设置
    await this.set('setupCompleted', 'true');
    await this.set('defaultAcpTool', data.defaultAcpTool);

    // 3. 更新所有系统助手的 acpTool
    await updateSystemAgentsAcpTool(data.defaultAcpTool);

    // 4. 创建默认模型配置
    if (data.modelConfig) {
      await llmProviderService.create({
        name: '默认模型',
        apiProtocol: data.modelConfig.apiProtocol,
        apiUrl: data.modelConfig.apiUrl,
        apiKey: data.modelConfig.apiKey,
        model: data.modelConfig.model,
        isDefault: true,
      });
    }

    return {
      token: result.token,
      userId: result.user.id,
      username: result.user.username,
    };
  },
};
