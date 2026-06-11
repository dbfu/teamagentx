// 后端生成、会落库并展示给用户的系统消息文案。
// 后端没有完整 i18n 框架，这里用最小映射按界面语言返回对应文案。
// 新增此类「系统注入的可见消息」时在这里登记 key，调用方传入用户界面语言。

import { type Locale, pickLocaleText } from './locale.js';

const SYSTEM_MESSAGES = {
  taskCancelledByUser: {
    'zh-CN': '任务已被用户手动取消',
    'en-US': 'Task manually cancelled by user',
  },
} satisfies Record<string, Record<Locale, string>>;

export type SystemMessageKey = keyof typeof SYSTEM_MESSAGES;

export function getSystemMessage(key: SystemMessageKey, locale?: string): string {
  return pickLocaleText(SYSTEM_MESSAGES[key], locale);
}
