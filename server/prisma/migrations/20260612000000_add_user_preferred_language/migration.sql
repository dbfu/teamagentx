-- AlterTable: 新增用户界面语言偏好，决定 Agent 系统提示词语种（zh-CN / en-US）
ALTER TABLE "User" ADD COLUMN "preferredLanguage" TEXT NOT NULL DEFAULT 'zh-CN';
