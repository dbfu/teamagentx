import prisma from '../../lib/prisma.js';
import { authService } from '../auth/auth.service.js';
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

  async getDefaultAcpTool(): Promise<string> {
    return (await this.get('defaultAcpTool')) || 'claude';
  },

  /**
   * 完成首次引导：注册用户 + 保存设置 + 更新系统助手 ACP 工具
   */
  async completeSetup(data: {
    username: string;
    password: string;
    avatar?: string;
    defaultAcpTool: string;
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

    return {
      token: result.token,
      userId: result.user.id,
      username: result.user.username,
    };
  },
};
