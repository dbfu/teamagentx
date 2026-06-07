// 后端生成、会落库并展示给用户的系统消息文案。
// 后端没有完整 i18n 框架，这里用最小映射按界面语言返回对应文案。
// 新增此类「系统注入的可见消息」时在这里登记 key，调用方传入用户界面语言。

type Locale = 'zh-CN' | 'en-US';

const DEFAULT_LOCALE: Locale = 'zh-CN';

const SYSTEM_MESSAGES = {
  taskCancelledByUser: {
    'zh-CN': '任务已被用户手动取消',
    'en-US': 'Task manually cancelled by user',
  },
} satisfies Record<string, Record<Locale, string>>;

export type SystemMessageKey = keyof typeof SYSTEM_MESSAGES;

function normalizeLocale(locale?: string): Locale {
  if (!locale) return DEFAULT_LOCALE;
  // 容忍 'en'、'en-US'、'zh'、'zh-CN' 等写法
  if (locale.toLowerCase().startsWith('en')) return 'en-US';
  return 'zh-CN';
}

export function getSystemMessage(key: SystemMessageKey, locale?: string): string {
  const entry = SYSTEM_MESSAGES[key];
  return entry[normalizeLocale(locale)] ?? entry[DEFAULT_LOCALE];
}
